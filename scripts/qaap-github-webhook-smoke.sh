#!/usr/bin/env bash
# Smoke-test POST /qaap/api/github/webhook (signed @qaap issue_comment).
# Requires a running Qaap backend and QAAP_OAUTH_PUBLIC_URL in .env (or env).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

read_env() {
    local key="$1"
    if [[ -f .env ]]; then
        grep -E "^${key}=" .env | tail -1 | cut -d= -f2- | tr -d \"'"'"' ' | tr -d '\r' || true
    fi
}

THEIA_PORT="${THEIA_PORT:-$(read_env THEIA_PORT)}"
THEIA_PORT="${THEIA_PORT:-4873}"
PUBLIC_URL="${QAAP_OAUTH_PUBLIC_URL:-$(read_env QAAP_OAUTH_PUBLIC_URL)}"
PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:${THEIA_PORT}}"
SECRET="${QAAP_GITHUB_WEBHOOK_SECRET:-$(read_env QAAP_GITHUB_WEBHOOK_SECRET)}"

OWNER="${QAAP_WEBHOOK_SMOKE_OWNER:-qaap-smoke}"
REPO="${QAAP_WEBHOOK_SMOKE_REPO:-sandbox}"
ISSUE="${QAAP_WEBHOOK_SMOKE_ISSUE:-1}"
COMMENT_ID="${QAAP_WEBHOOK_SMOKE_COMMENT_ID:-$(date +%s)}"

WEBHOOK_URL="${PUBLIC_URL%/}/qaap/api/github/webhook"

fail() {
    echo "qaap-github-webhook-smoke: $*" >&2
    exit 1
}

PAYLOAD="$(node -e "
console.log(JSON.stringify({
  action: 'created',
  comment: {
    id: Number(process.env.COMMENT_ID),
    body: '@qaap smoke test — ignore',
    html_url: 'https://github.com/${OWNER}/${REPO}/issues/${ISSUE}#issuecomment-smoke',
    user: { login: 'qaap-smoke-bot' },
  },
  issue: { number: Number(process.env.ISSUE) },
  repository: { owner: { login: process.env.OWNER }, name: process.env.REPO },
}));
" COMMENT_ID="$COMMENT_ID" ISSUE="$ISSUE" OWNER="$OWNER" REPO="$REPO")"

CURL_HEADERS=(-H "Content-Type: application/json" -H "X-GitHub-Event: issue_comment")

if [[ -n "$SECRET" ]]; then
    SIG="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"
    CURL_HEADERS+=(-H "X-Hub-Signature-256: $SIG")
    echo "qaap-github-webhook-smoke: POST $WEBHOOK_URL (signed)"
else
    echo "qaap-github-webhook-smoke: warning — QAAP_GITHUB_WEBHOOK_SECRET unset; sending unsigned payload" >&2
    echo "qaap-github-webhook-smoke: POST $WEBHOOK_URL"
fi

HTTP_CODE="$(curl -sS -o /tmp/qaap-webhook-smoke.json -w '%{http_code}' \
    -X POST "$WEBHOOK_URL" \
    "${CURL_HEADERS[@]}" \
    -d "$PAYLOAD")"

echo "qaap-github-webhook-smoke: HTTP $HTTP_CODE"
cat /tmp/qaap-webhook-smoke.json
echo

if [[ "$HTTP_CODE" == "401" ]]; then
    fail "401 — check QAAP_GITHUB_WEBHOOK_SECRET matches the GitHub hook secret"
fi

if [[ "$HTTP_CODE" != "202" && "$HTTP_CODE" != "422" && "$HTTP_CODE" != "503" ]]; then
    fail "unexpected status $HTTP_CODE (expected 202, 422 without OAuth, or 503 without cloud-workspace)"
fi

if [[ "$HTTP_CODE" == "202" ]]; then
    echo "qaap-github-webhook-smoke: webhook accepted — check GitHub ack comment and Work Hub conversation"
elif [[ "$HTTP_CODE" == "422" ]]; then
    echo "qaap-github-webhook-smoke: trigger rejected (likely repo not linked) — endpoint OK"
elif [[ "$HTTP_CODE" == "503" ]]; then
    fail "503 — @theia/qaap-cloud-workspace not loaded on this server"
fi

echo "qaap-github-webhook-smoke: passed"
