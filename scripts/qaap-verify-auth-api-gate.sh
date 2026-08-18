#!/usr/bin/env bash
# qaap-verify-auth-api-gate.sh — unauthenticated callers must not reach tenant APIs.
#
#   QAAP_BASE_URL=https://your.host ./scripts/qaap-verify-auth-api-gate.sh
#
# Exit 0 = login/config is public and protected routes return 401 without a session cookie.
# This is the HTTP half of "login → task → preview → Remove": it proves Remove/settings/repos
# cannot be invoked by a stranger. The signed-in UI walkthrough still needs a human GitHub login.
set -euo pipefail

BASE="${QAAP_BASE_URL:-http://127.0.0.1:4873}"
BASE="${BASE%/}"

pass=0
fail=0
ok()  { echo "  OK   $*"; pass=$((pass + 1)); }
bad() { echo "  FAIL $*" >&2; fail=$((fail + 1)); }

echo "Qaap auth API gate — ${BASE}"

code_of() {
    local method="$1"
    local path="$2"
    curl -sS -o /dev/null -w '%{http_code}' --max-time 12 -X "$method" "${BASE}${path}" || echo "000"
}

CFG_CODE="$(code_of GET /qaap/api/auth/config)"
if [[ "$CFG_CODE" == "200" ]]; then
    ok "GET /qaap/api/auth/config → 200 (public)"
else
    bad "GET /qaap/api/auth/config → ${CFG_CODE} (expected 200)"
fi

HEALTH_CODE="$(code_of GET /qaap/api/health)"
if [[ "$HEALTH_CODE" == "200" ]]; then
    ok "GET /qaap/api/health → 200"
elif [[ "$HEALTH_CODE" == "404" ]]; then
    echo "  WARN GET /qaap/api/health → 404 (pre-health image; deploy this branch)"
else
    bad "GET /qaap/api/health → ${HEALTH_CODE} (expected 200 or 404 on old images)"
fi

expect_401() {
    local method="$1"
    local path="$2"
    local code
    code="$(code_of "$method" "$path")"
    if [[ "$code" == "401" ]]; then
        ok "${method} ${path} → 401"
    else
        bad "${method} ${path} → ${code} (expected 401 without a session)"
    fi
}

expect_401 GET  /qaap/api/user-settings
expect_401 PUT  /qaap/api/user-settings
expect_401 GET  /qaap/api/github/repositories
expect_401 DELETE /qaap/api/github/repositories/octocat/hello
expect_401 GET  /qaap/api/github/project-sessions

echo
echo "${pass} passed, ${fail} failed"
if [[ "${fail}" -gt 0 ]]; then
    echo "Do not open this instance to users until protected routes require a session." >&2
    exit 1
fi
echo "Auth API gate passed."
exit 0
