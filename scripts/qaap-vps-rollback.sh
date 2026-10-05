#!/usr/bin/env bash
# Deploy a release, verify it, and restore the last verified release on failure.
#
# Usage:
#   qaap-vps-rollback.sh <branch> <revision> <image-ref> <public-url>
#   qaap-vps-rollback.sh --rollback-only <revision> <public-url> [reason]
#
# <image-ref> must be an immutable GHCR reference (`name:tag@sha256:<digest>`).
#
# Rollback target: the last release whose deploy passed health/build, launch readiness, the auth API
# gate AND the signed-in user smoke, recorded in $STATE_DIR/last-good-release.env. A release whose
# user smoke was skipped (no QAAP_SMOKE_SESSION/QAAP_SMOKE_COOKIE) is verified but never recorded.
# A skipped smoke never triggers a rollback; a failed health/build/gate check does. Rollback only
# starts Compose with QAAP_THEIA_IMAGE=<recorded digest ref> and --no-build.
#
# --rollback-only restores the target recorded by the last verified deploy of <revision>. The
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
else
    BRANCH="${1:-${QAAP_DEPLOY_BRANCH:-master}}"
    REVISION="${2:-${QAAP_DEPLOY_SHA:-}}"
    IMAGE_REF="${3:-${QAAP_DEPLOY_IMAGE:-}}"
    PUBLIC_URL="${4:-${QAAP_VPS_PUBLIC_URL:-}}"
fi
RESULT='blocked'
REASON='deploy did not start'
STATE_DIR="${QAAP_DEPLOY_STATE_DIR:-${XDG_STATE_HOME:-${HOME:-/root}/.local/state}/qaap-deploy}"
STATE_FILE="$STATE_DIR/rollback-target.env"
LAST_GOOD_FILE="$STATE_DIR/last-good-release.env"
# The image cleanup in qaap-vps-update.sh keeps the image recorded here.
export QAAP_LAST_GOOD_RELEASE_FILE="$LAST_GOOD_FILE"
IMMUTABLE_REF_PATTERN='^[^@[:space:]]+@sha256:[0-9a-f]{64}$'

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
    echo "MANUAL INTERVENTION NEEDED: $reason" >&2
    write_result "$RESULT" "$REASON"
    write_summary "## MANUAL INTERVENTION NEEDED

$reason

Rollback target (last release that passed health and user smoke): ${TARGET_IMAGE_REF:-none recorded}.
Current theia image: '${CURRENT_IMAGE_ID:-unknown}'."
    exit 3
}

if [[ "$MODE" == deploy && ( ! "$REVISION" =~ ^[0-9a-f]{40}$ || ! "$IMAGE_REF" =~ $IMMUTABLE_REF_PATTERN || -z "$PUBLIC_URL" ) ]]; then
    fail_before_deploy 'Deploy requires a full source SHA, an immutable image reference (name:tag@sha256:<digest>), and the public URL.'
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

if [[ -z "${QAAP_SMOKE_SESSION:-}" && -z "${QAAP_SMOKE_COOKIE:-}" ]]; then
    echo '[qaap-vps-rollback] WARNING: user smoke skipped (no smoke credentials); health and release gates still decide rollback, and this release cannot become a rollback target' >&2
fi

# Rollback checks out the target revision. Run the verifiers from a snapshot of this revision so
# the restored release is judged by the same gates that judged the candidate.
TOOLS_DIR="$(mktemp -d -t qaap-vps-verify-tools.XXXXXXXX)"
DEPLOY_STARTED_AT_FILE=''
SMOKE_OUTPUT_FILE="$TOOLS_DIR/smoke.out"
cleanup_temp_files() {
    rm -rf -- "$TOOLS_DIR"
    if [[ -n "${DEPLOY_STARTED_AT_FILE:-}" ]]; then
        rm -f -- "$DEPLOY_STARTED_AT_FILE"
    fi
}
trap 'undo_drain_on_failure; cleanup_temp_files' EXIT
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

