#!/usr/bin/env bash
# Sourced by qaap-vps-update.sh. Optional read-only GHCR credential for the VPS image pulls.
#
# ghcr.io/juancristobalgd1/qaap is public today, so the rootless tenant seed pulls anonymously.
# Before that package becomes private, set in /opt/qaap/.env (or the environment):
#   QAAP_GHCR_USERNAME=<github login>
#   QAAP_GHCR_READ_TOKEN=<classic PAT with read:packages only>
# With both set, the update logs the host daemon and the rootless daemon in before the pulls and
# logs them out when the script exits. With neither set nothing changes (anonymous pulls).
# The token only travels on stdin (--password-stdin): never in argv, never printed. The .env file
# is parsed, not sourced. Runbook: doc/qaap-ghcr-private.md.

QAAP_GHCR_AUTHENTICATED=0
QAAP_GHCR_ROOT_LOGGED_IN=0
QAAP_GHCR_ROOTLESS_LOGGED_IN=0

# NAME from the environment, else from $REPO_DIR/.env (parsed, never sourced).
qaap_ghcr_setting() {
    local name="$1" value="${!1:-}" env_file="${REPO_DIR:-.}/.env"
    if [[ -z "$value" && -f "$env_file" ]]; then
        value="$(sed -n "s/^${name}=//p" "$env_file" | sed -n '1p' | tr -d '\r')"
        value="${value#\"}"; value="${value%\"}"
        value="${value#\'}"; value="${value%\'}"
    fi
    printf '%s' "$value"
}

# Rootless daemon socket and the user that owns it (the operator account on the VPS).
qaap_ghcr_rootless_socket() {
    local uid="${QAAP_TENANT_LOOPBACK_UID:-1000}"
    printf '%s' "${QAAP_ROOTLESS_SOCKET:-/run/user/$uid/docker.sock}"
}

# Runs a command as the rootless user (directly when already that user, else via passwordless sudo).
qaap_ghcr_as_rootless() {
    local rootless_user="${QAAP_ROOTLESS_USER:-ubuntu}"
    if [[ "$(id -un)" == "$rootless_user" ]]; then
        "$@"
    else
        sudo -n -u "$rootless_user" "$@"
    fi
}

# Logs the host and rootless daemons in to ghcr.io. Never fails the deploy: a failed login keeps
# the pulls anonymous and is reported.
qaap_ghcr_login() {
    local username token socket uid
    username="$(qaap_ghcr_setting QAAP_GHCR_USERNAME)"
    token="$(qaap_ghcr_setting QAAP_GHCR_READ_TOKEN)"
    if [[ -z "$username" && -z "$token" ]]; then
        return 0
    fi
    if [[ -z "$username" || -z "$token" ]]; then
        echo '[qaap-ghcr] QAAP_GHCR_USERNAME and QAAP_GHCR_READ_TOKEN must be set together; pulls stay anonymous' >&2
        return 0
    fi

    if printf '%s' "$token" | docker login ghcr.io --username "$username" --password-stdin >/dev/null; then
        QAAP_GHCR_ROOT_LOGGED_IN=1
    else
        echo '[qaap-ghcr] host Docker login to ghcr.io failed; host pulls stay anonymous' >&2
    fi

    socket="$(qaap_ghcr_rootless_socket)"
    uid="${QAAP_TENANT_LOOPBACK_UID:-1000}"
    if [[ ! -S "$socket" ]]; then
        echo "[qaap-ghcr] no rootless Docker socket at $socket; rootless login skipped" >&2
    elif printf '%s' "$token" | qaap_ghcr_as_rootless env "XDG_RUNTIME_DIR=/run/user/$uid" "DOCKER_HOST=unix://$socket" \
        docker login ghcr.io --username "$username" --password-stdin >/dev/null; then
        QAAP_GHCR_ROOTLESS_LOGGED_IN=1
    else
        echo '[qaap-ghcr] rootless Docker login to ghcr.io failed; rootless pulls stay anonymous' >&2
    fi

    if (( QAAP_GHCR_ROOT_LOGGED_IN == 1 )); then
        QAAP_GHCR_AUTHENTICATED=1
        echo "[qaap-ghcr] authenticated GHCR pulls as $username (host: yes, rootless: $( (( QAAP_GHCR_ROOTLESS_LOGGED_IN == 1 )) && echo yes || echo no))"
    fi
    return 0
}

# Removes the logins made by qaap_ghcr_login. Called from the EXIT trap; never fails.
qaap_ghcr_logout() {
    if (( QAAP_GHCR_ROOTLESS_LOGGED_IN == 1 )); then
        local socket uid
        socket="$(qaap_ghcr_rootless_socket)"
        uid="${QAAP_TENANT_LOOPBACK_UID:-1000}"
        qaap_ghcr_as_rootless env "XDG_RUNTIME_DIR=/run/user/$uid" "DOCKER_HOST=unix://$socket" \
            docker logout ghcr.io >/dev/null 2>&1 || true
        QAAP_GHCR_ROOTLESS_LOGGED_IN=0
    fi
    if (( QAAP_GHCR_ROOT_LOGGED_IN == 1 )); then
        docker logout ghcr.io >/dev/null 2>&1 || true
        QAAP_GHCR_ROOT_LOGGED_IN=0
    fi
    QAAP_GHCR_AUTHENTICATED=0
    return 0
}
