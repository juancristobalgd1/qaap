#!/usr/bin/env bash
# Deploy a release, verify the public signed-in workspace, and restore the previous image on failure.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRANCH="${1:-${QAAP_DEPLOY_BRANCH:-master}}"
REVISION="${2:-${QAAP_DEPLOY_SHA:-}}"
IMAGE_REF="${3:-${QAAP_DEPLOY_IMAGE:-}}"
PUBLIC_URL="${4:-${QAAP_VPS_PUBLIC_URL:-}}"

write_summary() {
    printf '\nQAAP_DEPLOY_SUMMARY_START\n%s\nQAAP_DEPLOY_SUMMARY_END\n' "$1"
}

fail_before_deploy() {
    echo "::error::$1" >&2
    write_summary "## VPS deploy blocked

$1"
    exit 1
}

if [[ -z "${QAAP_SMOKE_SESSION:-}" && -z "${QAAP_SMOKE_COOKIE:-}" ]]; then
    fail_before_deploy 'QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is required; refusing to deploy without an authenticated workspace verification.'
fi
if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ || -z "$IMAGE_REF" || -z "$PUBLIC_URL" ]]; then
    fail_before_deploy 'Deploy requires a full source SHA, immutable image reference, and public URL.'
fi

for command in docker curl python3 date; do
    if ! command -v "$command" >/dev/null 2>&1; then
        fail_before_deploy "Required command not found: $command"
    fi
done

# shellcheck source=scripts/qaap-vps-normalize-public-url.sh
source "$SCRIPT_DIR/qaap-vps-normalize-public-url.sh"
PUBLIC_URL="$(qaap_normalize_vps_public_url "$PUBLIC_URL")"
PUBLIC_URL="${PUBLIC_URL%/}"

PRE_DEPLOY_CONTAINER_ID="$(docker compose ps -q --status running theia 2>/dev/null | tr -d '\r' | sed -n '1p' || true)"
if [[ -z "$PRE_DEPLOY_CONTAINER_ID" ]]; then
    PRE_DEPLOY_CONTAINER_ID="$(docker compose ps -aq theia 2>/dev/null | tr -d '\r' | sed -n '1p' || true)"
fi
if [[ -z "$PRE_DEPLOY_CONTAINER_ID" ]]; then
    fail_before_deploy 'Could not identify the currently serving theia container; automatic rollback has no target image.'
fi
PRE_DEPLOY_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$PRE_DEPLOY_CONTAINER_ID" 2>/dev/null || true)"
if [[ -z "$PRE_DEPLOY_IMAGE_ID" ]]; then
    fail_before_deploy "Could not capture the exact image id serving theia container $PRE_DEPLOY_CONTAINER_ID."
fi
if ! docker image inspect "$PRE_DEPLOY_IMAGE_ID" >/dev/null 2>&1; then
    fail_before_deploy "Captured theia image id is unavailable for rollback: $PRE_DEPLOY_IMAGE_ID"
fi

PRE_DEPLOY_BUILD="$(docker image inspect "$PRE_DEPLOY_IMAGE_ID" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
if [[ ! "$PRE_DEPLOY_BUILD" =~ ^([0-9a-f]{40}|[0-9a-f]{12})$ ]]; then
    PRE_DEPLOY_BUILD="$(curl --fail --silent --show-error --max-time 15 \
        "$PUBLIC_URL/qaap/api/auth/config" 2>/dev/null \
        | python3 -c 'import json,re,sys; payload=json.load(sys.stdin); build=payload.get("build", "") if isinstance(payload, dict) else ""; print(build if re.fullmatch(r"[0-9a-f]{12}|[0-9a-f]{40}", build) else "")' \
        2>/dev/null || true)"
fi
if [[ ! "$PRE_DEPLOY_BUILD" =~ ^([0-9a-f]{40}|[0-9a-f]{12})$ ]]; then
    fail_before_deploy 'Could not record the build currently serving before deployment; refusing a release that cannot be verified after rollback.'
fi

echo "[qaap-vps-rollback] captured previous serving image id: $PRE_DEPLOY_IMAGE_ID"
echo "[qaap-vps-rollback] captured previous serving build: ${PRE_DEPLOY_BUILD:0:12}"
echo "[qaap-vps-rollback] deploying $REVISION from $IMAGE_REF"