# LAST_VERIFY_FAILURE: launch-readiness | auth-api | smoke | credential (session rejected, exit 3).
# LAST_SMOKE_RESULT: passed | skipped (no smoke credentials) after a successful verification.
LAST_VERIFY_FAILURE=''
LAST_SMOKE_RESULT=''
verify_build_once() {
    local expected_build="$1" label="$2" smoke_status=0
    LAST_VERIFY_FAILURE=''
    LAST_SMOKE_RESULT=''
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
    bash "$TOOLS_DIR/qaap-vps-post-deploy-user-smoke.sh" "$PUBLIC_URL" "$expected_build" \
        > "$SMOKE_OUTPUT_FILE" 2>&1 || smoke_status=$?
    cat "$SMOKE_OUTPUT_FILE"
    if (( smoke_status == 3 )); then
        LAST_VERIFY_FAILURE='credential'
    elif (( smoke_status != 0 )); then
        LAST_VERIFY_FAILURE='smoke'
    elif grep -Fxq 'QAAP_USER_SMOKE=passed' "$SMOKE_OUTPUT_FILE"; then
        LAST_SMOKE_RESULT='passed'
    else
        LAST_SMOKE_RESULT='skipped'
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
        if [[ "$LAST_VERIFY_FAILURE" == credential ]]; then
            # A rejected session does not recover by waiting.
            break
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

running_theia_container() {
    docker compose ps -q --status running theia | tr -d '\r' | sed -n '1p'
}

current_theia_image_id() {
    local container_id
    container_id="$(running_theia_container)" || return 1
    if [[ -n "$container_id" ]]; then
        docker inspect -f '{{.Image}}' "$container_id" 2>/dev/null
    fi
}

image_id_of() {
    if [[ -n "${2:-}" ]]; then
        DOCKER_HOST="$2" docker image inspect "$1" --format '{{.Id}}' 2>/dev/null
    else
        docker image inspect "$1" --format '{{.Id}}' 2>/dev/null
    fi
}

container_env_value() {
    docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
        | sed -n "s/^$2=//p" | sed -n '1p'
}

# Host-side endpoint of the rootless tenant daemon used by a Theia container. The socket path
# inside Theia may differ from the host path (QAAP_DOCKER_SOCKET_SOURCE).
rootless_host_for_container() {
    local container_id="$1" container_host socket_source
    if [[ -n "${QAAP_ROOTLESS_DOCKER_HOST:-}" ]]; then
        printf '%s\n' "$QAAP_ROOTLESS_DOCKER_HOST"
        return 0
    fi
    container_host="$(container_env_value "$container_id" DOCKER_HOST)"
    if [[ "$container_host" == unix://* ]]; then
        socket_source="$(docker inspect "$container_id" \
            --format '{{range .Mounts}}{{.Source}}|{{.Destination}}{{println}}{{end}}' 2>/dev/null \
            | awk -F'|' -v target="${container_host#unix://}" '$2 == target { print $1; exit }' || true)"
        if [[ -n "$socket_source" ]]; then
            container_host="unix://$socket_source"
        fi
    fi
    printf '%s\n' "$container_host"
}

# Key=value state files are parsed, never sourced.
state_value() {
    sed -n "s/^$2=//p" "$1" 2>/dev/null | sed -n '1p'
}

write_kv_file() {
    local target="$1" tmp_file
    shift
    mkdir -p "$STATE_DIR"
    tmp_file="$(mktemp "$STATE_DIR/.state.XXXXXXXX")"
    printf '%s=%s\n' "$@" > "$tmp_file"
    chmod 600 "$tmp_file"
    mv "$tmp_file" "$target"
}

TARGET_REVISION=''
TARGET_IMAGE_REF=''
TARGET_IMAGE_ID=''
TARGET_TENANT_IMAGE=''
TARGET_ROOTLESS_DOCKER_HOST=''
TARGET_VERIFIED_AT=''

# Loads the target from a state file ($1) whose keys carry an optional prefix ($2). Returns 1 and
# clears the target when the record is absent or incomplete.
load_target() {
    local file="$1" prefix="${2:-}"
    TARGET_REVISION="$(state_value "$file" "${prefix}REVISION")"
    TARGET_IMAGE_REF="$(state_value "$file" "${prefix}IMAGE_REF")"
    TARGET_IMAGE_ID="$(state_value "$file" "${prefix}IMAGE_ID")"
    TARGET_TENANT_IMAGE="$(state_value "$file" "${prefix}TENANT_IMAGE")"
    TARGET_ROOTLESS_DOCKER_HOST="$(state_value "$file" "${prefix}ROOTLESS_DOCKER_HOST")"
    TARGET_VERIFIED_AT="$(state_value "$file" "${prefix}VERIFIED_AT")"
    if [[ "$TARGET_REVISION" =~ ^[0-9a-f]{40}$ && "$TARGET_IMAGE_REF" =~ $IMMUTABLE_REF_PATTERN &&
        "$TARGET_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ && -n "$TARGET_TENANT_IMAGE" && -n "$TARGET_ROOTLESS_DOCKER_HOST" ]]; then
        return 0
    fi
    TARGET_REVISION=''
    TARGET_IMAGE_REF=''
    TARGET_IMAGE_ID=''
    TARGET_TENANT_IMAGE=''
    TARGET_ROOTLESS_DOCKER_HOST=''
    TARGET_VERIFIED_AT=''
    return 1
}

has_target() {
    [[ -n "$TARGET_IMAGE_REF" ]]
}

target_fields() {
    printf '%s\n' \
        "${1}REVISION" "$TARGET_REVISION" \
        "${1}IMAGE_REF" "$TARGET_IMAGE_REF" \
        "${1}IMAGE_ID" "$TARGET_IMAGE_ID" \
        "${1}TENANT_IMAGE" "$TARGET_TENANT_IMAGE" \
        "${1}ROOTLESS_DOCKER_HOST" "$TARGET_ROOTLESS_DOCKER_HOST" \
        "${1}VERIFIED_AT" "$TARGET_VERIFIED_AT"
}

write_last_good_from_target() {
    local -a fields
    mapfile -t fields < <(target_fields '')
    write_kv_file "$LAST_GOOD_FILE" "${fields[@]}"
}

# Persist what --rollback-only needs after this process has exited.
write_state() {
    local -a fields
    mapfile -t fields < <(target_fields TARGET_)
    write_kv_file "$STATE_FILE" \
        REVISION "$REVISION" \
        IMAGE_REF "$IMAGE_REF" \
        DEPLOY_STARTED_NS "${DEPLOY_STARTED_NS:-}" \
        STATE_RESULT "$1" \
        "${fields[@]}"
}

# Record the serving candidate as the rollback target. Only called after health, build, the
# release gates and the signed-in user smoke all passed (never for a skipped smoke).
record_last_good_candidate() {
    local container_id image_id expected_id tenant_image rootless_host
    container_id="$(running_theia_container || true)"
    image_id="$( [[ -n "$container_id" ]] && docker inspect -f '{{.Image}}' "$container_id" 2>/dev/null || true)"
    expected_id="$(image_id_of "$IMAGE_REF" || true)"
    if [[ -z "$image_id" || "$image_id" != "$expected_id" ]]; then
        echo "[qaap-vps-rollback] WARNING: serving image '${image_id:-none}' is not $IMAGE_REF; the rollback target was not updated" >&2
        return 1
    fi
    tenant_image="$(container_env_value "$container_id" QAAP_TENANT_DOCKER_IMAGE)"
    rootless_host="$(rootless_host_for_container "$container_id")"
    if [[ -z "$tenant_image" || -z "$rootless_host" ]]; then
        echo '[qaap-vps-rollback] WARNING: the serving container does not expose its tenant image and rootless Docker endpoint; the rollback target was not updated' >&2
        return 1
    fi
    write_kv_file "$LAST_GOOD_FILE" \
        REVISION "$REVISION" \
        IMAGE_REF "$IMAGE_REF" \
        IMAGE_ID "$image_id" \
        TENANT_IMAGE "$tenant_image" \
        ROOTLESS_DOCKER_HOST "$rootless_host" \
        VERIFIED_AT "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# Everything the rollback needs, checked while the candidate still serves: the target revision,
# its exact image (pulled again by digest if cleanup or an operator removed it) and the tenant
# image in the rootless daemon (seeded from the host when missing or stale).
ensure_target_ready() {
    local host_id rootless_id
    if ! git cat-file -e "${TARGET_REVISION}^{commit}" 2>/dev/null; then
        echo "target revision $TARGET_REVISION is not in the VPS repository"
        return 1
    fi
    host_id="$(image_id_of "$TARGET_IMAGE_REF" || true)"
    if [[ -z "$host_id" ]]; then
        echo "[qaap-vps-rollback] pulling rollback target $TARGET_IMAGE_REF" >&2
        docker pull "$TARGET_IMAGE_REF" >&2 || true
        host_id="$(image_id_of "$TARGET_IMAGE_REF" || true)"
    fi
    if [[ "$host_id" != "$TARGET_IMAGE_ID" ]]; then
        echo "target image $TARGET_IMAGE_REF is unavailable on the host daemon (found '${host_id:-none}', recorded $TARGET_IMAGE_ID)"
        return 1
    fi
    if ! DOCKER_HOST="$TARGET_ROOTLESS_DOCKER_HOST" docker info >/dev/null 2>&1; then
        echo "rootless Docker endpoint $TARGET_ROOTLESS_DOCKER_HOST is unavailable to the deploy user"
        return 1
    fi
    rootless_id="$(image_id_of "$TARGET_TENANT_IMAGE" "$TARGET_ROOTLESS_DOCKER_HOST" || true)"
    if [[ "$rootless_id" != "$TARGET_IMAGE_ID" ]]; then
        echo "[qaap-vps-rollback] seeding tenant image $TARGET_TENANT_IMAGE into rootless Docker (${rootless_id:-absent} -> $TARGET_IMAGE_ID)" >&2
        if ! docker tag "$TARGET_IMAGE_REF" "$TARGET_TENANT_IMAGE" >&2 ||
            ! docker save "$TARGET_TENANT_IMAGE" | DOCKER_HOST="$TARGET_ROOTLESS_DOCKER_HOST" docker load >&2; then
            echo "could not seed tenant image $TARGET_TENANT_IMAGE into rootless Docker"
            return 1
        fi
        rootless_id="$(image_id_of "$TARGET_TENANT_IMAGE" "$TARGET_ROOTLESS_DOCKER_HOST" || true)"
        if [[ "$rootless_id" != "$TARGET_IMAGE_ID" ]]; then
            echo "tenant image $TARGET_TENANT_IMAGE in rootless Docker is '${rootless_id:-absent}', not $TARGET_IMAGE_ID"
            return 1
        fi
    fi
}

# The router recreates `qaap-backend-*` from the image it was started with, so tenant containers
# created by the candidate must not survive into the restored release. Backends are stopped and
# renamed (their writable layer stays inspectable); tenant and ingress helpers are removed. Named
# volumes are never removed.
cleanup_new_rootless_tenant_containers() {
    local container_ids container_id details name created created_ns running
    local cleanup_failed=0 rootless_host="$TARGET_ROOTLESS_DOCKER_HOST"
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
# release cannot read. Starting old code on migrated volumes is worse than a failed release. The
# label is read from the candidate reference, so a crash-looping candidate is still covered.
candidate_blocks_rollback() {
    local policy
    [[ -n "$IMAGE_REF" ]] || return 1
    policy="$(docker image inspect "$IMAGE_REF" --format '{{ index .Config.Labels "ai.qaap.rollback" }}' 2>/dev/null || true)"
    [[ "$policy" == unsafe ]]
}

# Restore the rollback target: check it while the candidate still serves, then drain and stop the
# candidate, set aside its tenant containers, check out the target revision (Compose and Caddy
# files) and start the target digest with --no-build, then verify the target build.
perform_rollback() {
    local trigger="$1" problem
    if ! has_target; then
        rollback_failed "$trigger. No rollback target is recorded (no release has passed health and the signed-in user smoke on this VPS yet), so nothing was rolled back."
    fi
    echo "[qaap-vps-rollback] $trigger; restoring ${TARGET_IMAGE_REF}" >&2
    if candidate_blocks_rollback; then
        rollback_failed "$trigger, and the candidate image is labelled ai.qaap.rollback=unsafe (irreversible data migration); automatic rollback was not attempted"
    fi
    if ! problem="$(ensure_target_ready)"; then
        rollback_failed "$trigger; the rollback target is not usable ($problem). The candidate was left running."
    fi

    # Every Compose call from here on resolves the recorded digest, never a tag or a build.
    export QAAP_THEIA_IMAGE="$TARGET_IMAGE_REF"
    export QAAP_TENANT_DOCKER_IMAGE="$TARGET_TENANT_IMAGE"

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
        echo '[qaap-vps-rollback] WARNING: tenant cleanup was incomplete; continuing to restore the rollback target' >&2
    fi

    if ! git checkout --detach "$TARGET_REVISION"; then
        rollback_failed "could not check out the rollback target revision $TARGET_REVISION"
    fi
    if ! refresh_caddy; then
        rollback_failed 'docker compose could not validate and refresh the rollback target Caddy configuration'
    fi
    if ! QAAP_THEIA_IMAGE="$TARGET_IMAGE_REF" QAAP_TENANT_DOCKER_IMAGE="$TARGET_TENANT_IMAGE" \
        docker compose up -d --no-build --no-deps --force-recreate theia; then
        rollback_failed "docker compose could not start the rollback target $TARGET_IMAGE_REF"
    fi
    # Idempotent second pass: anything the candidate created after the first pass is set aside too.
    if ! cleanup_new_rootless_tenant_containers; then
        CLEANUP_WARNING=1
        echo '[qaap-vps-rollback] WARNING: tenant cleanup after restore was incomplete; the rollback target remains restored' >&2
    fi

    if ! verify_build_with_retries "$TARGET_REVISION" 'rollback'; then
        CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
        if [[ "$LAST_VERIFY_FAILURE" == credential ]]; then
            rollback_failed "the restored build ${TARGET_REVISION:0:12} rejected the smoke session (HTTP 302/401/403); renew the smoke credential and verify the restored release manually"
        fi
        rollback_failed "the restored build ${TARGET_REVISION:0:12} did not pass health, launch readiness, auth API and user smoke verification (last failure: ${LAST_VERIFY_FAILURE:-unknown})"
    fi
    write_last_good_from_target
    write_state rolled_back

    RESULT='rolled_back'
    REASON="restored ${TARGET_REVISION:0:12} ($TARGET_IMAGE_REF): $trigger"
    echo "ROLLED BACK to ${TARGET_REVISION:0:12} ($TARGET_IMAGE_REF)"
    write_result "$RESULT" "$REASON"
    local cleanup_note='' smoke_note='Health, launch readiness, auth API and the signed-in user smoke passed.'
    if (( CLEANUP_WARNING == 1 )); then
        cleanup_note="

WARNING: cleanup of one or more rootless tenant containers was incomplete. The rollback proceeded; inspect the deploy log for affected containers."
    fi
    if [[ "$LAST_SMOKE_RESULT" == skipped ]]; then
        smoke_note='Health, launch readiness and auth API passed; user smoke: skipped (no smoke credentials).'
    fi
    write_summary "## Release rolled back automatically

Trigger: $trigger.

Restored the last release that passed health and user smoke: build '${TARGET_REVISION:0:12}', image '$TARGET_IMAGE_REF' (recorded ${TARGET_VERIFIED_AT:-earlier}), with its Compose and Caddy configuration. $smoke_note$cleanup_note

The deploy result is 'rolled_back'; the workflow remains red so the failed release stays visible."
    exit 1
}

PRE_DEPLOY_CONTAINER_ID=''
PRE_DEPLOY_IMAGE_ID=''
PRE_DEPLOY_BUILD=''
DEPLOY_STARTED_NS=''
CURRENT_IMAGE_ID=''
CANDIDATE_VERIFY_FAILURE=''
CLEANUP_WARNING=0

if [[ "$MODE" == rollback-only ]]; then
    if [[ ! -f "$STATE_FILE" ]]; then
        rollback_failed "no deploy record at $STATE_FILE; external verification failed ($EXTERNAL_REASON)"
    fi
    if [[ "$(state_value "$STATE_FILE" REVISION)" != "$REVISION" || "$(state_value "$STATE_FILE" STATE_RESULT)" != verified ]]; then
        rollback_failed "the deploy record does not belong to a verified deploy of ${REVISION:0:12}; external verification failed ($EXTERNAL_REASON)"
    fi
    IMAGE_REF="$(state_value "$STATE_FILE" IMAGE_REF)"
    DEPLOY_STARTED_NS="$(state_value "$STATE_FILE" DEPLOY_STARTED_NS)"
    load_target "$STATE_FILE" TARGET_ || true
    # The on-VPS checks may have recorded this release as the rollback target; the runner says it
    # is not good, so give the target back before anything else can fail.
    if [[ "$(state_value "$LAST_GOOD_FILE" REVISION)" == "$REVISION" ]]; then
        if has_target; then
            write_last_good_from_target
        else
            rm -f -- "$LAST_GOOD_FILE"
        fi
    fi
    CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
    perform_rollback "external verification from the GitHub runner failed after the on-VPS checks passed ($EXTERNAL_REASON)"
fi

if ! PRE_DEPLOY_CONTAINER_ID="$(running_theia_container)"; then
    fail_before_deploy 'Could not query the running theia service before deployment.'
fi
NO_ROLLBACK=0
if [[ "${QAAP_VPS_ALLOW_NO_ROLLBACK:-0}" == 1 ]]; then
    NO_ROLLBACK=1
    echo '[qaap-vps-rollback] explicit allow_no_rollback is active: no preflight and no automatic rollback' >&2
fi

if [[ -f "$LAST_GOOD_FILE" ]] && ! load_target "$LAST_GOOD_FILE"; then
    echo "[qaap-vps-rollback] WARNING: ignoring incomplete rollback target record $LAST_GOOD_FILE" >&2
fi
if (( NO_ROLLBACK == 1 )); then
    load_target /dev/null || true
fi
if has_target; then
    if ! TARGET_PROBLEM="$(ensure_target_ready)"; then
        fail_before_deploy "The rollback target $TARGET_IMAGE_REF is not usable: $TARGET_PROBLEM. Fix it, or use workflow_dispatch allow_no_rollback to deploy without automatic rollback."
    fi
    echo "[qaap-vps-rollback] rollback target: ${TARGET_REVISION:0:12} $TARGET_IMAGE_REF (passed health and user smoke ${TARGET_VERIFIED_AT:-earlier})"
elif (( NO_ROLLBACK == 0 )); then
    echo '[qaap-vps-rollback] WARNING: no rollback target recorded yet (no release has passed health and the signed-in user smoke); a failed release will need manual intervention' >&2
fi

if [[ -n "$PRE_DEPLOY_CONTAINER_ID" ]]; then
    PRE_DEPLOY_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$PRE_DEPLOY_CONTAINER_ID" 2>/dev/null || true)"
fi
if [[ -n "$PRE_DEPLOY_CONTAINER_ID" ]] && (( NO_ROLLBACK == 0 )); then
    PRE_DEPLOY_HEALTH_BUILD=''
    if HEALTH_PAYLOAD="$(curl --silent --show-error --fail --max-time 15 "$PUBLIC_URL/qaap/api/health" 2>/dev/null)"; then
        PRE_DEPLOY_HEALTH_BUILD="$(printf '%s' "$HEALTH_PAYLOAD" | python3 -c 'import json,re,sys; payload=json.load(sys.stdin); build=payload.get("build", "") if isinstance(payload, dict) else ""; print(build if re.fullmatch(r"[0-9a-f]{12}|[0-9a-f]{40}", build) else "")' 2>/dev/null || true)"
    fi
    if ! valid_build "$PRE_DEPLOY_HEALTH_BUILD"; then
        fail_before_deploy 'The serving release does not report a valid build on /qaap/api/health; fix it first or use workflow_dispatch allow_no_rollback. No deployment changes were made.'
    fi
    PRE_DEPLOY_BUILD="$PRE_DEPLOY_HEALTH_BUILD"
    echo "[qaap-vps-rollback] serving build before deploy: ${PRE_DEPLOY_BUILD:0:12} (${PRE_DEPLOY_IMAGE_ID:-unknown image})"

    # One attempt against the release that is serving now. If the smoke credential is expired, or
    # the VPS cannot reach its own public URL, block here instead of rolling back a healthy release.
    if ! verify_build_once "$PRE_DEPLOY_BUILD" 'preflight'; then
        if [[ "$LAST_VERIFY_FAILURE" == credential ]]; then
            fail_before_deploy 'Pre-deploy authenticated smoke was rejected (HTTP 302/401/403) by the current release. The smoke cookie or session is expired; renew QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE. No deployment changes were made.'
        fi
        fail_before_deploy "Pre-deploy verification failed against the current release (${LAST_VERIFY_FAILURE:-unknown} check). Fix the serving release or the VPS's access to its public URL before deploying. No deployment changes were made."
    fi
fi

echo "[qaap-vps-rollback] deploying $REVISION from $IMAGE_REF"
write_state started

DEPLOY_STARTED_AT_FILE="$(mktemp -t qaap-vps-deploy-started.XXXXXXXX)"
rm -f -- "$DEPLOY_STARTED_AT_FILE"
export QAAP_VPS_DEPLOY_STARTED_AT_FILE="$DEPLOY_STARTED_AT_FILE"

DEPLOY_STATUS=0
"$SCRIPT_DIR/qaap-vps-update.sh" --branch "$BRANCH" --revision "$REVISION" --image "$IMAGE_REF" || DEPLOY_STATUS=$?
DEPLOY_STARTED_NS="$(cat "$DEPLOY_STARTED_AT_FILE" 2>/dev/null || true)"

if (( DEPLOY_STATUS == 0 )) && verify_build_with_retries "$REVISION" 'new release'; then
    RESULT='verified'
    write_state verified
    if [[ "$LAST_SMOKE_RESULT" == passed ]] && record_last_good_candidate; then
        REASON="build ${REVISION:0:12} passed health, launch readiness, auth API and the signed-in user smoke"
        TARGET_NOTE="Recorded '$IMAGE_REF' as the rollback target for the next deploy."
        SMOKE_NOTE='User smoke: passed.'
    elif [[ "$LAST_SMOKE_RESULT" == passed ]]; then
        REASON="build ${REVISION:0:12} passed health, launch readiness, auth API and the signed-in user smoke"
        TARGET_NOTE="WARNING: the rollback target was not updated (see the deploy log); it remains '${TARGET_IMAGE_REF:-none}'."
        SMOKE_NOTE='User smoke: passed.'
    else
        REASON="build ${REVISION:0:12} passed health, launch readiness and auth API; user smoke skipped (no smoke credentials)"
        TARGET_NOTE="Not recorded as a rollback target because the user smoke did not run; the target remains '${TARGET_IMAGE_REF:-none}'."
        SMOKE_NOTE='User smoke: skipped (no smoke credentials).'
    fi
    echo "[qaap-vps-rollback] deploy verified: $REASON"
    write_result "$RESULT" "$REASON"
    write_summary "## VPS deploy verified

Build '${REVISION:0:12}' is serving from '$IMAGE_REF'. Health, launch readiness and auth API checks passed. $SMOKE_NOTE

$TARGET_NOTE"
    exit 0
fi
CANDIDATE_VERIFY_FAILURE="$LAST_VERIFY_FAILURE"

if (( DEPLOY_STATUS == 0 )) && [[ "$CANDIDATE_VERIFY_FAILURE" == credential ]]; then
    # Health, build and the gates passed; only the smoke session was rejected. That says nothing
    # about the release, so do not roll back a release that may be healthy.
    CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
    rollback_failed "build ${REVISION:0:12} passed health, launch readiness and auth API, but the smoke session was rejected (HTTP 302/401/403) after the preflight accepted it. Not rolled back: renew QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE and verify the release manually."
fi

if (( NO_ROLLBACK == 1 )); then
    CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
    rollback_failed 'the new release failed verification and this deploy explicitly has no automatic rollback (allow_no_rollback)'
fi

if (( DEPLOY_STATUS != 0 )); then
    echo "[qaap-vps-rollback] update script exited $DEPLOY_STATUS; checking the running image" >&2
fi
CURRENT_IMAGE_ID="$(current_theia_image_id || true)"
if [[ -n "$PRE_DEPLOY_IMAGE_ID" && "$CURRENT_IMAGE_ID" == "$PRE_DEPLOY_IMAGE_ID" ]]; then
    # The update failed before switching (or Compose was a no-op): the serving release was never
    # replaced. Put the checkout back on its revision (no Compose call) and prove it still serves.
    PRE_DEPLOY_REVISION="$(docker image inspect "$PRE_DEPLOY_IMAGE_ID" \
        --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
    if [[ "$PRE_DEPLOY_REVISION" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "${PRE_DEPLOY_REVISION}^{commit}" 2>/dev/null; then
        git checkout --detach "$PRE_DEPLOY_REVISION" \
            || echo "[qaap-vps-rollback] WARNING: could not restore the checkout to $PRE_DEPLOY_REVISION" >&2
    else
        echo '[qaap-vps-rollback] WARNING: the serving image has no usable revision label; the checkout stays on the candidate revision' >&2
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
    perform_rollback "the update exited $DEPLOY_STATUS without switching the image, and the unchanged release failed verification (${LAST_VERIFY_FAILURE:-unknown} check)"
fi

if (( DEPLOY_STATUS != 0 )); then
    perform_rollback "the update script exited $DEPLOY_STATUS after switching the Theia image"
fi
perform_rollback "post-deploy verification of build ${REVISION:0:12} failed (${CANDIDATE_VERIFY_FAILURE:-unknown} check)"
