#!/usr/bin/env bash
# Exercise the VPS deploy/rollback transaction with fake Docker and curl CLIs.
set -euo pipefail

SOURCE="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-vps-rollback-test.XXXXXXXX)"
cleanup() {
    case "$TEST_ROOT" in
        */qaap-vps-rollback-test.*) rm -rf -- "$TEST_ROOT" ;;
        *) echo "Refusing to remove unexpected test path: $TEST_ROOT" >&2; exit 2 ;;
    esac
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/repo/scripts" "$TEST_ROOT/bin"
for script in qaap-vps-rollback.sh qaap-vps-post-deploy-user-smoke.sh qaap-vps-normalize-public-url.sh qaap-vps-deploy-helpers.sh; do
    sed 's/\r$//' "$SOURCE/$script" > "$TEST_ROOT/repo/scripts/$script"
done

cat > "$TEST_ROOT/repo/scripts/qaap-verify-launch-readiness.sh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
echo launch-readiness >> "$FAKE_STATE/gates"
[[ "${FAKE_GATE_FAIL:-}" != launch-readiness ]]
MOCK
cat > "$TEST_ROOT/repo/scripts/qaap-verify-auth-api-gate.sh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
echo auth-api >> "$FAKE_STATE/gates"
[[ "${FAKE_GATE_FAIL:-}" != auth-api ]]
MOCK

cat > "$TEST_ROOT/repo/scripts/qaap-vps-update.sh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
image_ref=''
while (($#)); do
    case "$1" in
        --image) image_ref="$2"; shift 2 ;;
        --branch|--revision) shift 2 ;;
        *) echo "unexpected update argument: $1" >&2; exit 2 ;;
    esac
done
[[ -n "$image_ref" && -n "${QAAP_VPS_DEPLOY_STARTED_AT_FILE:-}" ]] || exit 3
echo called >> "$FAKE_STATE/update.calls"
date -u +%s%N > "$QAAP_VPS_DEPLOY_STARTED_AT_FILE"
sleep 0.02
date -u +%Y-%m-%dT%H:%M:%S.%NZ > "$FAKE_STATE/rootless/backend-new.created"
if [[ "${FAKE_UPDATE_NO_SWITCH:-0}" != 1 ]]; then
    QAAP_THEIA_IMAGE="$image_ref" docker compose up -d --no-build theia
fi
if [[ "${FAKE_UPDATE_STATUS:-0}" != 0 ]]; then exit "$FAKE_UPDATE_STATUS"; fi
MOCK

cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
daemon='host'
[[ "${DOCKER_HOST:-}" == "${FAKE_ROOTLESS_HOST:-unix:///tmp/qaap-rootless.sock}" ]] && daemon='rootless'
printf '%s %s\n' "$daemon" "$*" >> "$FAKE_STATE/docker.calls"