DEPLOY_STARTED_AT_FILE="$(mktemp -t qaap-vps-deploy-started.XXXXXXXX)"
rm -f -- "$DEPLOY_STARTED_AT_FILE"
cleanup_marker() {
    if [[ -n "${DEPLOY_STARTED_AT_FILE:-}" ]]; then
        rm -f -- "$DEPLOY_STARTED_AT_FILE"
    fi
}
trap cleanup_marker EXIT

VERIFY_TIMEOUT_SECONDS="${QAAP_VPS_VERIFY_TIMEOUT_SECONDS:-480}"
VERIFY_INTERVAL_SECONDS="${QAAP_VPS_VERIFY_INTERVAL_SECONDS:-10}"
if [[ ! "$VERIFY_TIMEOUT_SECONDS" =~ ^[0-9]+$ || "$VERIFY_TIMEOUT_SECONDS" -lt 1 ||
    ! "$VERIFY_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
    fail_before_deploy 'QAAP_VPS_VERIFY_TIMEOUT_SECONDS must be positive and QAAP_VPS_VERIFY_INTERVAL_SECONDS must be non-negative.'
fi

export QAAP_VPS_DEPLOY_STARTED_AT_FILE="$DEPLOY_STARTED_AT_FILE"
DEPLOY_STATUS=0
"$SCRIPT_DIR/qaap-vps-update.sh" --branch "$BRANCH" --revision "$REVISION" --image "$IMAGE_REF" || DEPLOY_STATUS=$?

current_theia_image_id() {
    local container_id
    container_id="$(docker compose ps -q --status running theia 2>/dev/null | tr -d '\r' | sed -n '1p' || true)"
    if [[ -z "$container_id" ]]; then
        container_id="$(docker compose ps -aq theia 2>/dev/null | tr -d '\r' | sed -n '1p' || true)"
    fi
    if [[ -n "$container_id" ]]; then
        docker inspect -f '{{.Image}}' "$container_id" 2>/dev/null || true
    fi
}

verify_build_with_retries() {
    local expected_build="$1" label="$2" attempt=0 deadline=$((SECONDS + VERIFY_TIMEOUT_SECONDS))
    local max_attempts=$(( (VERIFY_TIMEOUT_SECONDS + VERIFY_INTERVAL_SECONDS - 1) / (VERIFY_INTERVAL_SECONDS > 0 ? VERIFY_INTERVAL_SECONDS : 1) + 1 ))
    while (( attempt < max_attempts )); do
        attempt=$((attempt + 1))
        echo "[qaap-vps-rollback] $label verification attempt $attempt (expected build ${expected_build:0:12})"
        if "$SCRIPT_DIR/qaap-vps-post-deploy-user-smoke.sh" "$PUBLIC_URL" "$expected_build"; then
            return 0
        fi
        if (( SECONDS >= deadline )); then
            break
        fi
        local wait_seconds="$VERIFY_INTERVAL_SECONDS"
        local remaining=$((deadline - SECONDS))
        if (( wait_seconds > remaining )); then
            wait_seconds="$remaining"
        fi
        if (( wait_seconds > 0 )); then
            sleep "$wait_seconds"
        fi
    done
    return 1
}

if (( DEPLOY_STATUS == 0 )) && verify_build_with_retries "$REVISION" 'new release'; then
    echo "[qaap-vps-rollback] deploy verified; build ${REVISION:0:12} is serving authenticated workspaces"
    write_summary "## VPS deploy verified

Build \`${REVISION:0:12}\` is serving. The public health payload and authenticated workspace smoke both passed.

Previous rollback image retained: \`${PRE_DEPLOY_IMAGE_ID}\` (build \`${PRE_DEPLOY_BUILD:0:12}\`)."
    exit 0
fi

if (( DEPLOY_STATUS != 0 )); then
    echo "[qaap-vps-rollback] update script exited $DEPLOY_STATUS; checking whether theia changed before deciding to roll back" >&2
fi
CURRENT_IMAGE_ID="$(current_theia_image_id)"
if [[ "$CURRENT_IMAGE_ID" == "$PRE_DEPLOY_IMAGE_ID" ]]; then
    echo "[qaap-vps-rollback] theia still serves the previous image; no rollback was needed" >&2
    write_summary "## VPS deploy failed before image switch

The update exited with status \`${DEPLOY_STATUS:-1}\`; theia still serves previous build \`${PRE_DEPLOY_BUILD:0:12}\` (\`${PRE_DEPLOY_IMAGE_ID}\`)."
    exit "${DEPLOY_STATUS:-1}"
fi

echo "[qaap-vps-rollback] post-deploy verification failed; restoring $PRE_DEPLOY_IMAGE_ID" >&2

rollback_failed() {
    local reason="$1"
    echo "MANUAL INTERVENTION NEEDED: automatic rollback failed: $reason" >&2
    write_summary "## MANUAL INTERVENTION NEEDED

Automatic rollback failed: $reason

Previous target: build \`${PRE_DEPLOY_BUILD:0:12}\`, image \`${PRE_DEPLOY_IMAGE_ID}\`.
Current theia image: \`${CURRENT_IMAGE_ID:-unknown}\`."
    exit 2
}

cleanup_new_rootless_tenant_containers() {
    local rootless_host='unix:///run/user/1000/docker.sock'
    local container_ids container_id details name created created_ns deploy_started_ns
    deploy_started_ns="$(cat "$DEPLOY_STARTED_AT_FILE" 2>/dev/null || true)"
    if [[ ! "$deploy_started_ns" =~ ^[0-9]+$ ]]; then
        echo '[qaap-vps-rollback] deploy switch timestamp is missing; cannot safely select new rootless tenant containers' >&2
        return 1
    fi
    if ! container_ids="$(DOCKER_HOST="$rootless_host" docker ps -aq --no-trunc)"; then
        echo '[qaap-vps-rollback] could not list rootless Docker containers' >&2
        return 1
    fi
    while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        if ! details="$(DOCKER_HOST="$rootless_host" docker inspect --format '{{.Name}}|{{.Created}}' "$container_id")"; then
            echo "[qaap-vps-rollback] could not inspect rootless container $container_id" >&2
            return 1
        fi
        IFS='|' read -r name created <<< "$details"
        name="${name#/}"
        case "$name" in
            qaap-backend-*|qaap-tenant-*|qaap-ingress-*) ;;
            *) continue ;;
        esac
        if ! created_ns="$(date -u --date="$created" +%s%N 2>/dev/null)" || [[ ! "$created_ns" =~ ^[0-9]+$ ]]; then
            echo "[qaap-vps-rollback] cannot parse creation time for rootless container $container_id ($created)" >&2
            return 1
        fi
        if (( created_ns >= deploy_started_ns )); then
            # No `-v`: remove only the ephemeral container, preserving every tenant volume and data directory.
            if ! DOCKER_HOST="$rootless_host" docker rm --force "$container_id"; then
                echo "[qaap-vps-rollback] could not remove new rootless tenant container $container_id" >&2
                return 1
            fi
            echo "[qaap-vps-rollback] removed new rootless container $name ($container_id); volumes were left intact"
        fi
    done <<< "$container_ids"
}

if ! cleanup_new_rootless_tenant_containers; then
    rollback_failed 'could not safely remove rootless tenant containers created during the failed release'
fi

if ! QAAP_THEIA_IMAGE="$PRE_DEPLOY_IMAGE_ID" QAAP_TENANT_DOCKER_IMAGE="$PRE_DEPLOY_IMAGE_ID" \
    docker compose up -d --no-build theia; then
    rollback_failed "docker compose could not restore theia image $PRE_DEPLOY_IMAGE_ID"
fi

if ! verify_build_with_retries "$PRE_DEPLOY_BUILD" 'rollback'; then
    CURRENT_IMAGE_ID="$(current_theia_image_id)"
    rollback_failed "the restored service did not report build ${PRE_DEPLOY_BUILD:0:12} with a passing authenticated workspace smoke"
fi

echo "ROLLED BACK to ${PRE_DEPLOY_BUILD:0:12} ($PRE_DEPLOY_IMAGE_ID)"
write_summary "## Release rolled back automatically

The new release failed public health or authenticated workspace verification. Docker Compose restored theia to build \`${PRE_DEPLOY_BUILD:0:12}\` from image \`${PRE_DEPLOY_IMAGE_ID}\`; health and the authenticated workspace smoke passed.

The deploy job intentionally exits red after recovery so the failed release remains visible."
exit 1
