#!/usr/bin/env bash
# Installs the pinned Qaap build of gVisor and registers it as a second runtime on the rootless daemon.
# See deploy/rootless/gvisor/README.md. Registering a runtime starts nothing: every container keeps its runtime
# until the control plane selects runsc for a tenant.
#
# Usage, as root: qaap-gvisor-install.sh {install|check|remove}
#   install  verify and unpack the release, add the runtime, reload the daemon (live containers keep running)
#   check    verify the installed files, the registered runtime, and that limits reach a real sandbox's cgroup
#   remove   take the runtime out of the daemon; refused while any container uses it
# Environment:
#   QAAP_ROOTLESS_USER        rootless Docker user (default: ubuntu)
#   QAAP_GVISOR_TARBALL       local copy of the release tarball; it is copied before its hash is checked
#   QAAP_GVISOR_LIB_ROOT      install root (default: /usr/local/lib/qaap-gvisor)
#   QAAP_GVISOR_SMOKE_IMAGE   local image for the limits check (default: qaap-tenant-egress:current)
set -euo pipefail

GVISOR_RELEASE='qaap-20261102.0-1'
GVISOR_SHA512='5878526e7992c264de4f8626f3c8c2308996cf0db0e053ae283b6e2462d904babee4152ff77819c726b475bcb26719e1fd721cc15479a48e19fe0165f0c10ab4'
# Digest of the unpacked tree: `sha512sum` of every file, sorted by path, then hashed. Pinned here rather than generated
# on the host, so `check` also catches changed or added files.
GVISOR_TREE_SHA512='cc5b963e6fe6c211ec8acd50f77f02314017ef1c64d4b4e9aa33fd73cb69f42f7cd06b824813be61a22d5da82050a8fe13af5b93827eb4933108a6e6dcd4c476'
GVISOR_URL="https://github.com/juancristobalgd1/gvisor/releases/download/$GVISOR_RELEASE/gvisor-fork.tar.zstd"
# Must match QAAP_RUNSC_ARGS in packages/qaap-cloud-workspace/src/node/qaap-tenant-runtime.ts.
RUNSC_ARGS='["--platform=systrap", "--directfs=false", "--systemd-cgroup"]'

ROOTLESS_USER="${QAAP_ROOTLESS_USER:-ubuntu}"
LIB_ROOT="${QAAP_GVISOR_LIB_ROOT:-/usr/local/lib/qaap-gvisor}"
SMOKE_IMAGE="${QAAP_GVISOR_SMOKE_IMAGE:-qaap-tenant-egress:current}"
INSTALL_DIR="$LIB_ROOT/$GVISOR_RELEASE"
# Task limits of the gVisor slices. A sandbox that cannot create a thread dies instead of failing the fork, so these keep
# one tenant from exhausting the limit shared with the others, and all of them from exhausting the daemon's. The rootless
# user's own limit on the VPS is 63342: the total leaves the daemon room, and a tenant fits a full set of containers.
TENANT_TASKS_MAX=8192
ALL_TENANTS_TASKS_MAX=50000
RUNSC_PATH="$INSTALL_DIR/runsc"
WORK=''
SMOKE_CONTAINER=''

log() { printf '[qaap-gvisor] %s\n' "$*"; }
die() { printf '[qaap-gvisor] ERROR: %s\n' "$*" >&2; exit 1; }

cleanup() {
    if [ -n "$SMOKE_CONTAINER" ]; then
        as_rootless docker rm -f "$SMOKE_CONTAINER" >/dev/null 2>&1 || true
    fi
    if [ -n "$WORK" ]; then
        rm -rf -- "$WORK"
    fi
}
trap cleanup EXIT

[ "$(id -u)" -eq 0 ] || die 'run as root: the binaries must not be writable by the rootless user or by tenants'
[ "$(uname -m)" = x86_64 ] || die "the pinned release is x86_64 only, not $(uname -m)"
ROOTLESS_UID="$(id -u "$ROOTLESS_USER")" || die "unknown user $ROOTLESS_USER"
ROOTLESS_HOME="$(getent passwd "$ROOTLESS_USER" | cut -d: -f6)"
DAEMON_JSON="$ROOTLESS_HOME/.config/docker/daemon.json"
USER_CGROUP="${QAAP_GVISOR_CGROUP_ROOT:-/sys/fs/cgroup}/user.slice/user-$ROOTLESS_UID.slice/user@$ROOTLESS_UID.service"

