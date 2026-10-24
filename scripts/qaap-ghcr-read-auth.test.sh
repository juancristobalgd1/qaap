#!/usr/bin/env bash
# Tests the optional read-only GHCR login (scripts/qaap-ghcr-read-auth.sh) against fake docker and
# sudo binaries. Checks: no settings means no login at all; a token only ever reaches stdin (never
# argv or the log); host and rootless logins both happen; logout runs; a partial setting is refused.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-ghcr-auth-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-ghcr-auth-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT

TOKEN='ghp_FAKEREADTOKEN0123456789'
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/repo"
cp "$ROOT/scripts/qaap-ghcr-read-auth.sh" "$TEST_ROOT/lib.sh"
SOCKET="$TEST_ROOT/rootless.sock"
python3 -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])' "$SOCKET"

# Fake docker: records argv and DOCKER_HOST; for login, records the stdin it received separately.
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
echo "docker[DOCKER_HOST=${DOCKER_HOST:-}] $*" >> "$FAKE_LOG"
if [[ "${1:-}" == login ]]; then
    cat >> "$FAKE_STDIN"
    [[ "${FAKE_LOGIN_FAIL:-}" == "${DOCKER_HOST:-host}" ]] && exit 1
fi
exit 0
MOCK
# Fake sudo: drops -n and -u USER, then runs the command.
cat > "$TEST_ROOT/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
echo "sudo $*" >> "$FAKE_LOG"
shift; [[ "${1:-}" == -u ]] && shift 2
exec "$@"
MOCK
chmod +x "$TEST_ROOT/bin/docker" "$TEST_ROOT/bin/sudo"

pass() { echo "ok - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }

run_case() {
    # $1 = .env content (may be empty), remaining args = extra env assignments
    local env_content="$1"; shift
    : > "$TEST_ROOT/repo/.env"
    printf '%s' "$env_content" > "$TEST_ROOT/repo/.env"
    export FAKE_LOG="$TEST_ROOT/calls" FAKE_STDIN="$TEST_ROOT/stdin"
    : > "$FAKE_LOG"; : > "$FAKE_STDIN"
    env -u QAAP_GHCR_USERNAME -u QAAP_GHCR_READ_TOKEN "$@" PATH="$TEST_ROOT/bin:$PATH" REPO_DIR="$TEST_ROOT/repo" \
        QAAP_ROOTLESS_SOCKET="$SOCKET" QAAP_ROOTLESS_USER=ubuntu bash -c '
            set -euo pipefail
            source "$1"
            qaap_ghcr_login
            printf "AUTH=%s\n" "$QAAP_GHCR_AUTHENTICATED"
            qaap_ghcr_logout
        ' _ "$TEST_ROOT/lib.sh"
}

# 1) No settings: no docker login, no logout, anonymous.
out="$(run_case '')"
[[ "$out" == *'AUTH=0'* ]] || fail 'anonymous mode reports authenticated'
[[ ! -s "$TEST_ROOT/calls" ]] || fail "anonymous mode ran docker/sudo: $(cat "$TEST_ROOT/calls")"
pass 'no settings: no login, no logout'

# 2) Settings in .env: host and rootless login, token on stdin only, logout afterwards.
out="$(run_case "QAAP_GHCR_USERNAME=jc-reader
QAAP_GHCR_READ_TOKEN=$TOKEN
")"
[[ "$out" == *'AUTH=1'* ]] || fail 'configured mode not authenticated'
grep -Fxq 'docker[DOCKER_HOST=] login ghcr.io --username jc-reader --password-stdin' "$TEST_ROOT/calls" || fail 'no host login'
grep -Fq "docker[DOCKER_HOST=unix://$SOCKET] login ghcr.io --username jc-reader --password-stdin" "$TEST_ROOT/calls" || fail 'no rootless login'
grep -Fq 'sudo -n -u ubuntu' "$TEST_ROOT/calls" || fail 'rootless login not run as the rootless user'
grep -Fq "docker[DOCKER_HOST=unix://$SOCKET] logout ghcr.io" "$TEST_ROOT/calls" || fail 'rootless logout missing'
grep -Fxq 'docker[DOCKER_HOST=] logout ghcr.io' "$TEST_ROOT/calls" || fail 'host logout missing'
grep -Fq "$TOKEN" "$TEST_ROOT/calls" && fail 'token leaked into argv or the call log'
[[ "$(grep -o -F "$TOKEN" "$TEST_ROOT/stdin" | wc -l | tr -d ' ')" == 2 ]] || fail 'token was not passed on stdin to both logins'
pass 'configured: host + rootless login on stdin, token absent from argv and logs, logout runs'

# 3) Environment variables take precedence and work without .env.
out="$(run_case '' QAAP_GHCR_USERNAME=jc-reader QAAP_GHCR_READ_TOKEN="$TOKEN")"
[[ "$out" == *'AUTH=1'* ]] || fail 'environment-only settings not used'
pass 'environment-only settings are used'

# 4) Partial settings: refused with a warning, nothing run.
out="$(run_case 'QAAP_GHCR_USERNAME=jc-reader
' 2>&1)"
[[ "$out" == *'must be set together'* ]] || fail 'partial settings not reported'
[[ ! -s "$TEST_ROOT/calls" ]] || fail 'partial settings still ran docker'
pass 'partial settings: refused, nothing run'

# 5) Host login fails: pulls stay anonymous, rootless still tried, no abort.
out="$(run_case "QAAP_GHCR_USERNAME=jc-reader
QAAP_GHCR_READ_TOKEN=$TOKEN
" FAKE_LOGIN_FAIL=host 2>&1)"
[[ "$out" == *'host Docker login to ghcr.io failed'* ]] || fail 'host login failure not reported'
[[ "$out" == *'AUTH=0'* ]] || fail 'failed host login still marked authenticated'
pass 'host login failure: reported, anonymous, no abort'

echo 'all ghcr read-auth checks passed'
