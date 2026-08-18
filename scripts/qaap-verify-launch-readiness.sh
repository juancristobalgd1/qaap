#!/usr/bin/env bash
# qaap-verify-launch-readiness.sh — fail-closed checks before opening a Qaap VPS to users.
#
#   QAAP_BASE_URL=https://your.host ./scripts/qaap-verify-launch-readiness.sh
#
# Exit 0 = the public auth/config probe looks like a production login path.
# Exit 1 = do not launch (skip-auth on, OAuth missing, placeholder client id, etc.).
set -euo pipefail

BASE="${QAAP_BASE_URL:-http://127.0.0.1:4873}"
BASE="${BASE%/}"
ENV_FILE="${QAAP_ENV_FILE:-.env}"

pass=0
fail=0
ok()  { echo "  OK   $*"; pass=$((pass + 1)); }
bad() { echo "  FAIL $*" >&2; fail=$((fail + 1)); }

echo "Qaap launch readiness — ${BASE}"

TMP="$(mktemp)"
HEALTH_TMP="$(mktemp)"
trap 'rm -f "$TMP" "$HEALTH_TMP"' EXIT
if curl -fsS --max-time 8 "${BASE}/qaap/api/health" >"$HEALTH_TMP" 2>/dev/null; then
    ok "GET /qaap/api/health"
else
    echo "  WARN GET /qaap/api/health failed (pre-health image is OK once; auth/config is required)"
fi
if ! curl -fsS --max-time 8 "${BASE}/qaap/api/auth/config" >"$TMP"; then
    echo "  FAIL cannot GET ${BASE}/qaap/api/auth/config" >&2
    exit 1
fi

read -r CFG_SKIP CFG_OAUTH CFG_PROD CFG_UID_PER_USER CFG_BUILD < <(node -e '
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const esc = (v) => String(v ?? "").replace(/[^A-Za-z0-9._+-]/g, "");
process.stdout.write([
    cfg.skipAuth ? "1" : "0",
    (cfg.githubOAuth || cfg.oauthConfigured) ? "1" : "0",
    cfg.productionRuntime ? "1" : "0",
    cfg.agentUidPerUser ? "1" : "0",
    esc(cfg.build) || "-",
].join(" ") + "\n");
' "$TMP")

if [[ "${CFG_SKIP}" == "1" ]]; then
    bad "skipAuth is true — production must keep GitHub login on"
else
    ok "skipAuth is false"
fi

if [[ "${CFG_OAUTH}" != "1" ]]; then
    bad "GitHub OAuth is not configured (githubOAuth/oauthConfigured)"
else
    ok "GitHub OAuth is configured"
fi

if [[ "${CFG_BUILD}" != "-" && -n "${CFG_BUILD}" ]]; then
    ok "build SHA ${CFG_BUILD}"
else
    echo "  WARN build SHA missing (QAAP_BUILD_SHA) — deploys cannot prove image identity"
fi

if [[ "${CFG_PROD}" == "1" && "${CFG_UID_PER_USER}" != "1" ]]; then
    bad "productionRuntime without uid-per-user — do not invite a second tenant"
else
    ok "uid-per-user flag is ${CFG_UID_PER_USER}"
fi

for page in terms privacy; do
    if curl -fsS --max-time 8 "${BASE}/legal/${page}.html" | grep -q '<h1>'; then
        ok "GET /legal/${page}.html"
    else
        bad "GET /legal/${page}.html is missing or empty — login terms/privacy must resolve"
    fi
done

if [[ -f "${ENV_FILE}" ]]; then
    if grep -E 'QAAP_GITHUB_CLIENT_ID=your-dev-oauth' "${ENV_FILE}" >/dev/null 2>&1; then
        bad "${ENV_FILE} still has the placeholder OAuth client id"
    else
        ok "${ENV_FILE} does not use the documented placeholder client id"
    fi
    if grep -E '^QAAP_SKIP_AUTH=(true|1)' "${ENV_FILE}" >/dev/null 2>&1; then
        bad "${ENV_FILE} sets QAAP_SKIP_AUTH — refused in production unless explicitly overridden"
    fi
    if ! grep -E '^QAAP_OAUTH_PUBLIC_URL=.+' "${ENV_FILE}" >/dev/null 2>&1; then
        bad "${ENV_FILE} is missing QAAP_OAUTH_PUBLIC_URL"
    fi
else
    echo "  WARN no ${ENV_FILE} next to cwd — skipped placeholder scan (set QAAP_ENV_FILE)"
fi

echo
echo "${pass} passed, ${fail} failed"
if [[ "${fail}" -gt 0 ]]; then
    echo "Do not open this instance to users until the FAILs are fixed. See SECURITY.md." >&2
    exit 1
fi
echo "Launch probe passed. Still run scripts/qaap-verify-multitenant.sh before a second tenant."
exit 0