as_rootless() {
    sudo -u "$ROOTLESS_USER" env "HOME=$ROOTLESS_HOME" "XDG_RUNTIME_DIR=/run/user/$ROOTLESS_UID" \
        "DOCKER_HOST=unix:///run/user/$ROOTLESS_UID/docker.sock" "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$ROOTLESS_UID/bus" "$@"
}

tree_digest() {
    (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha512sum | sha512sum | awk '{print $1}')
}

installed_intact() {
    [ -d "$INSTALL_DIR" ] && [ "$(tree_digest "$INSTALL_DIR")" = "$GVISOR_TREE_SHA512" ]
}

# Everything from the install root down: nothing writable by others, nothing owned by anyone but root.
permissions_problem() {
    find "$LIB_ROOT" \( -perm /022 ! -type l \) -o ! -user root 2>/dev/null | head -3
}

unpack_release() {
    local tarball stage previous
    # Root-only workspace: nobody can swap the tarball between the hash and the extraction.
    WORK="$(mktemp -d)"
    chmod 0700 "$WORK"
    tarball="$WORK/gvisor.tar.zstd"
    if [ -n "${QAAP_GVISOR_TARBALL:-}" ]; then
        cp -- "$QAAP_GVISOR_TARBALL" "$tarball"
    else
        log "downloading $GVISOR_URL"
        curl -fsSL --proto '=https' --tlsv1.2 -o "$tarball" "$GVISOR_URL"
    fi
    [ "$(sha512sum "$tarball" | awk '{print $1}')" = "$GVISOR_SHA512" ] || die "SHA-512 mismatch for the release; nothing installed"
    mkdir -p "$LIB_ROOT"
    chown root:root "$LIB_ROOT"
    chmod 0755 "$LIB_ROOT"
    # Staged on the install filesystem, so publishing it is a rename and the daemon never sees a partial install.
    stage="$(mktemp -d "$LIB_ROOT/.stage.XXXXXX")"
    previous="$LIB_ROOT/.previous.$$"
    tar --zstd --no-same-owner --no-same-permissions -xf "$tarball" -C "$stage" \
        || { rm -rf -- "$stage"; die 'could not unpack the release'; }
    if [ "$(tree_digest "$stage")" != "$GVISOR_TREE_SHA512" ]; then
        rm -rf -- "$stage"
        die 'the unpacked files do not match the pinned digest; nothing installed'
    fi
    chown -R root:root "$stage"
    chmod -R go-w,a+rX "$stage"
    if [ -e "$INSTALL_DIR" ]; then
        mv -T -- "$INSTALL_DIR" "$previous"
    fi
    mv -T -- "$stage" "$INSTALL_DIR"
    rm -rf -- "$previous"
}

# Merges the runtime into daemon.json, leaving every other setting alone. It runs as the rootless user, who owns that
# directory: root writing there could be redirected by a symlink. Prints "changed" or "same".
edit_daemon_json() {
    as_rootless python3 -c '
import json, os, sys, tempfile
path, action, runsc, args = sys.argv[1:5]
config = {}
if os.path.exists(path):
    with open(path) as handle:
        config = json.load(handle)
before = json.dumps(config, sort_keys=True)
runtimes = config.setdefault("runtimes", {})
if action == "add":
    runtimes["runsc"] = {"path": runsc, "runtimeArgs": json.loads(args)}
else:
    runtimes.pop("runsc", None)
    if not runtimes:
        del config["runtimes"]
if json.dumps(config, sort_keys=True) == before:
    print("same")
    sys.exit(0)
os.makedirs(os.path.dirname(path), exist_ok=True)
descriptor, temporary = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".daemon.json.")
with os.fdopen(descriptor, "w") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
os.chmod(temporary, 0o644)
os.replace(temporary, path)
print("changed")
' "$DAEMON_JSON" "$1" "$RUNSC_PATH" "$RUNSC_ARGS"
}

reload_daemon() {
    as_rootless systemctl --user reload docker
}

# `qaap-.slice.d` applies to every `qaap-<tenant>.slice`, and `qaap.slice.d` to their common parent.
write_slice_limits() {
    as_rootless python3 -c '
import os, sys
home, tenant, total = sys.argv[1:4]
root = os.path.join(home, ".config/systemd/user")
for unit, limit in (("qaap-.slice.d", tenant), ("qaap.slice.d", total)):
    directory = os.path.join(root, unit)
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, "50-qaap-gvisor.conf"), "w") as handle:
        handle.write("[Slice]\nTasksMax=%s\n" % limit)
' "$ROOTLESS_HOME" "$TENANT_TASKS_MAX" "$ALL_TENANTS_TASKS_MAX"
    as_rootless systemctl --user daemon-reload
}

