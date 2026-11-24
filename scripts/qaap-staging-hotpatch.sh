#!/usr/bin/env bash
# *****************************************************************************
# Copyright (C) 2026 Theia contributors and Qaap product fork.
# SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
# *****************************************************************************
#
# Hot-patches the STAGING tenant backend with locally compiled qaap packages, to iterate on tenant-only
# behaviour (1 CPU, dropped agent uid, rootless docker) in minutes instead of a ~25 min image build.
#
#   scripts/qaap-staging-hotpatch.sh qaap-cloud-workspace qaap-shared-core
#
# - Compiles each package on this machine (`tsc -b`), never on the VPS (production shares that host).
# - Copies only `packages/<pkg>/lib` into the running `stg-qaap-backend-*` container and restarts it.
# - Refuses any container whose name does not start with `stg-`: production is never patched this way.
# - A patch survives `docker restart` and is gone once the container is recreated from its image (a staging
#   deploy, or removing the tenant). Confirm the final state with one real image build before merging.
# - Backend code only: browser code ships in the webpack bundle, which this script does not rebuild.
set -euo pipefail

HOST="${QAAP_HOTPATCH_HOST:-qaap-vps}"
ROOT="$(git rev-parse --show-toplevel)"

if [ "$#" -eq 0 ]; then
    echo "usage: $0 <qaap-package> [<qaap-package> ...]" >&2
    exit 2
fi

LIBS=()
for pkg in "$@"; do
    case "$pkg" in
        qaap-*) ;;
        *) echo "refusing '$pkg': only packages/qaap-* are hot-patched" >&2; exit 2 ;;
    esac
    if [ ! -d "$ROOT/packages/$pkg" ]; then
        echo "no such package: packages/$pkg" >&2
        exit 2
    fi
    echo "== compiling $pkg"
    (cd "$ROOT" && npx tsc -b "packages/$pkg" 2>&1 | grep -E '^packages/qaap-' && exit 1 || true)
    LIBS+=("packages/$pkg/lib")
done

echo "== patching the staging tenant on $HOST: ${LIBS[*]}"
started=$(date +%s)
tar czf - -C "$ROOT" "${LIBS[@]}" | ssh -o BatchMode=yes "$HOST" '
set -eu
R="docker -H unix:///run/user/1000/docker.sock"
C=$($R ps --filter label=com.qaap.namespace=stg --format "{{.Names}}" | grep "^stg-qaap-backend-" | head -1 || true)
case "$C" in
    stg-qaap-backend-*) ;;
    *) echo "no running staging tenant backend (load https://staging.qaaq.dev once to create it)" >&2; exit 3 ;;
esac
cat > /tmp/qaap-hotpatch.tgz
$R cp /tmp/qaap-hotpatch.tgz "$C":/tmp/qaap-hotpatch.tgz
$R exec "$C" tar xzf /tmp/qaap-hotpatch.tgz -C /app
$R exec "$C" rm -f /tmp/qaap-hotpatch.tgz
rm -f /tmp/qaap-hotpatch.tgz
$R restart "$C" >/dev/null
for i in $(seq 1 60); do
    state=$($R inspect "$C" --format "{{.State.Health.Status}}" 2>/dev/null || echo unknown)
    [ "$state" = healthy ] && { echo "$C healthy"; exit 0; }
    sleep 2
done
echo "$C not healthy after 120 s (state: $state)" >&2
exit 4
'
echo "== done in $(( $(date +%s) - started )) s; reload the staging tab"