read_current_image() { cat "$FAKE_STATE/current-image"; }
# Image ids by reference, per daemon. The rollback target is the old release.
ref_image_id() {
    local ref="$1"
    if [[ "$daemon" == rootless ]]; then
        if [[ "$ref" == "$FAKE_OLD_TENANT_IMAGE" ]]; then
            if [[ -f "$FAKE_STATE/rootless-old-tenant-missing" ]]; then return 1; fi
            printf '%s\n' "$FAKE_OLD_IMAGE_ID"
        elif [[ "$ref" == "$FAKE_NEW_TENANT_IMAGE" ]]; then
            printf '%s\n' "$FAKE_NEW_IMAGE_ID"
        else
            return 1
        fi
        return 0
    fi
    case "$ref" in
        "$FAKE_TARGET_REF"|"$FAKE_OLD_IMAGE_ID"|"$FAKE_OLD_TENANT_IMAGE")
            if [[ -f "$FAKE_STATE/host-target-missing" ]]; then return 1; fi
            printf '%s\n' "$FAKE_OLD_IMAGE_ID"
            ;;
        "$FAKE_CANDIDATE_REF"|"$FAKE_NEW_IMAGE_ID"|"$FAKE_NEW_TENANT_IMAGE") printf '%s\n' "$FAKE_NEW_IMAGE_ID" ;;
        *) return 1 ;;
    esac
}
case "$1" in
    compose)
        shift
        printf '%s|%s|%s\n' "$1" "${QAAP_THEIA_IMAGE:-}" "${QAAP_TENANT_DOCKER_IMAGE:-}" >> "$FAKE_STATE/compose.env"
        case "$1" in
            ps)
                if [[ "${FAKE_CURRENT_MISSING:-0}" != 1 ]]; then printf '%s\n' theia-container; fi
                ;;
            config) printf '%s\n' theia caddy ;;
            run)
                [[ "${QAAP_THEIA_IMAGE:-}" ]] || { echo 'QAAP_THEIA_IMAGE missing for compose run' >&2; exit 25; }
                ;;
            stop)
                echo stopped-theia >> "$FAKE_STATE/actions"
                ;;
            exec) printf '{"runningTasks":0}' ;;
            up)
                [[ "${QAAP_THEIA_IMAGE:-}" ]] || { echo 'QAAP_THEIA_IMAGE missing' >&2; exit 21; }
                [[ " $* " == *' --no-build '* ]] || { echo '--no-build missing' >&2; exit 22; }
                if [[ " $* " == *' theia '* ]]; then
                    case "$QAAP_THEIA_IMAGE" in
                        "$FAKE_CANDIDATE_REF") image="$FAKE_NEW_IMAGE_ID" ;;
                        "$FAKE_TARGET_REF") image="$FAKE_OLD_IMAGE_ID" ;;
                        *) echo "compose up theia with an unrecorded image: $QAAP_THEIA_IMAGE" >&2; exit 26 ;;
                    esac
                    if [[ "$image" == "$FAKE_OLD_IMAGE_ID" && "${FAKE_FAIL_ROLLBACK:-0}" == 1 ]]; then
                        echo 'simulated rollback compose failure' >&2
                        exit 23
                    fi
                    printf '%s\n' "$image" > "$FAKE_STATE/current-image"
                fi
                ;;
            *) echo "unexpected docker compose command: $*" >&2; exit 2 ;;
        esac
        ;;
    inspect)
        shift
        if [[ "$daemon" == host ]]; then
            if [[ "$1" == -f || "$1" == --format ]]; then
                format="$2"
            elif [[ "$*" == *'--format'* ]]; then
                format=''
                inspect_args=("$@")
                for ((arg_index=0; arg_index<${#inspect_args[@]} - 1; arg_index++)); do
                    if [[ "${inspect_args[$arg_index]}" == --format ]]; then
                        format="${inspect_args[$((arg_index + 1))]}"
                        break
                    fi
                done
            fi
            if [[ -n "$format" ]]; then
                if [[ "$format" == *'.Image'* ]]; then
                    read_current_image
                elif [[ "$format" == *'Config.Env'* ]]; then
                    tenant_image="$FAKE_OLD_TENANT_IMAGE"
                    [[ "$(read_current_image)" == "$FAKE_NEW_IMAGE_ID" ]] && tenant_image="$FAKE_NEW_TENANT_IMAGE"
                    printf 'QAAP_DOCKER_ROOTLESS=1\nQAAP_TENANT_DOCKER_IMAGE=%s\nDOCKER_HOST=%s\n' \
                        "$tenant_image" "$FAKE_ROOTLESS_HOST"
                elif [[ "$format" == *'.Mounts'* ]]; then
                    :
                else
                    exit 24
                fi
            else
                exit 2
            fi
        else
            [[ "$1" == --format && "$2" == *'.Name'*'.Created'* ]] || exit 25
            id="${*: -1}"
            if [[ "${FAKE_ROOTLESS_DISAPPEAR_INSPECT:-}" == "$id" ]]; then
                echo "Error: No such container: $id" >&2
                exit 1
            fi
            if [[ "${FAKE_ROOTLESS_INSPECT_FAIL:-}" == "$id" ]]; then
                echo 'permission denied during inspect' >&2
                exit 1
            fi
            renamed_to="$(sed -n "s/^$id|//p" "$FAKE_STATE/rootless.renamed" | tail -n 1)"
            case "$id" in
                backend-new) printf '/%s|%s|true\n' "${renamed_to:-qaap-backend-new}" "$(cat "$FAKE_STATE/rootless/backend-new.created")" ;;
                tenant-new) printf '/qaap-tenant-new|%s|true\n' "$(cat "$FAKE_STATE/rootless/backend-new.created")" ;;
                ingress-new) printf '/qaap-ingress-new|%s|true\n' "$(cat "$FAKE_STATE/rootless/backend-new.created")" ;;
                backend-old) printf '/qaap-backend-old|%s|false\n' "$FAKE_OLD_CREATED" ;;
                other-new) printf '/unrelated-container|%s\n' "$(cat "$FAKE_STATE/rootless/backend-new.created")" ;;
                *) exit 26 ;;
            esac
        fi
        ;;
    info)
        [[ "$daemon" == rootless ]] || exit 2
        ;;
    tag)
        printf '%s %s %s\n' "$daemon" "$2" "$3" >> "$FAKE_STATE/tags"
        ;;
    pull)
        echo "$daemon $2" >> "$FAKE_STATE/pulls"
        if [[ "${FAKE_PULL_FAIL:-0}" == 1 ]]; then echo 'pull denied' >&2; exit 1; fi
        rm -f "$FAKE_STATE/host-target-missing"
        ;;
    save)
        [[ "$daemon" == host ]] || exit 2
        printf 'image-archive:%s\n' "$2"
        ;;
    load)
        [[ "$daemon" == rootless ]] || exit 2
        archive="$(cat)"
        echo "$archive" >> "$FAKE_STATE/rootless.loaded"
        [[ "$archive" == "image-archive:$FAKE_OLD_TENANT_IMAGE" ]] && rm -f "$FAKE_STATE/rootless-old-tenant-missing"
        ;;
    image)
        [[ "$2" == inspect ]] || exit 2
        image="$3"
        if [[ " ${*:4} " == *'{{.Id}}'* ]]; then
            ref_image_id "$image" || { echo "Error: No such image: $image" >&2; exit 1; }
        elif [[ " $* " == *'org.opencontainers.image.revision'* ]]; then
            id="$(ref_image_id "$image")" || exit 27
            if [[ "$id" == "$FAKE_OLD_IMAGE_ID" ]]; then printf '%s\n' "$FAKE_OLD_BUILD"; else printf '%s\n' "$FAKE_NEW_BUILD"; fi
        elif [[ " $* " == *'ai.qaap.rollback'* ]]; then
            id="$(ref_image_id "$image")" || exit 27
            if [[ "$id" == "$FAKE_NEW_IMAGE_ID" ]]; then printf '%s\n' "${FAKE_NEW_ROLLBACK_LABEL:-}"; else printf '\n'; fi
        else
            exit 28
        fi
        ;;
    ps)
        [[ "$daemon" == rootless ]] || exit 2
        [[ " $* " == *'--filter name=^qaap-(backend|tenant|ingress)-'* ]] || { echo 'expected tenant-only docker ps filter' >&2; exit 31; }
        printf '%s\n' backend-new tenant-new ingress-new backend-old other-new
        ;;
    stop)
        [[ "$daemon" == rootless && "$2" == -t && "$3" == 30 ]] || exit 32
        if [[ "${FAKE_ROOTLESS_DISAPPEAR_STOP:-}" == "$4" ]]; then echo "Error: No such container: $4" >&2; exit 1; fi
        echo "$4" >> "$FAKE_STATE/rootless.stopped"
        ;;
    rename)
        [[ "$daemon" == rootless ]] || exit 2
        if [[ "${FAKE_ROOTLESS_DISAPPEAR_RENAME:-}" == "$2" ]]; then echo "Error: No such container: $2" >&2; exit 1; fi
        printf '%s|%s\n' "$2" "$3" >> "$FAKE_STATE/rootless.renamed"
        ;;
    rm)
        [[ "$daemon" == rootless && $# == 2 ]] || { echo 'tenant removal must be graceful and preserve volumes' >&2; exit 29; }
        if [[ "${FAKE_ROOTLESS_DISAPPEAR_RM:-}" == "$2" ]]; then echo "Error: No such container: $2" >&2; exit 1; fi
        if [[ "${FAKE_ROOTLESS_RM_FAIL:-}" == "$2" ]]; then echo 'permission denied during rm' >&2; exit 1; fi
        printf '%s\n' "$2" >> "$FAKE_STATE/rootless.removed"
        ;;
    *) echo "unexpected docker command: $*" >&2; exit 2 ;;
esac
MOCK

cat > "$TEST_ROOT/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
output=''
header_file=''
write_out=''
url=''
fail_http=0
while (($#)); do
    case "$1" in
        --output|-o) output="$2"; shift 2 ;;
        -H|--header) header_file="$2"; shift 2 ;;
        --write-out|-w) write_out="$2"; shift 2 ;;
        --max-time) shift 2 ;;
        --silent|--show-error|--fail|-s|-S|-f)
            [[ "$1" == --fail || "$1" == -f ]] && fail_http=1
            shift
            ;;
        *) url="$1"; shift ;;
    esac