remove_slice_limits() {
    as_rootless rm -f "$ROOTLESS_HOME/.config/systemd/user/qaap-.slice.d/50-qaap-gvisor.conf" "$ROOTLESS_HOME/.config/systemd/user/qaap.slice.d/50-qaap-gvisor.conf"
    as_rootless systemctl --user daemon-reload
}

# The daemon must report exactly the pinned path and flags.
runtime_is_registered() {
    as_rootless docker info --format '{{json .Runtimes.runsc}}' 2>/dev/null | python3 -c '
import json, sys
try:
    runtime = json.load(sys.stdin)
except ValueError:
    sys.exit(1)
sys.exit(0 if runtime and runtime.get("path") == sys.argv[1] and runtime.get("runtimeArgs") == json.loads(sys.argv[2]) else 1)
' "$RUNSC_PATH" "$RUNSC_ARGS"
}

# Starts a real sandbox and reads its cgroup: a controller being present does not prove a limit was applied.
assert_limits_applied() {
    local scope actual
    as_rootless docker image inspect "$SMOKE_IMAGE" >/dev/null 2>&1 || die "limits check needs the local image $SMOKE_IMAGE (QAAP_GVISOR_SMOKE_IMAGE)"
    SMOKE_CONTAINER="$(as_rootless docker run -d --pull never --runtime runsc --cgroup-parent qaap-smoke.slice --memory 268435456 --pids-limit 128 --cpus 0.5 --entrypoint sleep "$SMOKE_IMAGE" 60)"
    scope="$(find "$USER_CGROUP" -type d -name "*$SMOKE_CONTAINER*.scope" 2>/dev/null | head -1)"
    [ -n "$scope" ] || die 'the sandbox has no systemd scope under the rootless user'
    actual="$(cat "$scope/memory.max") $(cat "$scope/pids.max") $(cat "$scope/cpu.max")"
    [ "$actual" = '268435456 128 50000 100000' ] || die "limits not applied, got: $actual"
    [ "$(cat "$(dirname "$scope")/pids.max")" = "$TENANT_TASKS_MAX" ] || die "the tenant slice has pids.max $(cat "$(dirname "$scope")/pids.max"), expected $TENANT_TASKS_MAX"
    [ "$(cat "$(dirname "$(dirname "$scope")")/pids.max")" = "$ALL_TENANTS_TASKS_MAX" ] || die "qaap.slice has pids.max $(cat "$(dirname "$(dirname "$scope")")/pids.max"), expected $ALL_TENANTS_TASKS_MAX"
    as_rootless docker rm -f "$SMOKE_CONTAINER" >/dev/null
    SMOKE_CONTAINER=''
    log 'memory, pids and cpu limits reach the sandbox, and the task limits its slices'
}

case "${1:-}" in
    install)
        if installed_intact; then
            log "$GVISOR_RELEASE already installed in $INSTALL_DIR"
        else
            unpack_release
            log "installed $GVISOR_RELEASE in $INSTALL_DIR"
        fi
        # Not as root: this is the first time the new binary runs.
        as_rootless "$RUNSC_PATH" --version | head -1
        if [ "$(edit_daemon_json add)" = changed ]; then
            log "registered the runtime in $DAEMON_JSON"
        fi
        write_slice_limits
        reload_daemon
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            if runtime_is_registered; then break; fi
            sleep 1
        done
        runtime_is_registered || die 'the daemon does not report the pinned runtime after the reload'
        log 'runtime active; no container changed runtime'
        assert_limits_applied
        ;;
    check)
        installed_intact || die "the files in $INSTALL_DIR do not match the release"
        problem="$(permissions_problem)"
        [ -z "$problem" ] || die "not root-only: $(echo "$problem" | tr '\n' ' ')"
        runtime_is_registered || die 'the daemon does not report the pinned runtime'
        assert_limits_applied
        log "$GVISOR_RELEASE intact and registered"
        ;;
    remove)
        in_use="$(as_rootless docker ps -a --filter 'label=com.qaap.managed=true' --format '{{.Names}}' | while read -r name; do
            if [ "$(as_rootless docker inspect -f '{{.HostConfig.Runtime}}' "$name")" = runsc ]; then echo "$name"; fi
        done)"
        [ -z "$in_use" ] || die "containers still use runsc: $(echo "$in_use" | tr '\n' ' ')"
        edit_daemon_json remove >/dev/null
        remove_slice_limits
        reload_daemon
        log "runtime removed; the files stay in $LIB_ROOT"
        ;;
    *)
        echo "Usage: $0 {install|check|remove}" >&2
        exit 2
        ;;
esac
