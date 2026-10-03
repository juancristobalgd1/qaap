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
for script in qaap-vps-rollback.sh qaap-vps-post-deploy-user-smoke.sh qaap-vps-normalize-public-url.sh; do
    sed 's/\r$//' "$SOURCE/$script" > "$TEST_ROOT/repo/scripts/$script"
done

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
date -u +%s%N > "$QAAP_VPS_DEPLOY_STARTED_AT_FILE"
sleep 0.02
date -u +%Y-%m-%dT%H:%M:%S.%NZ > "$FAKE_STATE/rootless/backend-new.created"
QAAP_THEIA_IMAGE="$image_ref" docker compose up -d --no-build theia
MOCK

cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
daemon='host'
[[ "${DOCKER_HOST:-}" == 'unix:///run/user/1000/docker.sock' ]] && daemon='rootless'
printf '%s %s\n' "$daemon" "$*" >> "$FAKE_STATE/docker.calls"

read_current_image() { cat "$FAKE_STATE/current-image"; }
case "$1" in
    compose)
        shift
        case "$1" in
            ps)
                printf '%s\n' theia-container
                ;;
            up)
                [[ "${QAAP_THEIA_IMAGE:-}" ]] || { echo 'QAAP_THEIA_IMAGE missing' >&2; exit 21; }
                [[ " $* " == *' --no-build '* ]] || { echo '--no-build missing' >&2; exit 22; }
                image="$QAAP_THEIA_IMAGE"
                if [[ "$image" == "$FAKE_CANDIDATE_REF" ]]; then
                    image="$FAKE_NEW_IMAGE_ID"
                fi
                if [[ "$image" == "$FAKE_OLD_IMAGE_ID" && "${FAKE_FAIL_ROLLBACK:-0}" == 1 ]]; then
                    echo 'simulated rollback compose failure' >&2
                    exit 23
                fi
                printf '%s\n' "$image" > "$FAKE_STATE/current-image"
                ;;
            *) echo "unexpected docker compose command: $*" >&2; exit 2 ;;
        esac
        ;;
    inspect)
        shift
        if [[ "$daemon" == host ]]; then
            if [[ "$1" == -f || "$1" == --format ]]; then
                format="$2"
                if [[ "$format" == *'.Image'* ]]; then
                    read_current_image
                else
                    exit 24
                fi
            else
                exit 2
            fi
        else
            [[ "$1" == --format && "$2" == *'.Name'*'.Created'* ]] || exit 25
            id="$3"
            case "$id" in
                backend-new) printf '/qaap-backend-new|%s\n' "$(cat "$FAKE_STATE/rootless/backend-new.created")" ;;
                tenant-new) printf '/qaap-tenant-new|%s\n' "$(cat "$FAKE_STATE/rootless/backend-new.created")" ;;
                ingress-new) printf '/qaap-ingress-new|%s\n' "$(cat "$FAKE_STATE/rootless/backend-new.created")" ;;
                backend-old) printf '/qaap-backend-old|%s\n' "$FAKE_OLD_CREATED" ;;
                other-new) printf '/unrelated-container|%s\n' "$(cat "$FAKE_STATE/rootless/backend-new.created")" ;;
                *) exit 26 ;;
            esac
        fi
        ;;
    image)
        [[ "$2" == inspect ]] || exit 2
        image="$3"
        if [[ " ${*:4} " == *'--format'* ]]; then
            if [[ "$image" == "$FAKE_OLD_IMAGE_ID" ]]; then
                printf '%s\n' "$FAKE_OLD_BUILD"
            elif [[ "$image" == "$FAKE_NEW_IMAGE_ID" ]]; then
                printf '%s\n' "$FAKE_NEW_BUILD"
            else
                exit 27
            fi
        elif [[ "$image" != "$FAKE_OLD_IMAGE_ID" ]]; then
            exit 28
        fi
        ;;
    ps)
        [[ "$daemon" == rootless ]] || exit 2
        printf '%s\n' backend-new tenant-new ingress-new backend-old other-new
        ;;
    rm)
        [[ "$daemon" == rootless && "$2" == --force && $# == 3 ]] || { echo 'container removal must preserve volumes' >&2; exit 29; }
        printf '%s\n' "$3" >> "$FAKE_STATE/rootless.removed"
        ;;
    *) echo "unexpected docker command: $*" >&2; exit 2 ;;
esac
MOCK

cat > "$TEST_ROOT/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
output=''
cookie=''
write_out=''
url=''
while (($#)); do
    case "$1" in
        --output|-o) output="$2"; shift 2 ;;
        --cookie|-b) cookie="$2"; shift 2 ;;
        --write-out|-w) write_out="$2"; shift 2 ;;
        --max-time) shift 2 ;;
        --silent|--show-error|--fail|-s|-S|-f) shift ;;
        *) url="$1"; shift ;;
    esac
