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
case "$1" in
    compose)
        shift
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
                    image="$QAAP_THEIA_IMAGE"
                    if [[ "$image" == "$FAKE_CANDIDATE_REF" ]]; then
                        image="$FAKE_NEW_IMAGE_ID"
                    elif [[ "$image" == qaap-theia:rollback ]]; then
                        image="$FAKE_OLD_IMAGE_ID"
                    fi
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
                    printf 'QAAP_DOCKER_ROOTLESS=1\nQAAP_TENANT_DOCKER_IMAGE=%s\nDOCKER_HOST=%s\n' \
                        "$FAKE_OLD_TENANT_IMAGE" "$FAKE_ROOTLESS_HOST"
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
        if [[ "$daemon" == rootless && "${FAKE_ROOTLESS_MISSING_IMAGE:-}" == "$2" ]]; then exit 30; fi
        ;;
    image)
        [[ "$2" == inspect ]] || exit 2
        image="$3"
        if [[ "$daemon" == rootless && "${FAKE_ROOTLESS_MISSING_IMAGE:-}" == "$image" ]]; then exit 28; fi
        if [[ " ${*:4} " == *'--format'* ]]; then
            if [[ "$image" == "$FAKE_OLD_IMAGE_ID" ]]; then
                if [[ " $* " == *'org.opencontainers.image.revision'* ]]; then
                    printf '%s\n' "${FAKE_OLD_LABEL_BUILD:-$FAKE_OLD_BUILD}"
                else
                    printf '%s\n' "$FAKE_OLD_BUILD"
                fi
            elif [[ "$image" == "$FAKE_NEW_IMAGE_ID" ]]; then
                if [[ " $* " == *'ai.qaap.rollback'* ]]; then
                    printf '%s\n' "${FAKE_NEW_ROLLBACK_LABEL:-}"
                else
                    printf '%s\n' "$FAKE_NEW_BUILD"
                fi
            else
                exit 27
            fi
        elif [[ "$image" != "$FAKE_OLD_IMAGE_ID" && "$image" != "$FAKE_OLD_TENANT_IMAGE" &&
            "$image" != qaap-theia:rollback && "$image" != qaap-tenant:rollback ]]; then
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
            body='workspace ready'
        fi
        ;;
    *) echo "unexpected curl URL: $url" >&2; exit 2 ;;
esac
if [[ -n "$output" && "$output" != /dev/null ]]; then
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
    cat-file) exit 0 ;;
    checkout) printf '%s\n' "$3" > "$FAKE_STATE/checked-out-sha" ;;
    rev-parse) printf '%s\n' "$FAKE_PREV_SHA" ;;
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
export FAKE_OLD_IMAGE_ID="sha256:$(printf '1%.0s' {1..64})"
export FAKE_NEW_IMAGE_ID="sha256:$(printf '2%.0s' {1..64})"
export FAKE_OLD_TENANT_IMAGE='ghcr.io/qaap/theia:old'
export FAKE_OLD_BUILD="$(printf 'a%.0s' {1..40})"
export FAKE_NEW_BUILD="$(printf 'b%.0s' {1..40})"
export FAKE_CANDIDATE_REF='ghcr.io/qaap/qaap:candidate@sha256:abcd'
export FAKE_PREV_SHA="$(printf 'c%.0s' {1..40})"
export QAAP_SMOKE_SESSION='test-session'
export QAAP_VPS_VERIFY_TIMEOUT_SECONDS=1
export QAAP_VPS_VERIFY_INTERVAL_SECONDS=0
export FAKE_OLD_CREATED="$(date -u -d '1 minute ago' +%Y-%m-%dT%H:%M:%S.%NZ)"
mkdir -p "$FAKE_STATE/rootless"

