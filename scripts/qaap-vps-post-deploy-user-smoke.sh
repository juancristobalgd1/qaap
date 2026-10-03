#!/usr/bin/env bash
# Check the deployed health payload and a real signed-in workspace request.
set -euo pipefail

BASE_URL="${1:-${QAAP_VPS_PUBLIC_URL:-}}"
EXPECTED_SHA="${2:-${QAAP_EXPECTED_BUILD:-}}"
if [[ -z "$BASE_URL" || ! "$EXPECTED_SHA" =~ ^([0-9a-f]{40}|[0-9a-f]{12})$ ]]; then
    echo "Usage: $0 <public-base-url> <12- or 40-character-build-sha>" >&2
    exit 2
fi

SMOKE_COOKIE="${QAAP_SMOKE_COOKIE:-}"
if [[ -n "${QAAP_SMOKE_SESSION:-}" ]]; then
    case "$QAAP_SMOKE_SESSION" in
        *=*) SMOKE_COOKIE="$QAAP_SMOKE_SESSION" ;;
        *) SMOKE_COOKIE="qaap_sid=$QAAP_SMOKE_SESSION" ;;
    esac
fi
if [[ -z "$SMOKE_COOKIE" ]]; then
    echo '::error::QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE is required; refusing deploy without an authenticated workspace smoke.' >&2
    exit 1
fi
if [[ "$SMOKE_COOKIE" != *=* ]]; then
    echo '::error::QAAP_SMOKE_SESSION or QAAP_SMOKE_COOKIE must contain a cookie name and value separated by =.' >&2
    exit 1
fi

for command in curl python3; do
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
COOKIE_HEADER_FILE="$TEMP_DIR/cookie-header"
printf 'Cookie: %s\n' "$SMOKE_COOKIE" > "$COOKIE_HEADER_FILE"
chmod 600 "$COOKIE_HEADER_FILE"

if ! HEALTH_STATUS="$(curl --silent --show-error --output "$TEMP_DIR/health.json" \
    --write-out '%{http_code}' --max-time 15 "$BASE_URL/qaap/api/health")"; then
    echo '::error::Post-deploy user smoke could not request /qaap/api/health.' >&2
    exit 1
fi
if [[ "$HEALTH_STATUS" != 200 ]]; then
    echo "::error::Post-deploy user smoke expected health HTTP 200, got ${HEALTH_STATUS:-<empty>}." >&2
    exit 1
fi
if ! HEALTH_BUILD="$(python3 - "$TEMP_DIR/health.json" <<'PY'
import json
import re
import sys

try:
    with open(sys.argv[1], encoding='utf-8') as health_file:
        payload = json.load(health_file)
except (OSError, ValueError):
    sys.exit(1)

if not isinstance(payload, dict) or payload.get('ok') is not True or payload.get('ready') is not True:
    sys.exit(1)
build = payload.get('build')
if not isinstance(build, str) or not re.fullmatch(r'[0-9a-f]{12}', build):
    sys.exit(1)
print(build)
PY
)"; then
    echo '::error::Post-deploy user smoke expected health to report ok=true, ready=true, and a 12-character build SHA.' >&2
    exit 1
fi
if [[ "$HEALTH_BUILD" != "${EXPECTED_SHA:0:12}" ]]; then
    echo "::error::Post-deploy user smoke expected health build ${EXPECTED_SHA:0:12}, got $HEALTH_BUILD." >&2
    exit 1
fi
echo "OK: health reports deployed build $HEALTH_BUILD."

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

if ! WORKSPACE_STATUS="$(curl --silent --show-error --output "$TEMP_DIR/workspace-root.html" \
    --write-out '%{http_code}' --max-time 15 -H "@$COOKIE_HEADER_FILE" "$BASE_URL/")"; then
    echo '::error::Signed-in post-deploy smoke could not request the workspace root.' >&2
    exit 1
fi
if grep -Fqi 'Tenant backend unavailable' "$TEMP_DIR/workspace-root.html"; then
    echo '::error::Signed-in workspace root contains "Tenant backend unavailable".' >&2
    exit 1
fi
if [[ "$WORKSPACE_STATUS" == 302 || "$WORKSPACE_STATUS" == 401 || "$WORKSPACE_STATUS" == 403 ]]; then
    echo "::error::Signed-in workspace smoke received HTTP $WORKSPACE_STATUS; the smoke cookie or session is expired or unauthorized." >&2
    exit 3
fi
if [[ "$WORKSPACE_STATUS" != 200 ]]; then
    echo "::error::Signed-in workspace smoke expected HTTP 200, got ${WORKSPACE_STATUS:-<empty>}." >&2
    exit 1
fi
echo 'OK: signed-in workspace root returned HTTP 200.'

if ! APPROVALS_STATUS="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 15 -H "@$COOKIE_HEADER_FILE" "$BASE_URL/qaap/api/agent-approvals")"; then
    echo '::error::Signed-in post-deploy smoke could not request /qaap/api/agent-approvals.' >&2
    exit 1
fi
if [[ "$APPROVALS_STATUS" == 302 || "$APPROVALS_STATUS" == 401 || "$APPROVALS_STATUS" == 403 ]]; then
    echo "::error::Signed-in agent-approvals smoke received HTTP $APPROVALS_STATUS; the smoke cookie or session is expired or unauthorized." >&2
    exit 3
fi
if [[ "$APPROVALS_STATUS" != 200 ]]; then
    echo "::error::Signed-in post-deploy smoke expected agent-approvals HTTP 200, got ${APPROVALS_STATUS:-<empty>}." >&2
    exit 1
fi
echo 'OK: signed-in agent-approvals returned HTTP 200.'
