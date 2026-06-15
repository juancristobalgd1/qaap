#!/usr/bin/env bash
# Smoke-test goal loop engineering on a running Qaap backend (VPS or local).
#
# Usage:
#   ./scripts/qaap-goal-loop-smoke.sh
#   QAAP_BASE_URL=http://127.0.0.1:4873 QAAP_GOAL_LOOP_SMOKE_TIMEOUT_SEC=300 ./scripts/qaap-goal-loop-smoke.sh
#
# Requires: curl, python3, a repo cwd inside the container (default /workspace).
set -euo pipefail

BASE="${QAAP_BASE_URL:-http://127.0.0.1:4873}"
API="${BASE}/qaap/api/agent-conversations"
CWD="${QAAP_GOAL_LOOP_CWD:-/workspace}"
TIMEOUT_SEC="${QAAP_GOAL_LOOP_SMOKE_TIMEOUT_SEC:-240}"
POLL_SEC="${QAAP_GOAL_LOOP_POLL_SEC:-5}"

fail() {
    echo "qaap-goal-loop-smoke: $*" >&2
    exit 1
}

json_field() {
    local expr="$1"
    python3 -c "import json,sys; d=json.load(sys.stdin); print($expr)"
}

echo "qaap-goal-loop-smoke: health probe..."
curl -sf "${BASE}/qaap/api/health" >/dev/null || fail "health unreachable at ${BASE}/qaap/api/health"

echo "qaap-goal-loop-smoke: create conversation (cwd=$CWD, autoApprove=true)..."
CREATE_BODY="$(python3 -c "import json; print(json.dumps({'cwd':'$CWD','title':'goal-loop-smoke','autoApprove':True,'agent':'qaiq'}))")"
CREATE_JSON="$(curl -sf -X POST "$API" \
    -H 'Content-Type: application/json' \
    -d "$CREATE_BODY")" || fail "create conversation failed"
CONV_ID="$(printf '%s' "$CREATE_JSON" | json_field "d['id']")"
[[ -n "$CONV_ID" ]] || fail "missing conversation id"
echo "  conversationId=$CONV_ID"

GOAL='Reply with exactly the text GOAL_LOOP_OK and do not run shell commands or edit files.'
START_BODY="$(python3 <<PY
import json
print(json.dumps({
    "goal": "$GOAL",
    "initialPrompt": "$GOAL",
    "budget": {"maxIterations": 3, "maxDurationMs": 120000},
    "verify": {"enabled": False},
}))
PY
)"

echo "qaap-goal-loop-smoke: start goal loop..."
START_JSON="$(curl -sf -X POST "${API}/${CONV_ID}/goal-loop/start" \
    -H 'Content-Type: application/json' \
    -d "$START_BODY")" || fail "goal-loop/start failed"
PHASE="$(printf '%s' "$START_JSON" | json_field "d['goalLoop']['phase']")"
[[ "$PHASE" == "executing" ]] || fail "expected phase executing, got $PHASE"
echo "  started phase=$PHASE"

deadline=$(( $(date +%s) + TIMEOUT_SEC ))
last_phase=""
last_status=""
terminal_phases=" completed blocked cancelled "

while [[ $(date +%s) -lt $deadline ]]; do
    sleep "$POLL_SEC"
    LOOP_JSON="$(curl -sf "${API}/${CONV_ID}/goal-loop")"
    CONV_JSON="$(curl -sf "${API}/${CONV_ID}")"
    phase="$(printf '%s' "$LOOP_JSON" | json_field "d.get('goalLoop') and d['goalLoop'].get('phase') or ''")"
    status="$(printf '%s' "$CONV_JSON" | json_field "d.get('status','')")"
    iteration="$(printf '%s' "$LOOP_JSON" | json_field "d.get('goalLoop') and d['goalLoop'].get('iteration',0) or 0")"
    stop="$(printf '%s' "$LOOP_JSON" | json_field "d.get('goalLoop') and d['goalLoop'].get('stopReason') or ''")"

    if [[ "$phase" != "$last_phase" || "$status" != "$last_status" ]]; then
        echo "  phase=$phase status=$status iteration=$iteration${stop:+ stop=$stop}"
        last_phase="$phase"
        last_status="$status"
    fi

    if [[ " $terminal_phases " == *" $phase "* ]]; then
        echo "qaap-goal-loop-smoke: terminal phase=$phase"
        if [[ "$phase" == "completed" ]]; then
            echo "qaap-goal-loop-smoke: PASS — goal loop completed"
            exit 0
        fi
        if [[ "$phase" == "blocked" ]]; then
            fail "goal loop blocked: ${stop:-unknown}"
        fi
        fail "goal loop ended with phase=$phase reason=${stop:-unknown}"
    fi
done

echo "qaap-goal-loop-smoke: timeout after ${TIMEOUT_SEC}s — cancelling..."
curl -sf -X POST "${API}/${CONV_ID}/goal-loop/cancel" \
    -H 'Content-Type: application/json' \
    -d '{"reason":"smoke test timeout"}' >/dev/null || true
fail "timed out waiting for terminal phase (last phase=$last_phase status=$last_status)"