fail() { echo "FAIL: $*" >&2; exit 1; }
setup_case() {
    local name="$1"
    FAKE_STATE="$TEST_ROOT/state-$name"
    export FAKE_STATE
    mkdir -p "$FAKE_STATE/rootless"
    printf '%s\n' "$FAKE_OLD_IMAGE_ID" > "$FAKE_STATE/current-image"
    : > "$FAKE_STATE/docker.calls"
    : > "$FAKE_STATE/curl.calls"
    : > "$FAKE_STATE/gates"
    : > "$FAKE_STATE/actions"
    : > "$FAKE_STATE/tags"
    : > "$FAKE_STATE/rootless.removed"
    : > "$FAKE_STATE/rootless.stopped"
    : > "$FAKE_STATE/rootless.renamed"
    rm -f "$FAKE_STATE/capture-health-called"
    printf '%s\n' "$FAKE_OLD_CREATED" > "$FAKE_STATE/rootless/backend-old.created"
    printf '%s\n' "$FAKE_OLD_CREATED" > "$FAKE_STATE/rootless/backend-new.created"
    printf 'OTHER_SETTING=preserved\n' > "$TEST_ROOT/repo/.env"
    unset FAKE_CANDIDATE_WORKSPACE_FAIL FAKE_FAIL_ROLLBACK FAKE_HEALTH_STATUS QAAP_SMOKE_COOKIE
    unset FAKE_HEALTH_BUILD FAKE_CAPTURE_HEALTH_STATUS FAKE_CAPTURE_HEALTH_BUILD FAKE_OLD_LABEL_BUILD
    unset FAKE_WORKSPACE_STATUS FAKE_APPROVALS_STATUS FAKE_ROOTLESS_MISSING_IMAGE FAKE_ROOTLESS_INSPECT_FAIL
    unset FAKE_ROOTLESS_DISAPPEAR_INSPECT FAKE_ROOTLESS_DISAPPEAR_RM FAKE_ROOTLESS_RM_FAIL
    unset FAKE_UPDATE_NO_SWITCH FAKE_UPDATE_STATUS FAKE_CURRENT_MISSING FAKE_GATE_FAIL QAAP_VPS_ALLOW_NO_ROLLBACK
    unset FAKE_NEW_ROLLBACK_LABEL FAKE_ROOTLESS_DISAPPEAR_STOP FAKE_ROOTLESS_DISAPPEAR_RENAME
    export QAAP_SMOKE_SESSION='test-session'
    export QAAP_DEPLOY_LOCK_FILE="$FAKE_STATE/deploy.lock"
    export QAAP_DEPLOY_STATE_DIR="$FAKE_STATE/deploy-state"
    : > "$FAKE_STATE/update.calls"
    rm -f "$FAKE_STATE/checked-out-sha"
}
run_rollback_only() {
    (cd "$TEST_ROOT/outside" && "$TEST_ROOT/repo/scripts/qaap-vps-rollback.sh" \
        --rollback-only "$FAKE_NEW_BUILD" https://qaap.example.test "${1:-runner smoke failed}")
}
# Runs a deploy and stores its exit status in $status without tripping set -e.
deploy_status() {
    status=0
    run_deploy > "$FAKE_STATE/output" 2>&1 || status=$?
}
line_of() { grep -n -m 1 -F -- "$1" "$FAKE_STATE/docker.calls" | cut -d: -f1; }
run_deploy() {
    (mkdir -p "$TEST_ROOT/outside" && cd "$TEST_ROOT/outside" && "$TEST_ROOT/repo/scripts/qaap-vps-rollback.sh" \
        master "$FAKE_NEW_BUILD" "$FAKE_CANDIDATE_REF" https://qaap.example.test "$FAKE_PREV_SHA")
}

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

# (a) Healthy deploy verifies the new health build and authenticated workspace; it never rolls back.
setup_case healthy
deploy_status
[[ "$status" == 0 ]] || fail "healthy deploy failed: $(cat "$FAKE_STATE/output")"
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'healthy deploy did not leave the candidate image serving'
grep -q 'authenticated workspaces' "$FAKE_STATE/output" || fail 'healthy workspace verification was not reported'
grep -q '^QAAP_DEPLOY_RESULT=verified$' "$FAKE_STATE/output" || fail 'healthy deploy did not emit the verified result marker'
if grep -q 'MANUAL INTERVENTION\|ROLLED BACK' "$FAKE_STATE/output"; then fail 'healthy deploy incorrectly rolled back'; fi
if [[ -s "$FAKE_STATE/rootless.removed" ]]; then fail 'healthy deploy removed rootless containers'; fi
grep -Fxq "host $FAKE_OLD_IMAGE_ID qaap-theia:rollback" "$FAKE_STATE/tags" || fail 'previous Theia image was not protected with qaap-theia:rollback'
grep -Fxq "rootless $FAKE_OLD_TENANT_IMAGE qaap-tenant:rollback" "$FAKE_STATE/tags" || fail 'previous tenant image was not protected in rootless Docker'
grep -Fxq 'launch-readiness' "$FAKE_STATE/gates" || fail 'launch-readiness gate did not run'
grep -Fxq 'auth-api' "$FAKE_STATE/gates" || fail 'auth API gate did not run'
grep -q '^STATE_RESULT=verified$' "$QAAP_DEPLOY_STATE_DIR/rollback-target.env" || fail 'verified rollback target was not recorded'

# (a2) Runner-side verification fails after the VPS checks passed: --rollback-only restores the old release.
status=0
run_rollback_only 'build or authenticated workspace smoke failed from the runner' > "$FAKE_STATE/rollback-only.out" 2>&1 || status=$?
[[ "$status" == 1 ]] || fail "rollback-only returned $status instead of 1: $(cat "$FAKE_STATE/rollback-only.out")"
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'rollback-only did not restore the previous image'
grep -q '^QAAP_DEPLOY_RESULT=rolled_back$' "$FAKE_STATE/rollback-only.out" || fail 'rollback-only did not emit rolled_back'
grep -q 'external verification from the GitHub runner failed' "$FAKE_STATE/rollback-only.out" || fail 'rollback-only trigger was not reported'
[[ "$(cat "$FAKE_STATE/checked-out-sha")" == "$FAKE_PREV_SHA" ]] || fail 'rollback-only did not restore the previous repository revision'
status=0
run_rollback_only > "$FAKE_STATE/rollback-only-again.out" 2>&1 || status=$?
[[ "$status" == 3 ]] || fail "a second rollback-only for an already rolled back deploy returned $status instead of 3"

# (b) Health stays 200 while the authenticated workspace returns 502; rollback restores the exact old image.
setup_case workspace-failure
export FAKE_CANDIDATE_WORKSPACE_FAIL=1
deploy_status
[[ "$status" == 1 ]] || fail "successful rollback returned $status instead of 1: $(cat "$FAKE_STATE/output")"
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'rollback did not restore the exact previous image id'
grep -q 'health reports deployed build bbbbbbbbbbbb' "$FAKE_STATE/output" || fail 'candidate health was not observed as healthy before smoke failed'
grep -q 'Tenant backend unavailable' "$FAKE_STATE/output" || fail 'workspace 502 body was not reported'
grep -q "ROLLED BACK to ${FAKE_OLD_BUILD:0:12}" "$FAKE_STATE/output" || fail 'rollback success message was missing'
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
[[ "$(cat "$FAKE_STATE/checked-out-sha")" == "$FAKE_PREV_SHA" ]] || fail 'rollback did not restore the previous repository revision'
grep -Fxq 'QAAP_THEIA_IMAGE=qaap-theia:rollback' "$TEST_ROOT/repo/.env" || fail 'rollback did not pin the restored Theia image in .env'
grep -Fxq 'QAAP_TENANT_DOCKER_IMAGE=qaap-tenant:rollback' "$TEST_ROOT/repo/.env" || fail 'rollback did not pin the restored tenant image in .env'
grep -Fxq 'OTHER_SETTING=preserved' "$TEST_ROOT/repo/.env" || fail 'rollback lost unrelated .env settings'
grep -q 'host compose up -d --no-build --no-deps --force-recreate caddy' "$FAKE_STATE/docker.calls" || fail 'rollback did not refresh Caddy with the previous configuration'

# (c) Compose cannot restore the previous image: report manual intervention with the reserved code 3.
setup_case rollback-failure
export FAKE_CANDIDATE_WORKSPACE_FAIL=1 FAKE_FAIL_ROLLBACK=1
deploy_status
[[ "$status" == 3 ]] || fail "failed rollback returned $status instead of reserved code 3"
grep -q 'MANUAL INTERVENTION NEEDED' "$FAKE_STATE/output" || fail 'manual intervention message was missing'
grep -q '^QAAP_DEPLOY_RESULT=manual$' "$FAKE_STATE/output" || fail 'manual result marker was missing'
grep -q '^QAAP_DEPLOY_REASON=docker compose could not restore theia image' "$FAKE_STATE/output" || fail 'manual reason was not on stdout'

# (d) Without smoke credentials, refuse the deploy before calling docker or the update script.
setup_case missing-secrets
unset QAAP_SMOKE_SESSION QAAP_SMOKE_COOKIE
deploy_status
[[ "$status" != 0 ]] || fail 'deploy proceeded without smoke secrets'
grep -q 'QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is required' "$FAKE_STATE/output" || fail 'missing smoke secret failure was not explicit'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'missing secrets changed the serving image'
[[ ! -s "$FAKE_STATE/docker.calls" ]] || fail 'missing secrets touched Docker before failing'

# (e) Compose no-op: update exits 0, the image never changes and verification fails. Never green.
setup_case same-image
export FAKE_UPDATE_NO_SWITCH=1
deploy_status
[[ "$status" == 1 ]] || fail "unchanged image with failed verification returned $status instead of 1"
grep -q 'verification failed, image unchanged' "$FAKE_STATE/output" || fail 'unchanged-image summary was missing'
grep -q '^QAAP_DEPLOY_RESULT=blocked$' "$FAKE_STATE/output" || fail 'unchanged-image result marker was missing'
[[ "$(cat "$FAKE_STATE/checked-out-sha")" == "$FAKE_PREV_SHA" ]] || fail 'unchanged image did not restore the previous Compose/Caddy revision'

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
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'update failure after the switch did not restore the previous image'
grep -q 'update script exited 4 after switching' "$FAKE_STATE/output" || fail 'post-switch update failure was not the reported trigger'

# (h) Expired smoke credential: block before deploying instead of rolling back a healthy release.
setup_case expired-credential
export FAKE_WORKSPACE_STATUS=401
deploy_status
[[ "$status" == 1 ]] || fail "expired credential returned $status instead of 1"
grep -q 'smoke cookie or session is expired' "$FAKE_STATE/output" || fail 'expired credential was not reported'
[[ ! -s "$FAKE_STATE/update.calls" ]] || fail 'expired credential still ran the update'
[[ ! -s "$FAKE_STATE/tags" ]] || fail 'expired credential still changed rollback tags'

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

# (k) Rootless tenant cleanup fails: rollback still restores the previous release, with a warning.
setup_case cleanup-failure
export FAKE_CANDIDATE_WORKSPACE_FAIL=1 FAKE_ROOTLESS_RM_FAIL=tenant-new
deploy_status
[[ "$status" == 1 ]] || fail "rollback with cleanup failure returned $status instead of 1"
grep -q 'tenant cleanup warning\|cleanup of one or more rootless tenant containers was incomplete' "$FAKE_STATE/output" || fail 'cleanup warning missing from summary'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'cleanup failure prevented rollback'

# (l) The previous tenant image is missing from rootless Docker: block before deploying.
setup_case missing-tenant-image
export FAKE_ROOTLESS_MISSING_IMAGE="$FAKE_OLD_TENANT_IMAGE"
deploy_status
[[ "$status" == 1 ]] || fail "missing rollback tenant image returned $status instead of 1"
grep -q 'previous tenant image is missing from rootless Docker' "$FAKE_STATE/output" || fail 'missing tenant image was not reported'
[[ ! -s "$FAKE_STATE/update.calls" ]] || fail 'missing tenant image still ran the update'

# (m) Another deploy holds the lock: block without touching Docker state.
setup_case locked
exec 8>"$QAAP_DEPLOY_LOCK_FILE"
flock -n 8
deploy_status
exec 8>&-
[[ "$status" == 1 ]] || fail "locked deploy returned $status instead of 1"
grep -q 'Another VPS deploy holds' "$FAKE_STATE/output" || fail 'lock contention was not reported'
[[ ! -s "$FAKE_STATE/update.calls" ]] || fail 'locked deploy still ran the update'

echo 'qaap-vps-rollback tests passed (14 scenarios)'
