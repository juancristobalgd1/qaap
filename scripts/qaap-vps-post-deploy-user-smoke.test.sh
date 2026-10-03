#!/usr/bin/env bash
# Exercise the health and authenticated workspace smoke with a fake curl.
set -euo pipefail

SOURCE="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-post-deploy-user-smoke-test.XXXXXXXX)"
cleanup() {
    case "$TEST_ROOT" in
        */qaap-post-deploy-user-smoke-test.*) rm -rf -- "$TEST_ROOT" ;;
        *) echo "Refusing to remove unexpected test path: $TEST_ROOT" >&2; exit 2 ;;
    esac
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/bin"
sed 's/\r$//' "$SOURCE/qaap-vps-post-deploy-user-smoke.sh" > "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh"
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
        --silent|--show-error|-s|-S) shift ;;
        *) url="$1"; shift ;;
    esac
done
printf '%s|%s\n' "$url" "$cookie" >> "$QAAP_TEST_URLS"
case "$url" in
    */qaap/api/health)
        status="${QAAP_TEST_HEALTH_STATUS:-200}"
        body="{\"ok\":${QAAP_TEST_HEALTH_OK:-true},\"ready\":${QAAP_TEST_HEALTH_READY:-true},\"build\":\"${QAAP_TEST_HEALTH_BUILD:-aaaaaaaaaaaa}\"}"
        ;;
    */qaap/api/auth/config)
        status="${QAAP_TEST_CONFIG_STATUS:-200}"
        body="{\"build\":\"${QAAP_TEST_DEPLOYED_BUILD:-aaaaaaaaaaaa}\"}"
        ;;
    */qaap/api/agent-approvals)
        [[ "$cookie" == "${QAAP_TEST_EXPECT_COOKIE:-}" ]] || { echo 'agent approvals cookie mismatch' >&2; exit 9; }
        status="${QAAP_TEST_APPROVALS_STATUS:-200}"
        body='{"approvals":[]}'
        ;;
    */)
        [[ "$cookie" == "${QAAP_TEST_EXPECT_COOKIE:-}" ]] || { echo 'workspace cookie mismatch' >&2; exit 10; }
        status="${QAAP_TEST_WORKSPACE_STATUS:-200}"
        body="${QAAP_TEST_WORKSPACE_BODY:-workspace ready}"
        ;;
    *) echo "Unexpected URL: $url" >&2; exit 2 ;;
esac
if [[ -n "$output" && "$output" != /dev/null ]]; then
    printf '%s\n' "$body" > "$output"
fi
if [[ -n "$write_out" ]]; then
    printf '%s' "$status"
fi
MOCK
chmod +x "$TEST_ROOT/bin/curl" "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh"
export PATH="$TEST_ROOT/bin:$PATH"
export QAAP_TEST_URLS="$TEST_ROOT/urls"
EXPECTED_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

fail() { echo "FAIL: $*" >&2; exit 1; }
reset_case() {
    : > "$QAAP_TEST_URLS"
    unset QAAP_TEST_HEALTH_STATUS QAAP_TEST_HEALTH_OK QAAP_TEST_HEALTH_READY QAAP_TEST_HEALTH_BUILD
    unset QAAP_TEST_CONFIG_STATUS QAAP_TEST_DEPLOYED_BUILD QAAP_TEST_APPROVALS_STATUS
    unset QAAP_TEST_WORKSPACE_STATUS QAAP_TEST_WORKSPACE_BODY QAAP_TEST_EXPECT_COOKIE
    unset QAAP_SMOKE_SESSION QAAP_SMOKE_COOKIE
}

# Missing credentials must fail clearly before sending any requests.
reset_case
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" \
    > "$TEST_ROOT/missing-secret.out" 2>&1; then
    fail 'smoke accepted missing authentication secrets'
fi
grep -q 'QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is required' "$TEST_ROOT/missing-secret.out" || fail 'missing secret failure was unclear'
[[ ! -s "$QAAP_TEST_URLS" ]] || fail 'smoke made requests without credentials'

