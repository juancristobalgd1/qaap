#!/usr/bin/env bash
# Deploy a release, verify the public signed-in workspace, and restore the previous release on failure.
#
# Usage:
#   qaap-vps-rollback.sh <branch> <revision> <image-ref> <public-url> <previous-repo-sha>
#   qaap-vps-rollback.sh --rollback-only <revision> <public-url> [reason]
#
# --rollback-only restores the release recorded by the last verified deploy of <revision>. The
# workflow uses it when the runner-side (external) verification fails after an on-VPS success.
#
# Exit codes: 0 verified, 1 blocked or rolled back, 3 manual intervention needed. Stdout carries
# QAAP_DEPLOY_RESULT=verified|rolled_back|manual|blocked, QAAP_DEPLOY_REASON and a summary block.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

MODE='deploy'
EXTERNAL_REASON=''
if [[ "${1:-}" == --rollback-only ]]; then
    MODE='rollback-only'
    BRANCH=''
    REVISION="${2:-}"
    IMAGE_REF=''
    PUBLIC_URL="${3:-${QAAP_VPS_PUBLIC_URL:-}}"
    EXTERNAL_REASON="${4:-external verification failed}"
    PREV_SHA=''
else
    BRANCH="${1:-${QAAP_DEPLOY_BRANCH:-master}}"
    REVISION="${2:-${QAAP_DEPLOY_SHA:-}}"
    IMAGE_REF="${3:-${QAAP_DEPLOY_IMAGE:-}}"
    PUBLIC_URL="${4:-${QAAP_VPS_PUBLIC_URL:-}}"
    PREV_SHA="${5:-${QAAP_DEPLOY_PREV_SHA:-}}"
fi
RESULT='blocked'
REASON='deploy did not start'
STATE_DIR="${QAAP_DEPLOY_STATE_DIR:-${XDG_STATE_HOME:-${HOME:-/root}/.local/state}/qaap-deploy}"
STATE_FILE="$STATE_DIR/rollback-target.env"

write_result() {
    local result="$1" reason="$2"
    reason="${reason//$'\n'/ }"
    printf 'QAAP_DEPLOY_RESULT=%s\nQAAP_DEPLOY_REASON=%s\n' "$result" "$reason"
}

write_summary() {
    printf '\nQAAP_DEPLOY_SUMMARY_START\n%s\nQAAP_DEPLOY_SUMMARY_END\n' "$1"
}

fail_before_deploy() {
    RESULT='blocked'
    REASON="$1"
    echo "[qaap-vps-rollback] deploy blocked: $1" >&2
    write_result "$RESULT" "$REASON"
    write_summary "## VPS deploy blocked

$1"
    exit 1
}

rollback_failed() {
    local reason="$1"
    RESULT='manual'
    REASON="$reason"
    echo "MANUAL INTERVENTION NEEDED: automatic rollback failed: $reason" >&2
    write_result "$RESULT" "$REASON"
    write_summary "## MANUAL INTERVENTION NEEDED

Automatic rollback failed: $reason

Previous target: build '${PRE_DEPLOY_BUILD:-unknown}', image '${PRE_DEPLOY_IMAGE_ID:-unknown}'.
Current theia image: '${CURRENT_IMAGE_ID:-unknown}'."
    exit 3
}

if [[ -z "${QAAP_SMOKE_SESSION:-}" && -z "${QAAP_SMOKE_COOKIE:-}" ]]; then
    fail_before_deploy 'QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is required; refusing to deploy without an authenticated workspace verification.'
fi
if [[ "$MODE" == deploy && ( ! "$REVISION" =~ ^[0-9a-f]{40}$ || -z "$IMAGE_REF" || -z "$PUBLIC_URL" ) ]]; then
    fail_before_deploy 'Deploy requires a full source SHA, immutable image reference, and public URL.'
fi
if [[ "$MODE" == rollback-only && ( ! "$REVISION" =~ ^[0-9a-f]{40}$ || -z "$PUBLIC_URL" ) ]]; then
    fail_before_deploy 'Rollback-only mode requires the full revision of the verified deploy and the public URL.'
fi

for command in docker curl python3 date git flock; do
    if ! command -v "$command" >/dev/null 2>&1; then
        fail_before_deploy "Required command not found: $command"
    fi
done

LOCK_FILE="${QAAP_DEPLOY_LOCK_FILE:-/run/lock/qaap-deploy.lock}"
if ! mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || ! { exec 9>"$LOCK_FILE"; } 2>/dev/null; then
    fail_before_deploy "Could not open deploy lock file: $LOCK_FILE"
