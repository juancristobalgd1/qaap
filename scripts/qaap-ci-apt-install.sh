#!/usr/bin/env bash
# Installs apt packages on a GitHub-hosted Ubuntu runner and survives transient mirror outages.
# GitHub runners resolve archive.ubuntu.com through azure.archive.ubuntu.com, which sometimes fails
# DNS ("Temporary failure resolving"). Usage: qaap-ci-apt-install.sh <package>...
#
# Three attempts, backing off 15s and then 30s. Before the last attempt, every apt source that
# points at azure.archive.ubuntu.com is rewritten to archive.ubuntu.com (the original file is kept
# next to it as <name>.qaap-azure.bak). Each apt call also retries its downloads (Acquire::Retries).
#
# Test hooks: QAAP_APT_ROOT (default /etc/apt), QAAP_APT_SUDO (default sudo; empty runs as-is),
# QAAP_APT_SLEEP (default sleep; the backoff is passed as its argument).
set -euo pipefail

if (( $# == 0 )); then
    echo 'usage: qaap-ci-apt-install.sh <package>...' >&2
    exit 2
fi

APT_ROOT="${QAAP_APT_ROOT:-/etc/apt}"
SUDO="${QAAP_APT_SUDO-sudo}"
SLEEP_CMD="${QAAP_APT_SLEEP:-sleep}"
MAX_ATTEMPTS=3
BACKOFF_SECONDS=(15 30)
APT_RETRY_OPTS=(-o Acquire::Retries=5)

run_root() {
    if [[ -n "$SUDO" ]]; then
        "$SUDO" "$@"
    else
        "$@"
    fi
}

install_packages() {
    run_root apt-get "${APT_RETRY_OPTS[@]}" update || return 1
    run_root env DEBIAN_FRONTEND=noninteractive apt-get "${APT_RETRY_OPTS[@]}" install -y --no-install-recommends "$@" || return 1
}

use_fallback_mirror() {
    local file
    local -a candidates=("$APT_ROOT/sources.list" "$APT_ROOT/apt-mirrors.txt")
    shopt -s nullglob
    candidates+=("$APT_ROOT"/sources.list.d/*.list "$APT_ROOT"/sources.list.d/*.sources)
    shopt -u nullglob
    for file in "${candidates[@]}"; do
        [[ -f "$file" ]] || continue
        if grep -q 'azure\.archive\.ubuntu\.com' "$file"; then
            echo "Switching apt mirror in $file: azure.archive.ubuntu.com -> archive.ubuntu.com" >&2
            run_root sed -i.qaap-azure.bak -E 's#(https?://)azure\.archive\.ubuntu\.com/#\1archive.ubuntu.com/#g' "$file"
        fi
    done
}

attempt=1
while true; do
    if install_packages "$@"; then
        exit 0
    fi
    if (( attempt >= MAX_ATTEMPTS )); then
        echo "apt install failed after $attempt attempts: $*" >&2
        exit 1
    fi
    if (( attempt == MAX_ATTEMPTS - 1 )); then
        use_fallback_mirror
    fi
    delay="${BACKOFF_SECONDS[attempt - 1]}"
    echo "apt install attempt $attempt failed; retrying in ${delay}s (attempt $((attempt + 1)) of $MAX_ATTEMPTS)" >&2
    "$SLEEP_CMD" "$delay"
    attempt=$((attempt + 1))
done
