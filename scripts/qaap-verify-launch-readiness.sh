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
    bad "GET /qaap/api/health failed — a release must expose health"
fi
if ! curl -fsS --max-time 8 "${BASE}/qaap/api/auth/config" >"$TMP"; then
    echo "  FAIL cannot GET ${BASE}/qaap/api/auth/config" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if node "$SCRIPT_DIR/qaap-release-config-check.js" "$TMP" "$HEALTH_TMP"; then
    ok "production configuration and health payloads"
else
    bad "production readiness or release identity is invalid"
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
    # Paid-beta Stripe: fail when any Stripe/public URL var is present but incomplete;
    # warn when none are set (single-user free box is allowed).
    stripe_keys=0
    for key in STRIPE_SECRET_KEY STRIPE_PRICE_PRO_MONTHLY STRIPE_PRICE_TEAM_MONTHLY STRIPE_WEBHOOK_SECRET QAAP_PUBLIC_URL; do
        if grep -E "^${key}=.+" "${ENV_FILE}" >/dev/null 2>&1; then
            stripe_keys=$((stripe_keys + 1))
        fi
    done
    if [[ "${stripe_keys}" -eq 0 ]]; then
        echo "  WARN ${ENV_FILE} has no Stripe / QAAP_PUBLIC_URL — Billing checkout stays disabled"
    elif [[ "${stripe_keys}" -lt 5 ]]; then
        bad "${ENV_FILE} has partial Stripe config (${stripe_keys}/5) — set STRIPE_SECRET_KEY, STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_TEAM_MONTHLY, STRIPE_WEBHOOK_SECRET, QAAP_PUBLIC_URL"
    else
        ok "${ENV_FILE} has Stripe checkout + webhook vars"
        if grep -E '^QAAP_BILLING_DEV_CHECKOUT=(true|1)' "${ENV_FILE}" >/dev/null 2>&1; then
            bad "${ENV_FILE} sets QAAP_BILLING_DEV_CHECKOUT — must be unset on a public VPS"
        else
            ok "${ENV_FILE} does not enable QAAP_BILLING_DEV_CHECKOUT"
        fi
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