fi
if ! flock -n 9; then
    fail_before_deploy "Another VPS deploy holds $LOCK_FILE; this deploy did not start."
fi

# shellcheck source=scripts/qaap-vps-normalize-public-url.sh
source "$SCRIPT_DIR/qaap-vps-normalize-public-url.sh"
# shellcheck source=scripts/qaap-vps-deploy-helpers.sh
source "$SCRIPT_DIR/qaap-vps-deploy-helpers.sh"
PUBLIC_URL="$(qaap_normalize_vps_public_url "$PUBLIC_URL")"
PUBLIC_URL="${PUBLIC_URL%/}"
if [[ -z "$PUBLIC_URL" ]]; then
    fail_before_deploy 'The public URL is empty after normalization; refusing to deploy.'
fi

VERIFY_TIMEOUT_SECONDS="${QAAP_VPS_VERIFY_TIMEOUT_SECONDS:-480}"
VERIFY_INTERVAL_SECONDS="${QAAP_VPS_VERIFY_INTERVAL_SECONDS:-10}"
if [[ ! "$VERIFY_TIMEOUT_SECONDS" =~ ^[0-9]+$ || "$VERIFY_TIMEOUT_SECONDS" -lt 1 ||
    ! "$VERIFY_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
    fail_before_deploy 'QAAP_VPS_VERIFY_TIMEOUT_SECONDS must be positive and QAAP_VPS_VERIFY_INTERVAL_SECONDS must be non-negative.'
fi

# Rollback checks out the previous repository revision. Run the verifiers from a snapshot of this
# revision so the restored release is judged by the same gates that judged the candidate.
TOOLS_DIR="$(mktemp -d -t qaap-vps-verify-tools.XXXXXXXX)"
DEPLOY_STARTED_AT_FILE=''
cleanup_temp_files() {
    rm -rf -- "$TOOLS_DIR"
    if [[ -n "${DEPLOY_STARTED_AT_FILE:-}" ]]; then
        rm -f -- "$DEPLOY_STARTED_AT_FILE"
    fi
}
trap cleanup_temp_files EXIT
for tool in qaap-vps-post-deploy-user-smoke.sh qaap-verify-launch-readiness.sh qaap-verify-auth-api-gate.sh qaap-release-config-check.js; do
    if [[ -f "$SCRIPT_DIR/$tool" ]]; then
        cp -p -- "$SCRIPT_DIR/$tool" "$TOOLS_DIR/$tool"
    fi
done

valid_build() {
    [[ "$1" =~ ^([0-9a-f]{40}|[0-9a-f]{12})$ ]]
}

builds_match() {
    local first="${1:0:12}" second="${2:0:12}"
    [[ "$first" == "$second" ]]
}

# LAST_VERIFY_FAILURE is 'credential' when the smoke session was rejected (HTTP 302/401/403).
LAST_VERIFY_FAILURE=''
verify_build_once() {
    local expected_build="$1" label="$2" smoke_status=0
    LAST_VERIFY_FAILURE=''
    echo "[qaap-vps-rollback] $label verification (expected build ${expected_build:0:12})"
    if ! command -v node >/dev/null 2>&1; then
        # The readiness payload check needs host Node.js. The runner-side external verification
        # always runs it and triggers --rollback-only when it fails.
        echo "[qaap-vps-rollback] WARNING: host Node.js not found; $label launch-readiness gate deferred to the external verification" >&2
    elif ! QAAP_BASE_URL="$PUBLIC_URL" QAAP_ENV_FILE="$REPO_DIR/.env" \
        bash "$TOOLS_DIR/qaap-verify-launch-readiness.sh"; then
        echo "[qaap-vps-rollback] $label launch-readiness gate failed" >&2
        LAST_VERIFY_FAILURE='launch-readiness'
        return 1
    fi
    if ! QAAP_BASE_URL="$PUBLIC_URL" bash "$TOOLS_DIR/qaap-verify-auth-api-gate.sh"; then
        echo "[qaap-vps-rollback] $label auth API gate failed" >&2
        LAST_VERIFY_FAILURE='auth-api'
        return 1
    fi
    bash "$TOOLS_DIR/qaap-vps-post-deploy-user-smoke.sh" "$PUBLIC_URL" "$expected_build" || smoke_status=$?
    if (( smoke_status == 3 )); then
        LAST_VERIFY_FAILURE='credential'
    elif (( smoke_status != 0 )); then
        LAST_VERIFY_FAILURE='smoke'
    fi
    return "$smoke_status"
}

verify_build_with_retries() {
    local expected_build="$1" label="$2" attempt=0 deadline=$((SECONDS + VERIFY_TIMEOUT_SECONDS))
    local max_attempts=$(( (VERIFY_TIMEOUT_SECONDS + VERIFY_INTERVAL_SECONDS - 1) / (VERIFY_INTERVAL_SECONDS > 0 ? VERIFY_INTERVAL_SECONDS : 1) + 1 ))
    while (( attempt < max_attempts )); do
        attempt=$((attempt + 1))
        echo "[qaap-vps-rollback] $label verification attempt $attempt/$max_attempts"
        if verify_build_once "$expected_build" "$label"; then
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

current_theia_image_id() {
    local container_id
    container_id="$(docker compose ps -q --status running theia | tr -d '\r' | sed -n '1p')" || return 1
    if [[ -n "$container_id" ]]; then
        docker inspect -f '{{.Image}}' "$container_id" 2>/dev/null
    fi
}

write_env_value() {
    local key="$1" value="$2" env_file="$REPO_DIR/.env" tmp_file
    tmp_file="$(mktemp "$REPO_DIR/.env.qaap.XXXXXXXX")"
    if [[ -f "$env_file" ]]; then
        awk -v key="$key" -v value="$value" -F= '
            $1 == key { if (!written) { print key "=" value; written=1 } next }
            { print }
            END { if (!written) print key "=" value }
        ' "$env_file" > "$tmp_file"
    else
        printf '%s=%s\n' "$key" "$value" > "$tmp_file"
    fi
    chmod 600 "$tmp_file"
    mv "$tmp_file" "$env_file"
}

restore_previous_compose() {
    if ! git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null; then
        return 1
    fi
    git checkout --detach "$PREV_SHA"
}

# Pin the protected rollback tags for this shell and for any later manual `docker compose up`.
pin_rollback_images() {
    export QAAP_THEIA_IMAGE='qaap-theia:rollback'
    export QAAP_TENANT_DOCKER_IMAGE='qaap-tenant:rollback'
    write_env_value QAAP_THEIA_IMAGE "$QAAP_THEIA_IMAGE"
    write_env_value QAAP_TENANT_DOCKER_IMAGE "$QAAP_TENANT_DOCKER_IMAGE"
}

# Persist what --rollback-only needs after this process has exited. Values are parsed, never sourced.
write_state() {
    local tmp_file
    mkdir -p "$STATE_DIR"
    tmp_file="$(mktemp "$STATE_DIR/rollback-target.XXXXXXXX")"
    printf '%s=%s\n' \
        REVISION "$REVISION" \
        PREV_SHA "$PREV_SHA" \
        PRE_DEPLOY_IMAGE_ID "$PRE_DEPLOY_IMAGE_ID" \
        PRE_DEPLOY_BUILD "$PRE_DEPLOY_BUILD" \
        ROOTLESS_DOCKER_HOST "$ROOTLESS_DOCKER_HOST" \
        DEPLOY_STARTED_NS "${DEPLOY_STARTED_NS:-}" \
        STATE_RESULT "$1" > "$tmp_file"
    chmod 600 "$tmp_file"
    mv "$tmp_file" "$STATE_FILE"
}

read_state_value() {
    sed -n "s/^$1=//p" "$STATE_FILE" | sed -n '1p'
}

# The router recreates `qaap-backend-*` from the image it was started with, so tenant containers
# created by the candidate must not survive into the restored release. Backends are stopped and
# renamed (their writable layer stays inspectable); tenant and ingress helpers are removed. Named
# volumes are never removed.
cleanup_new_rootless_tenant_containers() {
    local container_ids container_id details name created created_ns running
    local cleanup_failed=0 rootless_host="$ROOTLESS_DOCKER_HOST"
    if [[ ! "${DEPLOY_STARTED_NS:-}" =~ ^[0-9]+$ ]]; then
        echo '[qaap-vps-rollback] WARNING: deploy switch timestamp is missing; tenant cleanup was skipped' >&2
        return 1
    fi
    if ! container_ids="$(DOCKER_HOST="$rootless_host" docker ps -aq --no-trunc --filter 'name=^qaap-(backend|tenant|ingress)-' 2>&1)"; then
        echo "[qaap-vps-rollback] WARNING: could not list rootless tenant containers: $container_ids" >&2
        return 1
    fi
    while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        if ! details="$(DOCKER_HOST="$rootless_host" docker inspect --format '{{.Name}}|{{.Created}}|{{.State.Running}}' "$container_id" 2>&1)"; then
            if [[ "$details" == *'No such container'* ]]; then
                echo "[qaap-vps-rollback] rootless container $container_id disappeared before inspect; ignoring it"
                continue
            fi
            echo "[qaap-vps-rollback] WARNING: could not inspect rootless container $container_id: $details" >&2
            cleanup_failed=1
            continue
        fi
        IFS='|' read -r name created running <<< "$details"
        name="${name#/}"
        if [[ ! "$name" =~ ^qaap-(backend|tenant|ingress)- ]]; then
            continue
        fi
        if ! created_ns="$(date -u --date="$created" +%s%N 2>/dev/null)" || [[ ! "$created_ns" =~ ^[0-9]+$ ]]; then
            echo "[qaap-vps-rollback] WARNING: cannot parse creation time for rootless container $container_id ($created)" >&2
            cleanup_failed=1
            continue
        fi
        (( created_ns >= DEPLOY_STARTED_NS )) || continue

        if [[ "$running" == true ]]; then
            details="$(DOCKER_HOST="$rootless_host" docker stop -t 30 "$container_id" 2>&1)" || {
                if [[ "$details" == *'No such container'* ]]; then
                    echo "[qaap-vps-rollback] rootless container $container_id disappeared before stop; ignoring it"
                    continue
                fi
                echo "[qaap-vps-rollback] WARNING: could not stop rootless container $container_id: $details" >&2
                cleanup_failed=1
                continue
            }
        fi

        if [[ "$name" == *-rollback-* ]]; then
            # Already set aside by an earlier cleanup pass of this rollback.
            continue
        fi
        if [[ "$name" == qaap-backend-* ]]; then
            local renamed="${name}-rollback-${REVISION:0:12}"
            details="$(DOCKER_HOST="$rootless_host" docker rename "$container_id" "$renamed" 2>&1)" || {
                if [[ "$details" == *'No such container'* ]]; then
                    echo "[qaap-vps-rollback] rootless container $container_id disappeared before rename; ignoring it"
                    continue
                fi
                echo "[qaap-vps-rollback] WARNING: could not rename rootless backend $container_id: $details" >&2
                cleanup_failed=1
                continue
            }
            echo "[qaap-vps-rollback] stopped and renamed rootless backend $name ($container_id)"
        else
            details="$(DOCKER_HOST="$rootless_host" docker rm "$container_id" 2>&1)" || {
                if [[ "$details" == *'No such container'* ]]; then
                    echo "[qaap-vps-rollback] rootless container $container_id disappeared before removal; ignoring it"
                    continue
                fi
                echo "[qaap-vps-rollback] WARNING: could not remove rootless container $container_id: $details" >&2
                cleanup_failed=1
                continue
            }
            echo "[qaap-vps-rollback] removed rootless container $name ($container_id); volumes were left intact"
        fi
    done <<< "$container_ids"
    return "$cleanup_failed"
}

# A candidate image labelled `ai.qaap.rollback=unsafe` declares a data migration that the previous
# release cannot read. Starting old code on migrated volumes is worse than a failed release.
candidate_blocks_rollback() {
    local image_id="$1" policy
    [[ -n "$image_id" ]] || return 1
    policy="$(docker image inspect "$image_id" --format '{{ index .Config.Labels "ai.qaap.rollback" }}' 2>/dev/null || true)"
    [[ "$policy" == unsafe ]]
}

# Restore the previous release: drain and stop the candidate, set aside its tenant containers,
# restore the previous repository revision, Caddy and image pins, then verify the old build.
perform_rollback() {
    local trigger="$1"
    echo "[qaap-vps-rollback] $trigger; restoring build ${PRE_DEPLOY_BUILD:0:12}" >&2
    if candidate_blocks_rollback "$CURRENT_IMAGE_ID"; then
        rollback_failed "$trigger, and the candidate image is labelled ai.qaap.rollback=unsafe (irreversible data migration); automatic rollback was not attempted"
    fi

    DRAIN_TIMEOUT_SECONDS="${QAAP_ROLLBACK_DRAIN_TIMEOUT_SECONDS:-300}"
    DRAIN_ACTIVE=0
    if ! drain_agent_turns; then
        echo '[qaap-vps-rollback] WARNING: could not drain agent turns cleanly; proceeding with rollback' >&2
    fi
    # Stop the candidate first so its router cannot recreate tenant containers during cleanup.
    if ! docker compose stop -t 60 theia; then
        rollback_failed 'docker compose could not stop the new Theia service before tenant cleanup'
    fi
    DRAIN_ACTIVE=0

    CLEANUP_WARNING=0
    if ! cleanup_new_rootless_tenant_containers; then
        CLEANUP_WARNING=1
        echo '[qaap-vps-rollback] WARNING: tenant cleanup was incomplete; continuing to restore the previous Theia release' >&2
    fi

    if ! restore_previous_compose; then
        rollback_failed "could not restore previous repository revision $PREV_SHA"
    fi
    pin_rollback_images
    if ! refresh_caddy; then
        rollback_failed 'docker compose could not validate and refresh the previous Caddy configuration'
    fi
    if ! QAAP_THEIA_IMAGE="$QAAP_THEIA_IMAGE" QAAP_TENANT_DOCKER_IMAGE="$QAAP_TENANT_DOCKER_IMAGE" \
        docker compose up -d --no-build --no-deps --force-recreate theia; then
        rollback_failed "docker compose could not restore theia image $PRE_DEPLOY_IMAGE_ID"
    fi
    # Idempotent second pass: anything the candidate created after the first pass is set aside too.
    if ! cleanup_new_rootless_tenant_containers; then
        CLEANUP_WARNING=1
        echo '[qaap-vps-rollback] WARNING: tenant cleanup after restore was incomplete; previous Theia remains restored' >&2
    fi

    if ! verify_build_with_retries "$PRE_DEPLOY_BUILD" 'rollback'; then
        CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
        if [[ "$LAST_VERIFY_FAILURE" == credential && "$CANDIDATE_VERIFY_FAILURE" == credential ]]; then
            rollback_failed "both the candidate and the restored build ${PRE_DEPLOY_BUILD:0:12} rejected the smoke session (HTTP 302/401/403); the smoke credential most likely expired during the deploy. Renew it and verify the restored release manually"
        fi
        rollback_failed "the restored service did not pass launch readiness, auth API, and authenticated workspace verification for build ${PRE_DEPLOY_BUILD:0:12} (last failure: ${LAST_VERIFY_FAILURE:-unknown})"
    fi
    write_state rolled_back

    RESULT='rolled_back'
    REASON="restored previous build ${PRE_DEPLOY_BUILD:0:12}: $trigger"
    echo "ROLLED BACK to ${PRE_DEPLOY_BUILD:0:12} ($PRE_DEPLOY_IMAGE_ID)"
    write_result "$RESULT" "$REASON"
    local cleanup_note=''
    if (( CLEANUP_WARNING == 1 )); then
        cleanup_note="

WARNING: cleanup of one or more rootless tenant containers was incomplete. The rollback proceeded; inspect the deploy log for affected containers."
    fi
    write_summary "## Release rolled back automatically

Trigger: $trigger.

The previous Compose and Caddy configuration were restored, and Theia is serving build '${PRE_DEPLOY_BUILD:0:12}' from '${PRE_DEPLOY_IMAGE_ID}'. Launch readiness, auth API, health, and authenticated workspace checks passed.$cleanup_note

The deploy result is 'rolled_back'; the workflow remains red so the failed release stays visible."
    exit 1
}

PRE_DEPLOY_CONTAINER_ID=''
PRE_DEPLOY_IMAGE_ID=''
PRE_DEPLOY_BUILD=''
PRE_DEPLOY_TENANT_IMAGE=''
ROOTLESS_DOCKER_HOST=''
DEPLOY_STARTED_NS=''
CURRENT_IMAGE_ID=''
CANDIDATE_VERIFY_FAILURE=''
CLEANUP_WARNING=0

if [[ "$MODE" == rollback-only ]]; then
    if [[ ! -f "$STATE_FILE" ]]; then
        rollback_failed "no recorded rollback target at $STATE_FILE; external verification failed ($EXTERNAL_REASON)"
    fi
    if [[ "$(read_state_value REVISION)" != "$REVISION" || "$(read_state_value STATE_RESULT)" != verified ]]; then
        rollback_failed "the recorded rollback target does not belong to a verified deploy of ${REVISION:0:12}; external verification failed ($EXTERNAL_REASON)"
    fi
    PREV_SHA="$(read_state_value PREV_SHA)"
    PRE_DEPLOY_IMAGE_ID="$(read_state_value PRE_DEPLOY_IMAGE_ID)"
    PRE_DEPLOY_BUILD="$(read_state_value PRE_DEPLOY_BUILD)"
    ROOTLESS_DOCKER_HOST="$(read_state_value ROOTLESS_DOCKER_HOST)"
    DEPLOY_STARTED_NS="$(read_state_value DEPLOY_STARTED_NS)"
    if ! valid_build "$PRE_DEPLOY_BUILD" || [[ -z "$PRE_DEPLOY_IMAGE_ID" || ! "$PREV_SHA" =~ ^[0-9a-f]{40}$ ]]; then
        rollback_failed "the recorded rollback target is incomplete; external verification failed ($EXTERNAL_REASON)"
    fi
    CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
    perform_rollback "external verification from the GitHub runner failed after the on-VPS checks passed ($EXTERNAL_REASON)"
fi

if ! PRE_DEPLOY_CONTAINER_ID="$(docker compose ps -q --status running theia | tr -d '\r' | sed -n '1p')"; then
    fail_before_deploy 'Could not query the running theia service before deployment.'
fi
NO_ROLLBACK=0
if [[ -z "$PRE_DEPLOY_CONTAINER_ID" ]]; then
    if [[ "${QAAP_VPS_ALLOW_NO_ROLLBACK:-0}" == 1 ]]; then
        NO_ROLLBACK=1
        echo '[qaap-vps-rollback] no running theia container; explicit allow_no_rollback is active' >&2
    else
        fail_before_deploy 'No running theia container is available as a rollback target; use workflow_dispatch allow_no_rollback only for bootstrap or emergency hotfixes.'
    fi
fi

if (( NO_ROLLBACK == 0 )); then
    if ! PRE_DEPLOY_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$PRE_DEPLOY_CONTAINER_ID")" || [[ -z "$PRE_DEPLOY_IMAGE_ID" ]]; then
        if [[ "${QAAP_VPS_ALLOW_NO_ROLLBACK:-0}" == 1 ]]; then
            NO_ROLLBACK=1
        else
            fail_before_deploy "Could not capture the exact image id serving theia container $PRE_DEPLOY_CONTAINER_ID."
        fi
    fi
fi

if (( NO_ROLLBACK == 0 )) && ! docker image inspect "$PRE_DEPLOY_IMAGE_ID" >/dev/null; then
    if [[ "${QAAP_VPS_ALLOW_NO_ROLLBACK:-0}" == 1 ]]; then
        NO_ROLLBACK=1
    else
        fail_before_deploy "Captured theia image id is unavailable for rollback: $PRE_DEPLOY_IMAGE_ID"
    fi
fi

if (( NO_ROLLBACK == 0 )); then
    PRE_DEPLOY_LABEL_BUILD="$(docker image inspect "$PRE_DEPLOY_IMAGE_ID" \
        --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
    PRE_DEPLOY_HEALTH_BUILD=''
    if HEALTH_PAYLOAD="$(curl --silent --show-error --fail --max-time 15 "$PUBLIC_URL/qaap/api/health" 2>/dev/null)"; then
        PRE_DEPLOY_HEALTH_BUILD="$(printf '%s' "$HEALTH_PAYLOAD" | python3 -c 'import json,re,sys; payload=json.load(sys.stdin); build=payload.get("build", "") if isinstance(payload, dict) else ""; print(build if re.fullmatch(r"[0-9a-f]{12}|[0-9a-f]{40}", build) else "")' 2>/dev/null || true)"
    fi
    if valid_build "$PRE_DEPLOY_HEALTH_BUILD"; then
        PRE_DEPLOY_BUILD="$PRE_DEPLOY_HEALTH_BUILD"
        if valid_build "$PRE_DEPLOY_LABEL_BUILD" && ! builds_match "$PRE_DEPLOY_BUILD" "$PRE_DEPLOY_LABEL_BUILD"; then
            fail_before_deploy "The serving health build $PRE_DEPLOY_BUILD does not match its OCI revision label $PRE_DEPLOY_LABEL_BUILD."
        fi
    elif valid_build "$PRE_DEPLOY_LABEL_BUILD"; then
        PRE_DEPLOY_BUILD="$PRE_DEPLOY_LABEL_BUILD"
    else
        if [[ "${QAAP_VPS_ALLOW_NO_ROLLBACK:-0}" == 1 ]]; then
            NO_ROLLBACK=1
        else
            fail_before_deploy 'Could not record a valid build from /qaap/api/health or the OCI revision label; refusing a release that cannot be verified after rollback.'
        fi
    fi
fi

if (( NO_ROLLBACK == 0 )); then
    # Tenants run in a separate rootless daemon. Record the tenant image the serving router really
    # uses and the host-side socket of that daemon, so rollback restores and protects both.
    if ! PRE_DEPLOY_ENV="$(docker inspect "$PRE_DEPLOY_CONTAINER_ID" --format '{{range .Config.Env}}{{println .}}{{end}}')"; then
        fail_before_deploy 'Could not read the running theia container environment needed to protect the rootless tenant image.'
    fi
    PRE_DEPLOY_TENANT_IMAGE="$(printf '%s\n' "$PRE_DEPLOY_ENV" | sed -n 's/^QAAP_TENANT_DOCKER_IMAGE=//p' | sed -n '1p')"
    ROOTLESS_DOCKER_HOST="${QAAP_ROOTLESS_DOCKER_HOST:-}"
    if [[ -z "$ROOTLESS_DOCKER_HOST" ]]; then
        CONTAINER_DOCKER_HOST="$(printf '%s\n' "$PRE_DEPLOY_ENV" | sed -n 's/^DOCKER_HOST=//p' | sed -n '1p')"
        ROOTLESS_DOCKER_HOST="$CONTAINER_DOCKER_HOST"
        if [[ "$CONTAINER_DOCKER_HOST" == unix://* ]]; then
            # The socket path inside Theia may differ from the host path (QAAP_DOCKER_SOCKET_SOURCE).
            SOCKET_SOURCE="$(docker inspect "$PRE_DEPLOY_CONTAINER_ID" \
                --format '{{range .Mounts}}{{.Source}}|{{.Destination}}{{println}}{{end}}' 2>/dev/null \
                | awk -F'|' -v target="${CONTAINER_DOCKER_HOST#unix://}" '$2 == target { print $1; exit }' || true)"
            if [[ -n "$SOCKET_SOURCE" ]]; then
                ROOTLESS_DOCKER_HOST="unix://$SOCKET_SOURCE"
            fi
        fi
    fi
    if [[ -z "$PRE_DEPLOY_TENANT_IMAGE" || -z "$ROOTLESS_DOCKER_HOST" ]]; then
        fail_before_deploy 'The running theia container does not expose its rootless Docker endpoint and tenant image; rollback cannot be protected safely.'
    fi
    if ! DOCKER_HOST="$ROOTLESS_DOCKER_HOST" docker info >/dev/null 2>&1; then
        fail_before_deploy "Rootless Docker endpoint is unavailable to the deploy user: $ROOTLESS_DOCKER_HOST (set QAAP_ROOTLESS_DOCKER_HOST if the host path differs)"
    fi
    if ! DOCKER_HOST="$ROOTLESS_DOCKER_HOST" docker image inspect "$PRE_DEPLOY_TENANT_IMAGE" >/dev/null 2>&1; then
        fail_before_deploy "The previous tenant image is missing from rootless Docker: $PRE_DEPLOY_TENANT_IMAGE"
    fi
fi

if [[ ! "$PREV_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    if (( NO_ROLLBACK == 0 )); then
        fail_before_deploy 'Deploy requires PREV_SHA so rollback can restore the previous Compose and Caddy configuration.'
    fi
    PREV_SHA="$(git rev-parse HEAD)"
fi

echo "[qaap-vps-rollback] captured previous serving image id: ${PRE_DEPLOY_IMAGE_ID:-none}"
if (( NO_ROLLBACK == 0 )); then
    echo "[qaap-vps-rollback] captured previous serving build: ${PRE_DEPLOY_BUILD:0:12}"
    echo "[qaap-vps-rollback] captured previous tenant image: $PRE_DEPLOY_TENANT_IMAGE"
fi
echo "[qaap-vps-rollback] deploying $REVISION from $IMAGE_REF"

# One attempt against the release that is serving now. If the smoke credential is expired, or the
# VPS cannot reach its own public URL, block here instead of rolling back a healthy release later.
if (( NO_ROLLBACK == 0 )) && ! verify_build_once "$PRE_DEPLOY_BUILD" 'preflight'; then
    if [[ "$LAST_VERIFY_FAILURE" == credential ]]; then
        fail_before_deploy 'Pre-deploy authenticated smoke was rejected (HTTP 302/401/403) by the current release. The smoke cookie or session is expired; renew QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE. No deployment changes were made.'
    fi
    fail_before_deploy "Pre-deploy verification failed against the current release (${LAST_VERIFY_FAILURE:-unknown} check). Fix the serving release or the VPS's access to its public URL before deploying. No deployment changes were made."
fi

if (( NO_ROLLBACK == 0 )); then
    if ! docker tag "$PRE_DEPLOY_IMAGE_ID" qaap-theia:rollback; then
        fail_before_deploy "Could not protect the previous Theia image with qaap-theia:rollback: $PRE_DEPLOY_IMAGE_ID"
    fi
    if ! DOCKER_HOST="$ROOTLESS_DOCKER_HOST" docker tag "$PRE_DEPLOY_TENANT_IMAGE" qaap-tenant:rollback; then
        fail_before_deploy "Could not protect the previous tenant image in rootless Docker: $PRE_DEPLOY_TENANT_IMAGE"
    fi
    write_state started
fi

DEPLOY_STARTED_AT_FILE="$(mktemp -t qaap-vps-deploy-started.XXXXXXXX)"
rm -f -- "$DEPLOY_STARTED_AT_FILE"
export QAAP_VPS_DEPLOY_STARTED_AT_FILE="$DEPLOY_STARTED_AT_FILE"

DEPLOY_STATUS=0
"$SCRIPT_DIR/qaap-vps-update.sh" --branch "$BRANCH" --revision "$REVISION" --image "$IMAGE_REF" || DEPLOY_STATUS=$?
DEPLOY_STARTED_NS="$(cat "$DEPLOY_STARTED_AT_FILE" 2>/dev/null || true)"

if (( DEPLOY_STATUS == 0 )) && verify_build_with_retries "$REVISION" 'new release'; then
    RESULT='verified'
    REASON="build ${REVISION:0:12} passed launch readiness, auth API, health, and authenticated workspace checks"
    echo "[qaap-vps-rollback] deploy verified; build ${REVISION:0:12} is serving authenticated workspaces"
    write_result "$RESULT" "$REASON"
    if (( NO_ROLLBACK == 1 )); then
        write_summary "## VPS deploy verified (rollback disabled)

Build '${REVISION:0:12}' is serving and all release checks passed. This deploy used the explicit allow_no_rollback override; no previous image was available as an automatic rollback target."
    else
        write_state verified
        write_summary "## VPS deploy verified

Build '${REVISION:0:12}' is serving. Launch readiness, auth API, public health, and authenticated workspace checks passed.

Previous rollback image retained as 'qaap-theia:rollback': '${PRE_DEPLOY_IMAGE_ID}' (build '${PRE_DEPLOY_BUILD:0:12}')."
    fi
    exit 0
fi
CANDIDATE_VERIFY_FAILURE="$LAST_VERIFY_FAILURE"

if (( NO_ROLLBACK == 1 )); then
    rollback_failed 'the new release failed verification and this deploy explicitly has no automatic rollback target'
fi

if (( DEPLOY_STATUS != 0 )); then
    echo "[qaap-vps-rollback] update script exited $DEPLOY_STATUS; checking the running image and previous service health" >&2
fi
CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
if [[ "$CURRENT_IMAGE_ID" == "$PRE_DEPLOY_IMAGE_ID" ]]; then
    # The update failed before switching (or Compose was a no-op). Caddy may already carry the new
    # configuration, so restore the previous revision and prove the old release still serves.
    if ! restore_previous_compose; then
        rollback_failed "could not restore previous repository revision $PREV_SHA after the image stayed unchanged"
    fi
    pin_rollback_images
    if ! refresh_caddy; then
        rollback_failed 'could not restore previous Caddy configuration while the Theia image stayed unchanged'
    fi
    if verify_build_with_retries "$PRE_DEPLOY_BUILD" 'unchanged release'; then
        RESULT='blocked'
        REASON="verification failed and image was unchanged; update exited $DEPLOY_STATUS"
        echo '[qaap-vps-rollback] verification failed, image unchanged; previous service is healthy' >&2
        write_result "$RESULT" "$REASON"
        write_summary "## VPS deploy failed before image switch: verification failed, image unchanged

The update exited with status '$DEPLOY_STATUS'. The previous release still passes verification; no image rollback was needed."
        exit 1
    fi
    CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
    rollback_failed 'the image did not change, but launch readiness, auth API, or the previous authenticated workspace smoke failed'
fi

if (( DEPLOY_STATUS != 0 )); then
    perform_rollback "the update script exited $DEPLOY_STATUS after switching the Theia image"
fi
perform_rollback "post-deploy verification of build ${REVISION:0:12} failed (${CANDIDATE_VERIFY_FAILURE:-unknown} check)"
