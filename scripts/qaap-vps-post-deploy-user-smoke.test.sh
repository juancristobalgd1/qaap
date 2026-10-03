#!/usr/bin/env bash
# Exercise post-deploy checks with a fake curl; no live service or credentials are needed.
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
        *) url="$1"; shift ;;
    esac
done
printf '%s\n' "$url" >> "$QAAP_TEST_URLS"
case "$url" in
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
        status="${QAAP_TEST_HOME_STATUS:-200}"
        body='home'
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
    unset QAAP_TEST_HOME_STATUS QAAP_TEST_CONFIG_STATUS QAAP_TEST_DEPLOYED_BUILD QAAP_TEST_APPROVALS_STATUS
    unset QAAP_TEST_EXPECT_COOKIE QAAP_SMOKE_SESSION QAAP_SMOKE_COOKIE
}

# Public checks always run, and missing user credentials produce an explicit warning only.
reset_case
if ! "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" \
    > "$TEST_ROOT/anonymous.out" 2>&1; then
    fail "anonymous post-deploy smoke failed: $(cat "$TEST_ROOT/anonymous.out")"
fi
grep -q 'home returned HTTP 200' "$TEST_ROOT/anonymous.out" || fail 'home success was not reported'
grep -q 'auth/config reports deployed build aaaaaaaaaaaa' "$TEST_ROOT/anonymous.out" || fail 'deployed build success was not reported'
grep -q 'QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is unset' "$TEST_ROOT/anonymous.out" || fail 'missing session warning was unclear'
if grep -Eq '/qaap-dev/api/probe|agent-approvals' "$QAAP_TEST_URLS"; then
    fail 'anonymous smoke requested an authenticated or preview endpoint'
fi

# A configured session checks the live authenticated tenant route and never logs the cookie.
reset_case
export QAAP_SMOKE_SESSION='smoke-session'
export QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
if ! "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" \
    > "$TEST_ROOT/signed-in.out" 2>&1; then
    fail "signed-in post-deploy smoke failed: $(cat "$TEST_ROOT/signed-in.out")"
fi
grep -q 'signed-in agent-approvals returned HTTP 200' "$TEST_ROOT/signed-in.out" || fail 'authenticated success was not reported'
if grep -Fq 'smoke-session' "$TEST_ROOT/signed-in.out"; then fail 'smoke secret leaked to output'; fi
grep -Fxq 'https://qaap.example.test/qaap/api/agent-approvals' "$QAAP_TEST_URLS" || fail 'authenticated route was not checked'
if grep -q '/qaap-dev/api/probe' "$QAAP_TEST_URLS"; then fail 'smoke made a preview probe call without preview'; fi

# Exact HTTP status, deployed build, and signed-in API failures all block the post-deploy step.
reset_case
export QAAP_TEST_HOME_STATUS=204
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/home-fail.out" 2>&1; then
    fail 'a non-200 home page was accepted'
fi
grep -q 'expected home HTTP 200, got 204' "$TEST_ROOT/home-fail.out" || fail 'home failure was unclear'

reset_case
export QAAP_TEST_CONFIG_STATUS=503
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/config-fail.out" 2>&1; then
    fail 'a non-200 auth/config response was accepted'
fi
grep -q 'expected auth/config HTTP 200, got 503' "$TEST_ROOT/config-fail.out" || fail 'auth/config status failure was unclear'

reset_case
export QAAP_TEST_DEPLOYED_BUILD='bbbbbbbbbbbb'
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/build-fail.out" 2>&1; then
    fail 'a mismatched deployed build was accepted'
fi
grep -q 'expected build aaaaaaaaaaaa, got bbbbbbbbbbbb' "$TEST_ROOT/build-fail.out" || fail 'build mismatch was unclear'

reset_case
export QAAP_SMOKE_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_EXPECT_COOKIE='qaap_sid=smoke-session'
export QAAP_TEST_APPROVALS_STATUS=502
if "$TEST_ROOT/qaap-vps-post-deploy-user-smoke.sh" https://qaap.example.test "$EXPECTED_SHA" > "$TEST_ROOT/approvals-fail.out" 2>&1; then
    fail 'a failing signed-in agent-approvals response was accepted'
fi
grep -q 'expected agent-approvals HTTP 200, got 502' "$TEST_ROOT/approvals-fail.out" || fail 'agent-approvals failure was unclear'

echo 'qaap-vps-post-deploy-user-smoke tests passed'