done
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
        body="{\"ok\":true,\"ready\":true,\"build\":\"${build:0:12}\"}"
        ;;
    */qaap/api/auth/config)
        status=200
        body="{\"build\":\"${build:0:12}\"}"
        ;;
    */qaap/api/agent-approvals)
        [[ "$cookie" == 'qaap_sid=test-session' ]] || { echo 'wrong approvals cookie' >&2; exit 31; }
        status=200
        body='{"approvals":[]}'
        ;;
    */)
        [[ "$cookie" == 'qaap_sid=test-session' ]] || { echo 'workspace request was not authenticated' >&2; exit 32; }
        if [[ "$current" == "$FAKE_NEW_IMAGE_ID" && "${FAKE_CANDIDATE_WORKSPACE_FAIL:-0}" == 1 ]]; then
            status=502
            body='Tenant backend unavailable'
        else
            status=200
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
MOCK

chmod +x "$TEST_ROOT/bin/docker" "$TEST_ROOT/bin/curl" "$TEST_ROOT/repo/scripts/qaap-vps-update.sh" \
    "$TEST_ROOT/repo/scripts/qaap-vps-rollback.sh" "$TEST_ROOT/repo/scripts/qaap-vps-post-deploy-user-smoke.sh"
export PATH="$TEST_ROOT/bin:$PATH"
export FAKE_STATE="$TEST_ROOT/state"
export FAKE_OLD_IMAGE_ID="sha256:$(printf '1%.0s' {1..64})"
export FAKE_NEW_IMAGE_ID="sha256:$(printf '2%.0s' {1..64})"
export FAKE_OLD_BUILD="$(printf 'a%.0s' {1..40})"
export FAKE_NEW_BUILD="$(printf 'b%.0s' {1..40})"
export FAKE_CANDIDATE_REF='ghcr.io/qaap/qaap:candidate@sha256:abcd'
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
    : > "$FAKE_STATE/rootless.removed"
    printf '%s\n' "$FAKE_OLD_CREATED" > "$FAKE_STATE/rootless/backend-old.created"
    printf '%s\n' "$FAKE_OLD_CREATED" > "$FAKE_STATE/rootless/backend-new.created"
    unset FAKE_CANDIDATE_WORKSPACE_FAIL FAKE_FAIL_ROLLBACK FAKE_HEALTH_STATUS QAAP_SMOKE_COOKIE
    export QAAP_SMOKE_SESSION='test-session'
}
run_deploy() {
    "$TEST_ROOT/repo/scripts/qaap-vps-rollback.sh" master "$FAKE_NEW_BUILD" "$FAKE_CANDIDATE_REF" https://qaap.example.test
}

# Guard every production compose up: the resolved serving image must be explicit and builds disabled.
awk '
    /^[[:space:]]*#/ { next }
    {
        command = command " " $0
        if ($0 !~ /\\[[:space:]]*$/) {
            if (command ~ /docker compose up/) {
                count++
                if (command !~ /QAAP_THEIA_IMAGE=/ || command !~ /--no-build/) {
                    print "FAIL: compose up must pin QAAP_THEIA_IMAGE and use --no-build:" command > "/dev/stderr"
                    exit 1
                }
            }
            command = ""
        }
    }
    END {
        if (count != 4) {
            print "FAIL: expected four guarded compose up commands, found " count > "/dev/stderr"
            exit 1
        }
    }
