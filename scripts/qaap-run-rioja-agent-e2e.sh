#!/usr/bin/env bash
# Run Rioja composer UI + API E2E evals against a local browser server with mock QAIQ.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOCK_BIN="${ROOT}/test-results/mock-qaiq-bin"
MOCK_AGENT="${ROOT}/examples/playwright/scripts/mock-qaiq-rioja-agent"
BASE_URL="${QAAP_BASE_URL:-http://127.0.0.1:3000}"
PORT="${QAAP_PORT:-3000}"

mkdir -p "${MOCK_BIN}"
ln -sf "${MOCK_AGENT}" "${MOCK_BIN}/qaiq"
export PATH="${MOCK_BIN}:${PATH}"

wait_for_server() {
    for _ in $(seq 1 90); do
        if curl -sf "${BASE_URL}" >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    echo "Server not ready at ${BASE_URL}" >&2
    return 1
}

started_server=0
if ! curl -sf "${BASE_URL}" >/dev/null 2>&1; then
    echo "Starting browser backend with mock QAIQ on PATH…"
    (
        cd "${ROOT}/examples/browser"
        npm run start
    ) &
    server_pid=$!
    started_server=1
    trap 'if [[ "${started_server}" -eq 1 ]]; then kill "${server_pid}" 2>/dev/null || true; fi' EXIT
    wait_for_server
fi

cd "${ROOT}/examples/playwright"
echo "=== Rioja composer UI flow (P0 gate) ==="
node scripts/qaap-rioja-ui-flow-eval.mjs
echo "=== Rioja API flow (regression) ==="
node scripts/qaap-rioja-e2e-eval.mjs
