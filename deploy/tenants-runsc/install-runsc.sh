#!/usr/bin/env bash
# Installs the pinned gVisor (runsc + containerd-shim-runsc-v1) for the gVisor tenant daemon.
#
# Source: https://gvisor.dev/docs/user_guide/install/ ("Install latest release" and
# "Point release"): https://storage.googleapis.com/gvisor/releases/release/<yyyymmdd>.<rc>/<arch>/
# Release used here: release-20261102.0 (published 2026-11-02, GitHub google/gvisor).
#
# The tarball is verified against a SHA-512 pinned in this file (taken from the
# gvisor.tar.zstd.sha512 published next to it). The script refuses to install on mismatch.
#
# This script deliberately does NOT run `runsc install`: that command edits
# /etc/docker/daemon.json, which belongs to the rootful control-plane daemon.
# The tenant daemon is configured by deploy/tenants-runsc/daemon.json instead.
#
# Idempotent: when the pinned release is already installed it does nothing.
# It never restarts Docker or any service.

set -euo pipefail

RUNSC_RELEASE='20261102.0'
# SHA-512 of gvisor.tar.zstd per architecture (from the published .sha512 files).
RUNSC_SHA512_X86_64='3c400f72be459b57b99b1c4f69be96bcd67eef3caf2078e595fc98e688b6b9a3af7802646b3dde7da8a9aba96d34f86be303e0430c7868ab2d13becdd403c0c1'
RUNSC_SHA512_AARCH64='e829ca32eef36f4e960460a6dcb094d7945ab507e9bfe0275f09467ab9bfeb846528fddfd42349ad64bb4f5b02148e1065c06e573feb8f6a8b3f47efa30a7d2e'

INSTALL_DIR="${QAAP_RUNSC_INSTALL_DIR:-/usr/local/bin}"
STATE_DIR="${QAAP_RUNSC_STATE_DIR:-/usr/local/share/qaap}"
MARKER="$STATE_DIR/runsc-release"
# sha512 of every installed file, written at install time. The idempotency shortcut re-verifies it.
MANIFEST="$STATE_DIR/runsc-release.sha512"
BASE_URL='https://storage.googleapis.com/gvisor/releases/release'

log() { printf '[install-runsc] %s\n' "$*"; }
die() { printf '[install-runsc] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die 'run as root (sudo bash install-runsc.sh)'
command -v curl >/dev/null 2>&1 || die 'curl is required'
command -v zstd >/dev/null 2>&1 || die 'zstd is required (sudo apt-get install -y zstd)'
command -v sha512sum >/dev/null 2>&1 || die 'sha512sum is required'

case "$(uname -m)" in
    x86_64) ARCH=x86_64; EXPECTED_SHA512=$RUNSC_SHA512_X86_64 ;;
    aarch64) ARCH=aarch64; EXPECTED_SHA512=$RUNSC_SHA512_AARCH64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
esac

# The shortcut trusts the installed bytes, not a marker file: the manifest must list exactly the installed
# files, and every listed sha512 must still match. Anything else reinstalls the pinned release.
installed_intact() {
    [ -f "$MANIFEST" ] && [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$RUNSC_RELEASE" ] || return 1
    [ -x "$INSTALL_DIR/runsc" ] && [ -x "$INSTALL_DIR/containerd-shim-runsc-v1" ] && [ -d "$INSTALL_DIR/gvisor-bin" ] || return 1
    local listed present
    listed="$(awk '{print $2}' "$MANIFEST" | LC_ALL=C sort)"
    present="$(cd "$INSTALL_DIR" && { echo runsc; echo containerd-shim-runsc-v1; find gvisor-bin -type f; } | LC_ALL=C sort)"
    [ "$listed" = "$present" ] || return 1
    (cd "$INSTALL_DIR" && sha512sum --check --quiet --strict "$MANIFEST") >/dev/null 2>&1
}

if installed_intact; then
    log "release $RUNSC_RELEASE already installed in $INSTALL_DIR; nothing to do"
else
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT
    TARBALL="$WORK/gvisor.tar.zstd"
    STAGE="$WORK/stage"
    mkdir -p "$STAGE"

    URL="$BASE_URL/$RUNSC_RELEASE/$ARCH/gvisor.tar.zstd"
    log "downloading $URL"
    curl -fsSL --proto '=https' --tlsv1.2 -o "$TARBALL" "$URL"

    ACTUAL_SHA512="$(sha512sum "$TARBALL" | awk '{print $1}')"
    if [ "$ACTUAL_SHA512" != "$EXPECTED_SHA512" ]; then
        die "SHA-512 mismatch for $URL (expected $EXPECTED_SHA512, got $ACTUAL_SHA512); nothing installed"
    fi
    log 'SHA-512 verified'

    # Archive owners and modes are not trusted: everything is re-owned to root below.
    tar --zstd --no-same-owner --no-same-permissions -xf "$TARBALL" -C "$STAGE"
    [ -x "$STAGE/runsc" ] || die 'tarball does not contain an executable runsc at its root'
    [ -x "$STAGE/containerd-shim-runsc-v1" ] || die 'tarball does not contain containerd-shim-runsc-v1'
    [ -d "$STAGE/gvisor-bin" ] || die 'tarball does not contain gvisor-bin/ (runsc needs its sidecar binaries)'

    # runsc looks for gvisor-bin/ next to its own binary, so the three must move together.
    install -m 0755 "$STAGE/runsc" "$INSTALL_DIR/runsc"
    install -m 0755 "$STAGE/containerd-shim-runsc-v1" "$INSTALL_DIR/containerd-shim-runsc-v1"
    rm -rf "$INSTALL_DIR/gvisor-bin"
    cp -a "$STAGE/gvisor-bin" "$INSTALL_DIR/gvisor-bin"

    # Root-owned, and not writable by group or others: a tenant-readable binary is a root escape path.
    chown -R root:root "$INSTALL_DIR/runsc" "$INSTALL_DIR/containerd-shim-runsc-v1" "$INSTALL_DIR/gvisor-bin"
    chmod -R go-w "$INSTALL_DIR/runsc" "$INSTALL_DIR/containerd-shim-runsc-v1" "$INSTALL_DIR/gvisor-bin"

    mkdir -p "$STATE_DIR"
    (cd "$INSTALL_DIR" && { sha512sum runsc containerd-shim-runsc-v1; find gvisor-bin -type f -print0 | LC_ALL=C sort -z | xargs -0 sha512sum; }) > "$MANIFEST"
    printf '%s\n' "$RUNSC_RELEASE" > "$MARKER"
    log "installed release $RUNSC_RELEASE into $INSTALL_DIR"
fi

"$INSTALL_DIR/runsc" --version || die 'installed runsc does not run'

cat <<EOF

Next steps (manual, not performed by this script):
  1. Review deploy/tenants-runsc/daemon.json and copy it to /etc/docker-tenants/daemon.json.
  2. Create the tenant groups and proxy user, and the tenant data root (see deploy/tenants-runsc/README.md).
  3. Install dockerd-tenants.service and start it: systemctl enable --now dockerd-tenants.service
  4. Check: docker -H unix:///run/docker-tenants/docker.sock info | grep -i -A2 runtime
  5. Install the socket proxy, then run the canary checks in deploy/tenants-runsc/README.md.
EOF
