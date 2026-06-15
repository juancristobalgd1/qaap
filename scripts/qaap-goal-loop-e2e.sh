#!/usr/bin/env bash
# End-to-end goal loop engineering test on a running Qaap backend.
#
# Runs a real agent task: create a marker file → verify (lint + file check) → evaluate → completed.
#
# Usage (on VPS from repo root):
#   ./scripts/qaap-goal-loop-e2e.sh
#   QAAP_GOAL_LOOP_E2E_TIMEOUT_SEC=900 ./scripts/qaap-goal-loop-e2e.sh
set -euo pipefail

BASE="${QAAP_BASE_URL:-http://127.0.0.1:4873}"
API="${BASE}/qaap/api/agent-conversations"
CWD="${QAAP_GOAL_LOOP_CWD:-/workspace/repos/juancristobalgd1/web-app-starter-template}"
MARKER="${QAAP_GOAL_LOOP_MARKER:-GOAL_LOOP_E2E.txt}"
MARKER_LINE="${QAAP_GOAL_LOOP_MARKER_LINE:-GOAL_LOOP_ENGINEERING_OK}"
TIMEOUT_SEC="${QAAP_GOAL_LOOP_E2E_TIMEOUT_SEC:-600}"
POLL_SEC="${QAAP_GOAL_LOOP_POLL_SEC:-8}"
LOG="${QAAP_GOAL_LOOP_E2E_LOG:-/tmp/qaap-goal-loop-e2e.log}"

fail() {
    echo "qaap-goal-loop-e2e: FAIL — $*" | tee -a "$LOG" >&2
    exit 1
}

log() {
    echo "qaap-goal-loop-e2e: $*" | tee -a "$LOG"
}

json_field() {
    local expr="$1"
    python3 -c "import json,sys; d=json.load(sys.stdin); print($expr)"
}

: >"$LOG"
log "=== goal loop E2E start $(date -Is) ==="
log "base=$BASE cwd=$CWD marker=$MARKER timeout=${TIMEOUT_SEC}s"

curl -sf "${BASE}/qaap/api/health" >/dev/null || fail "health unreachable"

# Clean stale marker from a previous run.
if command -v docker >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
    docker compose exec -T theia rm -f "${CWD}/${MARKER}" 2>/dev/null || true
fi

GOAL="Create a new file ${MARKER} in the repository root containing exactly one line: ${MARKER_LINE}. Do not modify any other files. Do not run npm install, build, or test commands yourself — verification runs automatically after your turn."

CREATE_BODY="$(python3 -c "import json; print(json.dumps({'cwd':'$CWD','title':'goal-loop-e2e','autoApprove':True,'agent':'qaiq'}))")"
CREATE_JSON="$(curl -sf -X POST "$API" -H 'Content-Type: application/json' -d "$CREATE_BODY")" || fail "create conversation"
CONV_ID="$(printf '%s' "$CREATE_JSON" | json_field "d['id']")"
log "conversationId=$CONV_ID"

START_BODY="$(python3 <<PY
import json
print(json.dumps({
    "goal": """$GOAL""",
    "initialPrompt": """$GOAL""",
    "budget": {"maxIterations": 4, "maxDurationMs": 540000},
    "verify": {
        "enabled": True,
        "extraCommands": [
            "test -f ${MARKER} && grep -qx '${MARKER_LINE}' ${MARKER}"
        ],
    },
}))
PY
)"

START_JSON="$(curl -sf -X POST "${API}/${CONV_ID}/goal-loop/start" \
    -H 'Content-Type: application/json' \
    -d "$START_BODY")" || fail "goal-loop/start"
PHASE="$(printf '%s' "$START_JSON" | json_field "d['goalLoop']['phase']")"
[[ "$PHASE" == "executing" ]] || fail "expected executing, got $PHASE"
log "started phase=$PHASE"

declare -A seen_phases=()
deadline=$(( $(date +%s) + TIMEOUT_SEC ))
terminal=" completed blocked cancelled "
saw_verifying=false
saw_evaluating=false

while [[ $(date +%s) -lt $deadline ]]; do
    sleep "$POLL_SEC"
    LOOP_JSON="$(curl -sf "${API}/${CONV_ID}/goal-loop")"
    CONV_JSON="$(curl -sf "${API}/${CONV_ID}")"
    phase="$(printf '%s' "$LOOP_JSON" | json_field "d.get('goalLoop') and d['goalLoop'].get('phase') or ''")"
    status="$(printf '%s' "$CONV_JSON" | json_field "d.get('status','')")"
    iteration="$(printf '%s' "$LOOP_JSON" | json_field "d.get('goalLoop') and d['goalLoop'].get('iteration',0) or 0")"
    stop="$(printf '%s' "$LOOP_JSON" | json_field "d.get('goalLoop') and d['goalLoop'].get('stopReason') or ''")"
    msg_count="$(printf '%s' "$CONV_JSON" | json_field "len(d.get('messages',[]))")"

    key="${phase}|${status}|${iteration}"
    if [[ -z "${seen_phases[$key]+x}" ]]; then
        log "phase=$phase status=$status iteration=$iteration messages=$msg_count${stop:+ stop=${stop:0:80}}"
        seen_phases[$key]=1
    fi

    [[ "$phase" == "verifying" ]] && saw_verifying=true
    [[ "$phase" == "evaluating" ]] && saw_evaluating=true

    if [[ " $terminal " == *" $phase "* ]]; then
        log "terminal phase=$phase"
        printf '%s' "$LOOP_JSON" | python3 -m json.tool >>"$LOG" 2>/dev/null || true

        if [[ "$phase" != "completed" ]]; then
            fail "ended with phase=$phase reason=${stop:-unknown}"
        fi

        [[ "$saw_verifying" == true ]] || fail "never entered verifying phase"
        [[ "$saw_evaluating" == true ]] || fail "never entered evaluating phase"

        # Confirm marker file on disk inside container.
        if command -v docker >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
            if ! docker compose exec -T theia test -f "${CWD}/${MARKER}"; then
                fail "marker file missing after completed: ${CWD}/${MARKER}"
            fi
            CONTENT="$(docker compose exec -T theia cat "${CWD}/${MARKER}" | tr -d '\r')"
            [[ "$CONTENT" == "$MARKER_LINE" ]] || fail "marker content mismatch: got '$CONTENT'"
            log "marker file OK on disk: ${CWD}/${MARKER}"
        fi

        log "=== PASS — full loop engineering cycle completed ==="
        exit 0
    fi
done

curl -sf -X POST "${API}/${CONV_ID}/goal-loop/cancel" \
    -H 'Content-Type: application/json' \
    -d '{"reason":"e2e timeout"}' >/dev/null || true
fail "timeout (last phase=$phase status=$status)"
