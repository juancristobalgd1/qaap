#!/usr/bin/env bash
# Check the newly deployed public entry point and, when configured, a real signed-in user's API.
set -euo pipefail

BASE_URL="${1:-${QAAP_VPS_PUBLIC_URL:-}}"
EXPECTED_SHA="${2:-${QAAP_EXPECTED_BUILD:-}}"
if [[ -z "$BASE_URL" || ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Usage: $0 <public-base-url> <full-40-character-build-sha>" >&2
    exit 2
fi

for command in curl python3 grep; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Required command not found: $command" >&2
        exit 1
    fi
done

BASE_URL="${BASE_URL%/}"
TEMP_DIR="$(mktemp -d -t qaap-post-deploy-smoke.XXXXXXXX)"
cleanup() {
    case "$TEMP_DIR" in
        */qaap-post-deploy-smoke.*) rm -rf -- "$TEMP_DIR" ;;
        *) echo "Refusing to remove unexpected temporary path: $TEMP_DIR" >&2; exit 2 ;;
    esac
}
trap cleanup EXIT

if ! HOME_STATUS="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 15 "$BASE_URL/")"; then
    echo '::error::Post-deploy user smoke could not request the home page.' >&2
    exit 1
fi
if [[ "$HOME_STATUS" != 200 ]]; then
    echo "::error::Post-deploy user smoke expected home HTTP 200, got ${HOME_STATUS:-<empty>}." >&2
    exit 1
fi
echo 'OK: home returned HTTP 200.'

if ! CONFIG_STATUS="$(curl --silent --show-error --output "$TEMP_DIR/auth-config.json" \
    --write-out '%{http_code}' --max-time 15 "$BASE_URL/qaap/api/auth/config")"; then
    echo '::error::Post-deploy user smoke could not request /qaap/api/auth/config.' >&2
    exit 1
fi
if [[ "$CONFIG_STATUS" != 200 ]]; then
    echo "::error::Post-deploy user smoke expected auth/config HTTP 200, got ${CONFIG_STATUS:-<empty>}." >&2
    exit 1
fi
if ! DEPLOYED_SHA="$(python3 - "$TEMP_DIR/auth-config.json" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding='utf-8') as config_file:
        payload = json.load(config_file)
except (OSError, ValueError):
    sys.exit(1)

build = payload.get('build') if isinstance(payload, dict) else None
if isinstance(build, str):
    print(build)
else:
    sys.exit(1)
PY
)" || [[ ! "$DEPLOYED_SHA" =~ ^[0-9a-f]{12}$ ]]; then
    echo '::error::Post-deploy user smoke expected auth/config to report a 12-character build SHA.' >&2
    exit 1
fi
if [[ "$DEPLOYED_SHA" != "${EXPECTED_SHA:0:12}" ]]; then
    echo "::error::Post-deploy user smoke expected build ${EXPECTED_SHA:0:12}, got $DEPLOYED_SHA." >&2
    exit 1
fi
echo "OK: auth/config reports deployed build $DEPLOYED_SHA."

SMOKE_COOKIE="${QAAP_SMOKE_COOKIE:-}"
if [[ -n "${QAAP_SMOKE_SESSION:-}" ]]; then
    case "$QAAP_SMOKE_SESSION" in
        *=*) SMOKE_COOKIE="$QAAP_SMOKE_SESSION" ;;
        *) SMOKE_COOKIE="qaap_sid=$QAAP_SMOKE_SESSION" ;;
    esac
fi
if [[ -z "$SMOKE_COOKIE" ]]; then
    echo '::error::QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is required for the signed-in post-deploy smoke.' >&2
    exit 1
fi

if ! APPROVALS_STATUS="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 15 --cookie "$SMOKE_COOKIE" "$BASE_URL/qaap/api/agent-approvals")"; then
    echo '::error::Signed-in post-deploy smoke could not request /qaap/api/agent-approvals.' >&2
    exit 1
fi
if [[ "$APPROVALS_STATUS" != 200 ]]; then
    echo "::error::Signed-in post-deploy smoke expected agent-approvals HTTP 200, got ${APPROVALS_STATUS:-<empty>}." >&2
    exit 1
fi
echo 'OK: signed-in agent-approvals returned HTTP 200.'

# The approvals route verifies the configured session. Probe the user entry point afterward so a
# ready public shell cannot mask a failed tenant backend route (for example the known 502 JSON).
if ! AUTH_HOME_STATUS="$(curl --silent --show-error --output "$TEMP_DIR/auth-home.body" \
    --write-out '%{http_code}' --max-time 180 --cookie "$SMOKE_COOKIE" "$BASE_URL/")"; then
    echo '::error::Signed-in post-deploy smoke could not request the home page.' >&2
    exit 1
fi
if [[ "$AUTH_HOME_STATUS" =~ ^5 ]]; then
    echo "::error::Signed-in post-deploy smoke expected home HTTP 200 after backend startup, got ${AUTH_HOME_STATUS:-<empty>}." >&2
    exit 1
fi
if [[ "$AUTH_HOME_STATUS" != 200 ]]; then
    echo "::error::Signed-in post-deploy smoke expected home HTTP 200, got ${AUTH_HOME_STATUS:-<empty>}." >&2
    exit 1
fi
if grep -Fq 'Tenant backend unavailable' "$TEMP_DIR/auth-home.body"; then
    echo '::error::Signed-in post-deploy home returned the Tenant backend unavailable response.' >&2
    exit 1
fi
echo 'OK: signed-in home returned HTTP 200 with the tenant backend available.'
