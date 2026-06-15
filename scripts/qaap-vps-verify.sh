#!/usr/bin/env bash
# Post-deploy checklist for Qaap on a VPS (Docker Compose).
# Confirms qaiq/codex CLIs inside the container and GET /qaap/api/health.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

THEIA_PORT="${THEIA_PORT:-}"
if [[ -z "$THEIA_PORT" ]] && [[ -f .env ]]; then
    # shellcheck disable=SC2002
    THEIA_PORT="$(grep -E '^THEIA_PORT=' .env | tail -1 | cut -d= -f2- | sed 's/[[:space:]"'\''\r]//g')"
fi
THEIA_PORT="${THEIA_PORT:-4873}"

COMPOSE=(docker compose)
SERVICE="${QAAP_VPS_SERVICE:-theia}"
HEALTH_URL="http://127.0.0.1:${THEIA_PORT}/qaap/api/health"
HEALTH_FALLBACK_URL="http://127.0.0.1:${THEIA_PORT}/qaap/api/agent-tasks/health"

fail() {
    echo "qaap-vps-verify: $*" >&2
    exit 1
}

if ! command -v docker >/dev/null 2>&1; then
    fail "docker not found — install Docker Engine first"
fi

if ! "${COMPOSE[@]}" ps --status running "$SERVICE" 2>/dev/null | grep -q "$SERVICE"; then
    fail "service '$SERVICE' is not running — run: docker compose up -d"
fi

echo "qaap-vps-verify: qaiq --version (inside $SERVICE)..."
if ! "${COMPOSE[@]}" exec -T "$SERVICE" qaiq --version; then
    fail "qaiq --version failed — rebuild the image or check PATH in the container"
fi

echo "qaap-vps-verify: GET $HEALTH_URL"
HEALTH_JSON="$(curl -sf "$HEALTH_URL" 2>/dev/null || curl -sf "$HEALTH_FALLBACK_URL")" || fail "health endpoint unreachable at $HEALTH_URL (rebuild backend: npm run build:browser && restart theia)"

echo "$HEALTH_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    print('qaap-vps-verify: invalid JSON from health endpoint', file=sys.stderr)
    sys.exit(1)
if not data.get('ok'):
    print('qaap-vps-verify: health ok=false — agents:', data.get('agents'), file=sys.stderr)
    sys.exit(1)
agents = data.get('agents')
if not isinstance(agents, list) or len(agents) < 1:
    print('qaap-vps-verify: health agents[] is empty', file=sys.stderr)
    sys.exit(1)
default_agent = data.get('defaultAgent', '?')
print('qaap-vps-verify: health ok — agents:', ', '.join(agents), '(default:', default_agent + ')')
"

if ! "${COMPOSE[@]}" logs "$SERVICE" 2>&1 | grep -q '\[qaap-agent-tasks\] detected agents:'; then
    echo "qaap-vps-verify: warning: startup log '[qaap-agent-tasks] detected agents' not found (container may have restarted recently)" >&2
fi

echo "qaap-vps-verify: all checks passed"
