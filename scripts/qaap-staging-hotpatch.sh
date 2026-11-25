#!/usr/bin/env bash
# *****************************************************************************
# Copyright (C) 2026 Theia contributors and Qaap product fork.
# SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
# *****************************************************************************
#
# Hot-patches the STAGING tenant backends with locally compiled qaap packages, to iterate on tenant-only
# behaviour (1 CPU, dropped agent uid, rootless docker) in minutes instead of a ~25 min image build.
#
#   scripts/qaap-staging-hotpatch.sh qaap-cloud-workspace qaap-shared-core
#   scripts/qaap-staging-hotpatch.sh --reset      # back to the deployed staging image
#
# How: tenant containers run with a read-only root filesystem, so they cannot be patched in place. The script
# compiles each package here (`tsc -b`, never on the VPS, which production shares), builds a derived image on the
# rootless daemon that only copies `packages/<pkg>/lib` over the deployed staging image, points the staging control
# plane's QAAP_TENANT_DOCKER_IMAGE at it through an override file outside the repository, and removes the `stg-`
# tenant containers so the next page load recreates them from it.
# - Staging only: it touches the `qaap-staging` compose project and `stg-` containers, never production's.
# - A real staging deploy (or --reset) goes back to the deployed image. Confirm the final state with one real
#   image build before merging.
# - Backend code only: browser code ships in the webpack bundle, which this script does not rebuild.
set -euo pipefail

HOST="${QAAP_HOTPATCH_HOST:-qaap-vps}"
ROOT="$(git rev-parse --show-toplevel)"

# Runs on the VPS: recreates the staging control plane with (or without) the tenant image override, then drops the
# staging tenants. $1 = image to use for tenants, or empty to reset.
REMOTE_APPLY='
set -eu
R="docker -H unix:///run/user/1000/docker.sock"
OVERRIDE=/opt/qaap-staging/hotpatch.override.yml
TENANT_IMAGE="$1"
BASE=$(docker inspect qaap-staging-theia --format "{{.Config.Image}}")
if [ -n "$TENANT_IMAGE" ]; then
    printf "services:\n  theia-staging:\n    environment:\n      QAAP_TENANT_DOCKER_IMAGE: %s\n" "$TENANT_IMAGE" | sudo tee "$OVERRIDE" >/dev/null
    EXTRA="-f $OVERRIDE"
else
    sudo rm -f "$OVERRIDE"
    EXTRA=""
fi
# Staging-only resource override, kept until compose.staging.yml of the repository reaches /opt/qaap with a merge.
if [ -f /opt/qaap-staging/resources.override.yml ]; then
    EXTRA="$EXTRA -f /opt/qaap-staging/resources.override.yml"
fi
cd /opt/qaap
H=$(sed -n "s/^QAAP_PUBLIC_HOST=//p" .env)
QAAP_STAGING_IMAGE="$BASE" QAAP_PUBLIC_HOST="$H" docker compose -p qaap-staging -f deploy/staging/compose.staging.yml $EXTRA up -d --no-build --force-recreate theia-staging 2>&1 | tail -1
$R ps -aq --filter label=com.qaap.namespace=stg | xargs -r $R rm -f >/dev/null
for i in $(seq 1 60); do
    c=$(curl -s -o /dev/null -w "%{http_code}" "https://staging.$H/" || true)
    [ "$c" = 200 ] && { echo "staging control plane up; tenants use: ${TENANT_IMAGE:-the deployed image}"; exit 0; }
    sleep 2
done
echo "staging did not answer 200 within 120 s" >&2
exit 4
'

if [ "${1:-}" = "--reset" ]; then
    ssh -o BatchMode=yes "$HOST" "bash -s -- ''" <<<"$REMOTE_APPLY"
    exit 0
fi

if [ "$#" -eq 0 ]; then
    echo "usage: $0 <qaap-package> [<qaap-package> ...] | --reset" >&2
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
    if (cd "$ROOT" && npx tsc -b "packages/$pkg" 2>&1 | grep -E '^packages/qaap-'); then
        echo "compile errors in $pkg" >&2
        exit 1
    fi
    LIBS+=("packages/$pkg/lib")
done

TAG="qaap-staging-hotpatch:$(date +%Y%m%d%H%M%S)"
echo "== building $TAG on $HOST from: ${LIBS[*]}"
started=$(date +%s)
COPYFILE_DISABLE=1 tar --no-xattrs -czf - -C "$ROOT" "${LIBS[@]}" | ssh -o BatchMode=yes "$HOST" "
set -eu
R='docker -H unix:///run/user/1000/docker.sock'
BASE=\$(docker inspect qaap-staging-theia --format '{{.Config.Image}}')
CTX=\$(mktemp -d)
trap 'rm -rf \"\$CTX\"' EXIT
tar xzf - -C \"\$CTX\"
printf 'FROM %s\nCOPY packages/ /app/packages/\n' \"\$BASE\" > \"\$CTX/Dockerfile\"
\$R build -q -t '$TAG' \"\$CTX\" >/dev/null
# Keep the three newest hot-patch images only.
\$R images qaap-staging-hotpatch --format '{{.Repository}}:{{.Tag}}' | sort -r | tail -n +4 | xargs -r \$R rmi >/dev/null 2>&1 || true
"
ssh -o BatchMode=yes "$HOST" "bash -s -- '$TAG'" <<<"$REMOTE_APPLY"
echo "== done in $(( $(date +%s) - started )) s; reload the staging tab (the first load recreates the tenant)"