done
cookie=''
if [[ "$header_file" == @* ]]; then
    header_path="${header_file#@}"
    [[ "$(stat -c '%a' "$header_path")" == 600 ]] || { echo 'cookie header file must have mode 600' >&2; exit 40; }
    cookie="$(sed -n 's/^Cookie: //p' "$header_path")"
fi
printf '%s|%s\n' "$url" "$cookie" >> "$FAKE_STATE/curl.calls"
current="$(cat "$FAKE_STATE/current-image")"
if [[ "$current" == "$FAKE_NEW_IMAGE_ID" ]]; then
    build="$FAKE_NEW_BUILD"
else
    build="$FAKE_OLD_BUILD"
fi
case "$url" in
    */qaap/api/health)
        status="${FAKE_HEALTH_STATUS:-200}"
        if [[ "$current" == "$FAKE_NEW_IMAGE_ID" ]]; then status="${FAKE_CANDIDATE_HEALTH_STATUS:-$status}"; fi
        if [[ ! -s "$FAKE_STATE/capture-health-called" ]]; then
            : > "$FAKE_STATE/capture-health-called"
            status="${FAKE_CAPTURE_HEALTH_STATUS:-$status}"
            build="${FAKE_CAPTURE_HEALTH_BUILD:-$build}"
        fi
        build="${FAKE_HEALTH_BUILD:-$build}"
        body="{\"ok\":true,\"ready\":true,\"build\":\"${build:0:12}\"}"
        ;;
    */qaap/api/auth/config)
        status=200
        body="{\"build\":\"${build:0:12}\"}"
        ;;
    */qaap/api/agent-approvals)
        [[ "$cookie" == 'qaap_sid=test-session' ]] || { echo 'wrong approvals cookie' >&2; exit 31; }
        status="${FAKE_APPROVALS_STATUS:-200}"
        body='{"approvals":[]}'
        ;;
    */)
        [[ "$cookie" == 'qaap_sid=test-session' ]] || { echo 'workspace request was not authenticated' >&2; exit 32; }
        if [[ "$current" == "$FAKE_NEW_IMAGE_ID" && "${FAKE_CANDIDATE_WORKSPACE_FAIL:-0}" == 1 ]]; then
            status=502
            body='Tenant backend unavailable'
        else
            status="${FAKE_WORKSPACE_STATUS:-200}"
            if [[ "$current" == "$FAKE_NEW_IMAGE_ID" ]]; then status="${FAKE_CANDIDATE_WORKSPACE_STATUS:-$status}"; fi
            body='workspace ready'
        fi
        ;;
    *) echo "unexpected curl URL: $url" >&2; exit 2 ;;
esac
if (( fail_http == 1 && status >= 400 )); then exit 22; fi
if [[ -z "$output" ]]; then
    printf '%s\n' "$body"
elif [[ "$output" != /dev/null ]]; then
    printf '%s\n' "$body" > "$output"
fi
if [[ -n "$write_out" ]]; then
    printf '%s' "$status"
fi
if (( fail_http == 1 && status >= 400 )); then exit 22; fi
MOCK

cat > "$TEST_ROOT/bin/git" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_STATE/git.calls"
case "$1" in
    cat-file) [[ "${FAKE_GIT_MISSING:-}" != "${3%^\{commit\}}" ]] ;;
    checkout) printf '%s\n' "$3" > "$FAKE_STATE/checked-out-sha" ;;
    *) echo "unexpected git command: $*" >&2; exit 2 ;;
esac
MOCK

