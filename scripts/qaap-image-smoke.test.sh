#!/usr/bin/env bash
# Exercise candidate orchestration and cleanup with fake Docker/HTTP; never use a daemon.
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-image-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-image-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT
mkdir -p "$TEST_ROOT/scripts" "$TEST_ROOT/bin"
for file in qaap-image-smoke.sh qaap-verify-launch-readiness.sh qaap-verify-auth-api-gate.sh qaap-release-config-check.js qaap-image-runtime-check.js; do
    sed 's/\r$//' "$SOURCE/$file" > "$TEST_ROOT/scripts/$file"
done
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
    pull) exit 0 ;;
    image) printf '%s\n' "${TEST_LABEL:-$TEST_SHA}" ;;
    run) printf '%064d\n' 1 ;;
    port) printf '127.0.0.1:4873\n' ;;
    inspect)
        if [[ "$*" == *RestartCount* ]]; then printf '0\n'; else printf 'true\n'; fi ;;
    exec) cat >/dev/null; exit "${TEST_EXEC_EXIT:-0}" ;;
    logs) echo 'candidate logs' ;;
    rm) printf 'removed\n' > "$TEST_REMOVAL" ;;
    *) echo "Unexpected docker command: $1" >&2; exit 2 ;;
esac
MOCK
cat > "$TEST_ROOT/bin/curl" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *'%{http_code}'* ]]; then
    case "$*" in
        */auth/config|*/api/health) printf 200 ;;
        *) printf '%s' "${TEST_API_CODE:-401}" ;;
    esac
else
    case "$*" in
        */legal/*) echo '<h1>Legal</h1>' ;;
        */auth/config|*/api/health)
            printf '{"ok":true,"ready":true,"skipAuth":false,"productionRuntime":true,"agentUidPerUser":true,"oauthConfigured":true,"betaAccessRequired":true,"betaAccessConfigured":true,"build":"%s"}' "${TEST_BUILD:-abcdef123456}" ;;
        *) echo '<html>Qaap</html>' ;;
    esac
fi
MOCK
chmod +x "$TEST_ROOT/bin/"*
export PATH="$TEST_ROOT/bin:$PATH"
export TEST_SHA="abcdef123456$(printf '%028d' 0)"
export TEST_REMOVAL="$TEST_ROOT/removed"
export QAAP_IMAGE_SMOKE_ARTIFACT_DIR="$TEST_ROOT/artifacts"
IMAGE="test.invalid/qaap@sha256:$(printf '%064d' 1)"
expect_status() {
    local expected="$1" removed="$2" result=0
    rm -f -- "$TEST_REMOVAL"
    bash "$TEST_ROOT/scripts/qaap-image-smoke.sh" "$IMAGE" "$TEST_SHA" > "$TEST_ROOT/output" 2>&1 || result=$?
    if [[ "$result" != "$expected" ]]; then cat "$TEST_ROOT/output"; exit 1; fi
    if [[ "$removed" == yes ]]; then
        [[ -f "$TEST_REMOVAL" && -s "$QAAP_IMAGE_SMOKE_ARTIFACT_DIR/container.log" ]] || { echo 'Missing cleanup/diagnostics' >&2; exit 1; }
    else
        [[ ! -f "$TEST_REMOVAL" ]] || { echo 'Removed a container without creating one' >&2; exit 1; }
    fi
}
expect_status 0 yes
export TEST_EXEC_EXIT=1
expect_status 1 yes
unset TEST_EXEC_EXIT
export TEST_API_CODE=200
expect_status 1 yes
unset TEST_API_CODE
export TEST_BUILD=111111111111
expect_status 1 yes
unset TEST_BUILD
export TEST_LABEL=wrong-commit
expect_status 1 no
echo 'PASS: candidate success, runtime failure, exposed API, wrong build, wrong label; cleanup verified'