# A valid session checks health, build, authenticated workspace root, and signed-in API.
reset_case
export QAAP_SMOKE_SESSION='smoke-session'
export QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
if ! "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" \
    > "$TEST_ROOT/signed-in.out" 2>&1; then
    fail "signed-in post-deploy smoke failed: $(cat "$TEST_ROOT/signed-in.out")"
fi
grep -q 'health reports deployed build aaaaaaaaaaaa' "$TEST_ROOT/signed-in.out" || fail 'health build success was not reported'
grep -q 'auth/config reports deployed build aaaaaaaaaaaa' "$TEST_ROOT/signed-in.out" || fail 'auth/config build success was not reported'
grep -q 'signed-in workspace root returned HTTP 200' "$TEST_ROOT/signed-in.out" || fail 'workspace success was not reported'
grep -q 'signed-in agent-approvals returned HTTP 200' "$TEST_ROOT/signed-in.out" || fail 'authenticated API success was not reported'
grep -Fxq 'https://qaap.example.test/|qaap_sid=smoke-session' "$QAAP_TEST_URLS" || fail 'workspace root was not requested with the session cookie'
grep -Fxq 'https://qaap.example.test/qaap/api/agent-approvals|qaap_sid=smoke-session' "$QAAP_TEST_URLS" || fail 'signed-in API was not requested with the session cookie'
if grep -Fq 'smoke-session' "$TEST_ROOT/signed-in.out"; then fail 'smoke secret leaked to output'; fi

# A health response must be HTTP 200, ready, and identify the expected build.
reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session' QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_HEALTH_STATUS=503
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/health-status-fail.out" 2>&1; then
    fail 'a non-200 health response was accepted'
fi
grep -q 'expected health HTTP 200, got 503' "$TEST_ROOT/health-status-fail.out" || fail 'health status failure was unclear'

reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session' QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_HEALTH_BUILD='bbbbbbbbbbbb'
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/health-build-fail.out" 2>&1; then
    fail 'a mismatched health build was accepted'
fi
grep -q 'expected health build aaaaaaaaaaaa, got bbbbbbbbbbbb' "$TEST_ROOT/health-build-fail.out" || fail 'health build mismatch was unclear'

reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session' QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_HEALTH_READY=false
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/health-ready-fail.out" 2>&1; then
    fail 'an unready health payload was accepted'
fi
grep -q 'health to report ok=true, ready=true' "$TEST_ROOT/health-ready-fail.out" || fail 'health readiness failure was unclear'

# Auth config and every authenticated user route require the exact response shape/status.
reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session' QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_CONFIG_STATUS=503
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/config-fail.out" 2>&1; then
    fail 'a non-200 auth/config response was accepted'
fi
grep -q 'expected auth/config HTTP 200, got 503' "$TEST_ROOT/config-fail.out" || fail 'auth/config status failure was unclear'

reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session' QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_DEPLOYED_BUILD='bbbbbbbbbbbb'
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/config-build-fail.out" 2>&1; then
    fail 'a mismatched auth/config build was accepted'
fi
grep -q 'expected build aaaaaaaaaaaa, got bbbbbbbbbbbb' "$TEST_ROOT/config-build-fail.out" || fail 'auth/config build mismatch was unclear'

reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session' QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_WORKSPACE_STATUS=502 QAAP_TEST_WORKSPACE_BODY='Tenant backend unavailable'
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/workspace-fail.out" 2>&1; then
    fail 'a workspace backend 502 was accepted'
fi
grep -q 'Tenant backend unavailable' "$TEST_ROOT/workspace-fail.out" || fail 'workspace unavailable body was not detected'

reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session' QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_WORKSPACE_STATUS=204
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/workspace-status-fail.out" 2>&1; then
    fail 'a non-200 workspace response was accepted'
fi
grep -q 'expected HTTP 200, got 204' "$TEST_ROOT/workspace-status-fail.out" || fail 'workspace status failure was unclear'

reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session' QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_APPROVALS_STATUS=502
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/approvals-fail.out" 2>&1; then
    fail 'a failing signed-in API response was accepted'
fi
grep -q 'expected agent-approvals HTTP 200, got 502' "$TEST_ROOT/approvals-fail.out" || fail 'agent-approvals failure was unclear'

echo 'qaap-vps-post-deploy-user-smoke tests passed (10 scenarios)'