chmod +x "$TEST_ROOT/bin/docker" "$TEST_ROOT/bin/curl" "$TEST_ROOT/repo/scripts/qaap-vps-update.sh" \
    "$TEST_ROOT/bin/git" \
    "$TEST_ROOT/repo/scripts/qaap-vps-rollback.sh" "$TEST_ROOT/repo/scripts/qaap-vps-post-deploy-user-smoke.sh" \
    "$TEST_ROOT/repo/scripts/qaap-verify-launch-readiness.sh" "$TEST_ROOT/repo/scripts/qaap-verify-auth-api-gate.sh"
export PATH="$TEST_ROOT/bin:$PATH"
export FAKE_STATE="$TEST_ROOT/state"
export FAKE_ROOTLESS_HOST='unix:///tmp/qaap-test-rootless.sock'
FAKE_OLD_IMAGE_ID="sha256:$(printf '1%.0s' {1..64})"
FAKE_NEW_IMAGE_ID="sha256:$(printf '2%.0s' {1..64})"
FAKE_OLD_TENANT_IMAGE="ghcr.io/qaap/qaap:$(printf 'a%.0s' {1..40})"
FAKE_NEW_TENANT_IMAGE="ghcr.io/qaap/qaap:$(printf 'b%.0s' {1..40})"
FAKE_TARGET_REF="$FAKE_OLD_TENANT_IMAGE@sha256:$(printf '1%.0s' {1..64})"
FAKE_OLD_BUILD="$(printf 'a%.0s' {1..40})"
FAKE_NEW_BUILD="$(printf 'b%.0s' {1..40})"
FAKE_CANDIDATE_REF="$FAKE_NEW_TENANT_IMAGE@sha256:$(printf '2%.0s' {1..64})"
export FAKE_OLD_IMAGE_ID FAKE_NEW_IMAGE_ID FAKE_OLD_TENANT_IMAGE FAKE_NEW_TENANT_IMAGE FAKE_TARGET_REF FAKE_OLD_BUILD FAKE_NEW_BUILD FAKE_CANDIDATE_REF FAKE_OLD_CREATED
export QAAP_SMOKE_SESSION='test-session'
export QAAP_VPS_VERIFY_TIMEOUT_SECONDS=1
export QAAP_VPS_VERIFY_INTERVAL_SECONDS=0
FAKE_OLD_CREATED="$(date -u -d '1 minute ago' +%Y-%m-%dT%H:%M:%S.%NZ)"
mkdir -p "$FAKE_STATE/rootless"