' "$SOURCE/qaap-vps-update.sh" "$SOURCE/qaap-vps-rollback.sh" || fail 'compose up safety invariant failed'

# (a) Healthy deploy verifies the new health build and authenticated workspace; it never rolls back.
setup_case healthy
if ! run_deploy > "$FAKE_STATE/output" 2>&1; then
    fail "healthy deploy failed: $(cat "$FAKE_STATE/output")"
fi
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'healthy deploy did not leave the candidate image serving'
grep -q 'authenticated workspaces' "$FAKE_STATE/output" || fail 'healthy workspace verification was not reported'
if grep -q 'MANUAL INTERVENTION\|ROLLED BACK' "$FAKE_STATE/output"; then fail 'healthy deploy incorrectly rolled back'; fi
if [[ -s "$FAKE_STATE/rootless.removed" ]]; then fail 'healthy deploy removed rootless containers'; fi

# (b) Health stays 200 while the authenticated workspace returns 502; rollback restores the exact old image.
setup_case workspace-failure
export FAKE_CANDIDATE_WORKSPACE_FAIL=1
if run_deploy > "$FAKE_STATE/output" 2>&1; then
    fail 'failed candidate smoke unexpectedly returned success after rollback'
else
    status=$?
    [[ "$status" == 1 ]] || fail "successful rollback returned $status instead of 1"
fi
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'rollback did not restore the exact previous image id'
grep -q 'health reports deployed build bbbbbbbbbbbb' "$FAKE_STATE/output" || fail 'candidate health was not observed as healthy before smoke failed'
grep -q 'Tenant backend unavailable' "$FAKE_STATE/output" || fail 'workspace 502 body was not reported'
grep -q "ROLLED BACK to ${FAKE_OLD_BUILD:0:12}" "$FAKE_STATE/output" || fail 'rollback success message was missing'
for container in backend-new tenant-new ingress-new; do
    grep -Fxq "$container" "$FAKE_STATE/rootless.removed" || fail "new rootless $container container was not removed"
done
if grep -Eq 'backend-old|other-new' "$FAKE_STATE/rootless.removed"; then fail 'rollback removed a preexisting or unrelated rootless container'; fi
grep -q 'host compose up -d --no-build theia' "$FAKE_STATE/docker.calls" || fail 'rollback did not run compose up --no-build for theia'

# (c) Compose cannot restore the previous image: report manual intervention and use a distinct code.
setup_case rollback-failure
export FAKE_CANDIDATE_WORKSPACE_FAIL=1 FAKE_FAIL_ROLLBACK=1
if run_deploy > "$FAKE_STATE/output" 2>&1; then
    fail 'failed rollback unexpectedly returned success'
else
    status=$?
    [[ "$status" == 2 ]] || fail "failed rollback returned $status instead of distinct code 2"
fi
grep -q 'MANUAL INTERVENTION NEEDED' "$FAKE_STATE/output" || fail 'manual intervention message was missing'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_NEW_IMAGE_ID" ]] || fail 'fake failed rollback unexpectedly changed the serving image'

# (d) Without smoke credentials, refuse the deploy before calling docker or the update script.
setup_case missing-secrets
unset QAAP_SMOKE_SESSION QAAP_SMOKE_COOKIE
if run_deploy > "$FAKE_STATE/output" 2>&1; then fail 'deploy proceeded without smoke secrets'; fi
grep -q 'QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is required' "$FAKE_STATE/output" || fail 'missing smoke secret failure was not explicit'
[[ "$(cat "$FAKE_STATE/current-image")" == "$FAKE_OLD_IMAGE_ID" ]] || fail 'missing secrets changed the serving image'
[[ ! -s "$FAKE_STATE/docker.calls" ]] || fail 'missing secrets touched Docker before failing'

echo 'qaap-vps-rollback tests passed (4 scenarios: success, smoke rollback, rollback failure, missing secrets)'