fail() { echo "FAIL: $*" >&2; exit 1; }
setup_case() {
    local name="$1"
    FAKE_STATE="$TEST_ROOT/state-$name"
    export FAKE_STATE
    mkdir -p "$FAKE_STATE/rootless"
    printf '%s\n' "$FAKE_OLD_IMAGE_ID" > "$FAKE_STATE/current-image"
    for file in docker.calls curl.calls gates actions tags rootless.removed rootless.stopped rootless.renamed \
        compose.env pulls rootless.loaded update.calls; do
        : > "$FAKE_STATE/$file"
    done
    rm -f "$FAKE_STATE/capture-health-called" "$FAKE_STATE/checked-out-sha" \
        "$FAKE_STATE/host-target-missing" "$FAKE_STATE/rootless-old-tenant-missing"
    printf '%s\n' "$FAKE_OLD_CREATED" > "$FAKE_STATE/rootless/backend-old.created"
    printf '%s\n' "$FAKE_OLD_CREATED" > "$FAKE_STATE/rootless/backend-new.created"
    printf 'OTHER_SETTING=preserved\n' > "$TEST_ROOT/repo/.env"
    unset FAKE_CANDIDATE_WORKSPACE_FAIL FAKE_FAIL_ROLLBACK FAKE_HEALTH_STATUS QAAP_SMOKE_COOKIE
    unset FAKE_HEALTH_BUILD FAKE_CAPTURE_HEALTH_STATUS FAKE_CAPTURE_HEALTH_BUILD
    unset FAKE_WORKSPACE_STATUS FAKE_APPROVALS_STATUS FAKE_ROOTLESS_INSPECT_FAIL
    unset FAKE_ROOTLESS_DISAPPEAR_INSPECT FAKE_ROOTLESS_DISAPPEAR_RM FAKE_ROOTLESS_RM_FAIL
    unset FAKE_UPDATE_NO_SWITCH FAKE_UPDATE_STATUS FAKE_CURRENT_MISSING FAKE_GATE_FAIL QAAP_VPS_ALLOW_NO_ROLLBACK
    unset FAKE_NEW_ROLLBACK_LABEL FAKE_ROOTLESS_DISAPPEAR_STOP FAKE_ROOTLESS_DISAPPEAR_RENAME
    unset FAKE_CANDIDATE_HEALTH_STATUS FAKE_CANDIDATE_WORKSPACE_STATUS FAKE_PULL_FAIL FAKE_GIT_MISSING
    export QAAP_SMOKE_SESSION='test-session'
    export QAAP_DEPLOY_LOCK_FILE="$FAKE_STATE/deploy.lock"
    export QAAP_DEPLOY_STATE_DIR="$FAKE_STATE/deploy-state"
    LAST_GOOD="$QAAP_DEPLOY_STATE_DIR/last-good-release.env"
    # The serving (old) release passed health and user smoke in an earlier deploy.
    mkdir -p "$QAAP_DEPLOY_STATE_DIR"
    printf '%s\n' "REVISION=$FAKE_OLD_BUILD" "IMAGE_REF=$FAKE_TARGET_REF" "IMAGE_ID=$FAKE_OLD_IMAGE_ID" \
        "TENANT_IMAGE=$FAKE_OLD_TENANT_IMAGE" "ROOTLESS_DOCKER_HOST=$FAKE_ROOTLESS_HOST" \
        'VERIFIED_AT=2026-10-04T10:00:00Z' > "$LAST_GOOD"
}
run_rollback_only() {
    (cd "$TEST_ROOT/outside" && "$TEST_ROOT/repo/scripts/qaap-vps-rollback.sh" \
        --rollback-only "$FAKE_NEW_BUILD" https://qaap.example.test "${1:-runner smoke failed}")
}
# Runs a deploy and stores its exit status in $status without tripping set -e.
deploy_status() {
    status=0
    run_deploy "${1:-$FAKE_CANDIDATE_REF}" > "$FAKE_STATE/output" 2>&1 || status=$?
}
line_of() { grep -n -m 1 -F -- "$1" "$FAKE_STATE/docker.calls" | cut -d: -f1; }
run_deploy() {
    (mkdir -p "$TEST_ROOT/outside" && cd "$TEST_ROOT/outside" && "$TEST_ROOT/repo/scripts/qaap-vps-rollback.sh" \
        master "$FAKE_NEW_BUILD" "$1" https://qaap.example.test)
}
# Every Compose up/run after the candidate switch must resolve the recorded target digest.
assert_rollback_compose_pinned() {
    local switch_line
    switch_line="$(grep -n -F "up|$FAKE_CANDIDATE_REF|" "$FAKE_STATE/compose.env" | tail -n 1 | cut -d: -f1)"
    switch_line="${switch_line:-0}"
    if tail -n "+$((switch_line + 1))" "$FAKE_STATE/compose.env" | grep -E '^(up|run)\|' \
        | grep -v -F "|$FAKE_TARGET_REF|$FAKE_OLD_TENANT_IMAGE"; then
        fail 'a rollback compose up/run did not pin QAAP_THEIA_IMAGE to the recorded digest and its tenant tag'
    fi
    tail -n "+$((switch_line + 1))" "$FAKE_STATE/compose.env" | grep -q -F "up|$FAKE_TARGET_REF|" \
        || fail 'rollback did not start the recorded target digest'
}
last_good_value() { sed -n "s/^$1=//p" "$LAST_GOOD"; }

# Guard every production compose up/run: Compose must receive a pinned serving image.
awk '
    /^[[:space:]]*#/ { next }
    {
        if ($0 ~ /export[[:space:]]+QAAP_THEIA_IMAGE=/) { image_exported=1 }
        command = command " " $0
        if ($0 !~ /\\[[:space:]]*$/) {
            if (command ~ /docker compose (up|run)/) {
                if (command !~ /QAAP_THEIA_IMAGE=/ && image_exported != 1) {
                    print "FAIL: compose up/run must pin QAAP_THEIA_IMAGE:" command > "/dev/stderr"
                    exit 1
                }
                if (command ~ /docker compose up/ && command !~ /--no-build/) {
                    print "FAIL: compose up must use --no-build:" command > "/dev/stderr"
                    exit 1
                }
            }
            command = ""
        }
    }
' "$SOURCE/qaap-vps-update.sh" "$SOURCE/qaap-vps-deploy-helpers.sh" "$SOURCE/qaap-vps-rollback.sh" \
    || fail 'compose up/run safety invariant failed'

# The rollback path never pins mutable rollback tags or rewrites .env.
if grep -Eq 'qaap-(theia|tenant):rollback|write_env_value' "$SOURCE/qaap-vps-rollback.sh"; then
    fail 'rollback must start the recorded digest, not a rollback tag or an .env pin'
fi

# (a) Healthy deploy with smoke credentials: verified, and the candidate becomes the rollback target.
setup_case healthy
deploy_status
[[ "$status" == 0 ]] || fail "healthy deploy failed: $(cat "$FAKE_STATE/output")"
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'healthy deploy did not leave the candidate image serving'
grep -q '^QAAP_DEPLOY_RESULT=verified$' "$FAKE_STATE/output" || fail 'healthy deploy did not emit the verified result marker'
grep -q 'User smoke: passed' "$FAKE_STATE/output" || fail 'passed user smoke was not reported'
if grep -q 'MANUAL INTERVENTION\|ROLLED BACK' "$FAKE_STATE/output"; then fail 'healthy deploy incorrectly rolled back'; fi
if [[ -s "$FAKE_STATE/rootless.removed" ]]; then fail 'healthy deploy removed rootless containers'; fi
grep -Fxq 'launch-readiness' "$FAKE_STATE/gates" || fail 'launch-readiness gate did not run'
grep -Fxq 'auth-api' "$FAKE_STATE/gates" || fail 'auth API gate did not run'
[[ "$(last_good_value REVISION)" == "$FAKE_NEW_BUILD" ]] || fail 'verified release was not recorded as the rollback target'
[[ "$(last_good_value IMAGE_REF)" == "$FAKE_CANDIDATE_REF" ]] || fail 'rollback target must be the immutable digest reference'
[[ "$(last_good_value IMAGE_ID)" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'rollback target image id was not recorded'
[[ "$(last_good_value TENANT_IMAGE)" == "$FAKE_NEW_TENANT_IMAGE" ]] || fail 'rollback target tenant image was not recorded'
[[ "$(last_good_value ROOTLESS_DOCKER_HOST)" == "$FAKE_ROOTLESS_HOST" ]] || fail 'rootless endpoint was not recorded'
grep -q '^STATE_RESULT=verified$' "$QAAP_DEPLOY_STATE_DIR/rollback-target.env" || fail 'verified deploy was not recorded'
grep -Fxq "TARGET_IMAGE_REF=$FAKE_TARGET_REF" "$QAAP_DEPLOY_STATE_DIR/rollback-target.env" || fail 'deploy record lost the previous rollback target'
[[ ! -s "$FAKE_STATE/tags" ]] || fail 'deploy created image tags'

# (a2) Runner-side verification fails after the VPS checks passed: --rollback-only restores the
#      target recorded before this deploy, and gives it back its last-good status.
status=0
run_rollback_only 'build or authenticated workspace smoke failed from the runner' > "$FAKE_STATE/rollback-only.out" 2>&1 || status=$?
[[ "$status" == 1 ]] || fail "rollback-only returned $status instead of 1: $(cat "$FAKE_STATE/rollback-only.out")"
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'rollback-only did not restore the target image'
grep -q '^QAAP_DEPLOY_RESULT=rolled_back$' "$FAKE_STATE/rollback-only.out" || fail 'rollback-only did not emit rolled_back'
grep -q 'external verification from the GitHub runner failed' "$FAKE_STATE/rollback-only.out" || fail 'rollback-only trigger was not reported'
[[ "$(cat "$FAKE_STATE/checked-out-sha")" == "$FAKE_OLD_BUILD" ]] || fail 'rollback-only did not check out the target revision'
[[ "$(last_good_value IMAGE_REF)" == "$FAKE_TARGET_REF" ]] || fail 'rollback-only left the rejected release as the rollback target'
assert_rollback_compose_pinned
status=0
run_rollback_only > "$FAKE_STATE/rollback-only-again.out" 2>&1 || status=$?
[[ "$status" == 3 ]] || fail "a second rollback-only for an already rolled back deploy returned $status instead of 3"

# (b) Health stays 200 while the authenticated workspace returns 502: roll back to the recorded digest.
setup_case workspace-failure
export FAKE_CANDIDATE_WORKSPACE_FAIL=1
deploy_status
[[ "$status" == 1 ]] || fail "successful rollback returned $status instead of 1: $(cat "$FAKE_STATE/output")"
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'rollback did not restore the exact target image id'
grep -q 'health reports deployed build bbbbbbbbbbbb' "$FAKE_STATE/output" || fail 'candidate health was not observed as healthy before smoke failed'
grep -q 'Tenant backend unavailable' "$FAKE_STATE/output" || fail 'workspace 502 body was not reported'
grep -q "ROLLED BACK to ${FAKE_OLD_BUILD:0:12} ($FAKE_TARGET_REF)" "$FAKE_STATE/output" || fail 'rollback success message was missing'
grep -q '^QAAP_DEPLOY_RESULT=rolled_back$' "$FAKE_STATE/output" || fail 'rollback did not emit the rolled_back result marker'
for container in tenant-new ingress-new; do
    grep -Fxq "$container" "$FAKE_STATE/rootless.removed" || fail "new rootless $container container was not removed"
done
[[ "$(grep -c '^backend-new|' "$FAKE_STATE/rootless.renamed")" == 1 ]] || fail 'new rootless backend was not set aside exactly once'
grep -Fxq "backend-new|qaap-backend-new-rollback-${FAKE_NEW_BUILD:0:12}" "$FAKE_STATE/rootless.renamed" || fail 'new rootless backend was not renamed'
grep -Fxq 'backend-new' "$FAKE_STATE/rootless.stopped" || fail 'new rootless backend was not stopped gracefully'
if grep -Eq 'backend-old|other-new' "$FAKE_STATE/rootless.removed" "$FAKE_STATE/rootless.renamed"; then fail 'rollback touched a preexisting or unrelated rootless container'; fi
grep -q 'host compose up -d --no-build --no-deps --force-recreate theia' "$FAKE_STATE/docker.calls" || fail 'rollback did not recreate only theia with --no-build --no-deps'
stop_line="$(line_of 'host compose stop -t 60 theia')"
cleanup_line="$(line_of 'rootless rm tenant-new')"
up_line="$(grep -n -F 'host compose up -d --no-build --no-deps --force-recreate theia' "$FAKE_STATE/docker.calls" | cut -d: -f1 | tail -n 1)"
[[ -n "$stop_line" && -n "$cleanup_line" && -n "$up_line" ]] || fail 'rollback stop/cleanup/up calls were not all recorded'
(( stop_line < cleanup_line && cleanup_line < up_line )) || fail 'candidate theia must be stopped before tenant cleanup and cleanup must precede the restore'
[[ "$(cat "$FAKE_STATE/checked-out-sha")" == "$FAKE_OLD_BUILD" ]] || fail 'rollback did not check out the target revision'
[[ "$(cat "$TEST_ROOT/repo/.env")" == 'OTHER_SETTING=preserved' ]] || fail 'rollback rewrote .env'
grep -q 'host compose up -d --no-build --no-deps --force-recreate caddy' "$FAKE_STATE/docker.calls" || fail 'rollback did not refresh Caddy with the target configuration'
assert_rollback_compose_pinned
[[ "$(last_good_value IMAGE_REF)" == "$FAKE_TARGET_REF" ]] || fail 'a failed candidate became the rollback target'

# (c) Compose cannot start the target: report manual intervention with the reserved code 3.
setup_case rollback-failure
export FAKE_CANDIDATE_WORKSPACE_FAIL=1 FAKE_FAIL_ROLLBACK=1
deploy_status
[[ "$status" == 3 ]] || fail "failed rollback returned $status instead of reserved code 3"
grep -q 'MANUAL INTERVENTION NEEDED' "$FAKE_STATE/output" || fail 'manual intervention message was missing'
grep -q '^QAAP_DEPLOY_RESULT=manual$' "$FAKE_STATE/output" || fail 'manual result marker was missing'
grep -q '^QAAP_DEPLOY_REASON=docker compose could not start the rollback target' "$FAKE_STATE/output" || fail 'manual reason was not on stdout'

# (d) No smoke credentials and a healthy candidate: deploy proceeds and is verified, the user smoke
#     reports "skipped (no smoke credentials)", nothing rolls back, and the release does not become
#     the rollback target.
setup_case no-credentials
unset QAAP_SMOKE_SESSION QAAP_SMOKE_COOKIE
deploy_status
[[ "$status" == 0 ]] || fail "deploy without smoke credentials returned $status: $(cat "$FAKE_STATE/output")"
grep -q '^QAAP_DEPLOY_RESULT=verified$' "$FAKE_STATE/output" || fail 'deploy without smoke credentials was not verified'
grep -q 'user smoke skipped (no smoke credentials)' "$FAKE_STATE/output" || fail 'skipped user smoke was not reported'
grep -q 'User smoke: skipped (no smoke credentials)' "$FAKE_STATE/output" || fail 'summary does not report the skipped smoke'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'skipped smoke triggered a rollback'
if grep -q 'compose stop' "$FAKE_STATE/docker.calls"; then fail 'skipped smoke stopped the candidate'; fi
[[ "$(last_good_value IMAGE_REF)" == "$FAKE_TARGET_REF" ]] || fail 'a release without user smoke became the rollback target'
[[ -s "$FAKE_STATE/update.calls" ]] || fail 'missing smoke credentials blocked the deploy'

# (d2) No smoke credentials and a candidate whose health fails: health still triggers the rollback.
setup_case no-credentials-health-failure
unset QAAP_SMOKE_SESSION QAAP_SMOKE_COOKIE
export FAKE_CANDIDATE_HEALTH_STATUS=503
deploy_status
[[ "$status" == 1 ]] || fail "health failure without credentials returned $status instead of 1: $(cat "$FAKE_STATE/output")"
grep -q '^QAAP_DEPLOY_RESULT=rolled_back$' "$FAKE_STATE/output" || fail 'health failure without credentials did not roll back'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'health failure without credentials did not restore the target'
grep -q 'user smoke: skipped (no smoke credentials)' "$FAKE_STATE/output" || fail 'restored release summary does not report the skipped smoke'
assert_rollback_compose_pinned

# (d3) No rollback target recorded yet: a failed release ends in manual and keeps the candidate.
setup_case no-target
rm -f "$LAST_GOOD"
export FAKE_CANDIDATE_HEALTH_STATUS=503
deploy_status
[[ "$status" == 3 ]] || fail "failure without a rollback target returned $status instead of 3"
grep -q 'No rollback target is recorded' "$FAKE_STATE/output" || fail 'missing rollback target was not reported'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'candidate was replaced without a rollback target'
if grep -q 'compose stop' "$FAKE_STATE/docker.calls"; then fail 'candidate was stopped without a rollback target'; fi

# (d4) A mutable image reference (tag without digest) is refused before anything changes.
setup_case mutable-ref
deploy_status "$FAKE_NEW_TENANT_IMAGE"
[[ "$status" == 1 ]] || fail "mutable image reference returned $status instead of 1"
grep -q 'immutable image reference' "$FAKE_STATE/output" || fail 'mutable image reference was not reported'
[[ ! -s "$FAKE_STATE/docker.calls" ]] || fail 'mutable image reference touched Docker'

# (e) Compose no-op: update exits 0, the image never changes and verification fails. Never green.
setup_case same-image
export FAKE_UPDATE_NO_SWITCH=1
deploy_status
[[ "$status" == 1 ]] || fail "unchanged image with failed verification returned $status instead of 1: $(cat "$FAKE_STATE/output")"
grep -q 'verification failed, image unchanged' "$FAKE_STATE/output" || fail 'unchanged-image summary was missing'
grep -q '^QAAP_DEPLOY_RESULT=blocked$' "$FAKE_STATE/output" || fail 'unchanged-image result marker was missing'
[[ "$(cat "$FAKE_STATE/checked-out-sha")" == "$FAKE_OLD_BUILD" ]] || fail 'unchanged image did not restore the serving revision checkout'
if grep -Eq '^(up|run)\|' "$FAKE_STATE/compose.env"; then fail 'unchanged image ran compose up/run'; fi

# (f) Update fails before switching with a code that collides with "manual" (3): still a plain block.
setup_case update-fails-before-switch
export FAKE_UPDATE_NO_SWITCH=1 FAKE_UPDATE_STATUS=3
deploy_status
[[ "$status" == 1 ]] || fail "update failure before the switch returned $status instead of 1"
grep -q "update exited 3" "$FAKE_STATE/output" || fail 'update exit status was not reported'

# (g) Update fails after switching the image: roll back even though nothing was verified.
setup_case update-fails-after-switch
export FAKE_UPDATE_STATUS=4
deploy_status
[[ "$status" == 1 ]] || fail "update failure after the switch returned $status instead of 1: $(cat "$FAKE_STATE/output")"
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'update failure after the switch did not restore the target image'
grep -q 'update script exited 4 after switching' "$FAKE_STATE/output" || fail 'post-switch update failure was not the reported trigger'
assert_rollback_compose_pinned

# (h) Expired smoke credential: block before deploying instead of rolling back a healthy release.
setup_case expired-credential
export FAKE_WORKSPACE_STATUS=401
deploy_status
[[ "$status" == 1 ]] || fail "expired credential returned $status instead of 1"
grep -q 'smoke cookie or session is expired' "$FAKE_STATE/output" || fail 'expired credential was not reported'
[[ ! -s "$FAKE_STATE/update.calls" ]] || fail 'expired credential still ran the update'

# (h2) The session is rejected only after the switch: health passed, so no rollback and no retries.
setup_case credential-expires-mid-deploy
export FAKE_CANDIDATE_WORKSPACE_STATUS=401 QAAP_VPS_VERIFY_TIMEOUT_SECONDS=30
deploy_status
export QAAP_VPS_VERIFY_TIMEOUT_SECONDS=1
[[ "$status" == 3 ]] || fail "credential rejected after the switch returned $status instead of 3: $(cat "$FAKE_STATE/output")"
grep -q 'Not rolled back' "$FAKE_STATE/output" || fail 'credential rejection after the switch was not explained'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'credential rejection rolled back a healthy release'
[[ "$(grep -c 'new release verification attempt' "$FAKE_STATE/output")" == 1 ]] || fail 'a rejected session was retried'

# (i) Candidate fails the launch-readiness gate: rollback (the gates are part of verification).
setup_case readiness-failure
cat > "$TEST_ROOT/repo/scripts/qaap-verify-launch-readiness.sh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
echo launch-readiness >> "$FAKE_STATE/gates"
[[ "$(cat "$FAKE_STATE/current-image")" != "$FAKE_NEW_IMAGE_ID" ]]
MOCK
deploy_status
[[ "$status" == 1 ]] || fail "candidate readiness failure returned $status instead of 1"
grep -q 'new release launch-readiness gate failed' "$FAKE_STATE/output" || fail 'readiness gate failure was not reported'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'readiness failure did not roll back'
cat > "$TEST_ROOT/repo/scripts/qaap-verify-launch-readiness.sh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
echo launch-readiness >> "$FAKE_STATE/gates"
[[ "${FAKE_GATE_FAIL:-}" != launch-readiness ]]
MOCK

# (j) A candidate that declares an irreversible migration is never rolled back automatically.
setup_case unsafe-migration
export FAKE_CANDIDATE_WORKSPACE_FAIL=1 FAKE_NEW_ROLLBACK_LABEL=unsafe
deploy_status
[[ "$status" == 3 ]] || fail "unsafe migration returned $status instead of 3"
grep -q 'ai.qaap.rollback=unsafe' "$FAKE_STATE/output" || fail 'unsafe migration label was not reported'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'unsafe migration still replaced the candidate'
if grep -q 'compose stop' "$FAKE_STATE/docker.calls"; then fail 'unsafe migration still stopped the candidate'; fi

# (k) Rootless tenant cleanup fails: rollback still restores the target, with a warning.
setup_case cleanup-failure
export FAKE_CANDIDATE_WORKSPACE_FAIL=1 FAKE_ROOTLESS_RM_FAIL=tenant-new
deploy_status
[[ "$status" == 1 ]] || fail "rollback with cleanup failure returned $status instead of 1"
grep -q 'cleanup of one or more rootless tenant containers was incomplete' "$FAKE_STATE/output" || fail 'cleanup warning missing from summary'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'cleanup failure prevented rollback'

# (l) The target tenant image is missing from rootless Docker: it is seeded from the host before
#     the deploy, so the rollback stays possible.
setup_case missing-tenant-image
: > "$FAKE_STATE/rootless-old-tenant-missing"
export FAKE_CANDIDATE_WORKSPACE_FAIL=1
deploy_status
[[ "$status" == 1 ]] || fail "rollback after seeding the tenant image returned $status instead of 1: $(cat "$FAKE_STATE/output")"
grep -Fxq "image-archive:$FAKE_OLD_TENANT_IMAGE" "$FAKE_STATE/rootless.loaded" || fail 'target tenant image was not seeded into rootless Docker'
seed_line="$(line_of 'rootless load')"
update_line="$(grep -n -m 1 -F "up|$FAKE_CANDIDATE_REF|" "$FAKE_STATE/compose.env" | cut -d: -f1)"
[[ -n "$seed_line" && -n "$update_line" ]] || fail 'seed or switch was not recorded'
grep -q '^QAAP_DEPLOY_RESULT=rolled_back$' "$FAKE_STATE/output" || fail 'rollback did not complete after seeding'

# (l2) The target image is gone from the host and cannot be pulled again: block before deploying.
setup_case missing-target-image
: > "$FAKE_STATE/host-target-missing"
export FAKE_PULL_FAIL=1
deploy_status
[[ "$status" == 1 ]] || fail "unusable rollback target returned $status instead of 1"
grep -q "rollback target $FAKE_TARGET_REF is not usable" "$FAKE_STATE/output" || fail 'unusable rollback target was not reported'
grep -Fxq "host $FAKE_TARGET_REF" "$FAKE_STATE/pulls" || fail 'missing target image was not pulled by digest'
[[ ! -s "$FAKE_STATE/update.calls" ]] || fail 'unusable rollback target still ran the update'

# (l3) The target image was pruned but can be pulled by digest: deploy proceeds.
setup_case pull-target-image
: > "$FAKE_STATE/host-target-missing"
deploy_status
[[ "$status" == 0 ]] || fail "re-pullable rollback target blocked the deploy: $(cat "$FAKE_STATE/output")"
grep -Fxq "host $FAKE_TARGET_REF" "$FAKE_STATE/pulls" || fail 'missing target image was not pulled by digest'

# (m) Another deploy holds the lock: block without touching Docker state.
setup_case locked
exec 8>"$QAAP_DEPLOY_LOCK_FILE"
flock -n 8
deploy_status
exec 8>&-
[[ "$status" == 1 ]] || fail "locked deploy returned $status instead of 1"
grep -q 'Another VPS deploy holds' "$FAKE_STATE/output" || fail 'lock contention was not reported'
[[ ! -s "$FAKE_STATE/update.calls" ]] || fail 'locked deploy still ran the update'

echo 'qaap-vps-rollback tests passed (21 scenarios)'
