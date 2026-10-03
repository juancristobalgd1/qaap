#!/usr/bin/env bash
# Run a deploy or rollback command detached from the SSH session and relay only its result markers.
#
# Usage: qaap-vps-detached-run.sh <run-name> <command> [args...]
#
# The command runs under setsid/nohup, so a cancelled job, SSH timeout, or dropped connection does
# not interrupt a deploy or rollback halfway. Its full output goes to a persistent log that is
# streamed to stderr while this session lives. Stdout carries only the QAAP_DEPLOY_* markers and
# QAAP_DEPLOY_EXIT_CODE, keeping the Actions step output small. Always exits 0; read the markers.
set -euo pipefail

if (( $# < 2 )); then
    echo 'usage: qaap-vps-detached-run.sh <run-name> <command> [args...]' >&2
    exit 2
fi
RUN_NAME="$1"
shift
POLL_SECONDS="${QAAP_DETACHED_POLL_SECONDS:-5}"
LOG_DIR="${QAAP_DEPLOY_LOG_DIR:-${XDG_STATE_HOME:-${HOME:-/root}/.local/state}/qaap-deploy/logs}"
mkdir -p "$LOG_DIR"
RUN_ID="$RUN_NAME-$(date -u +%Y%m%dT%H%M%SZ)-$$"
LOG_FILE="$LOG_DIR/$RUN_ID.log"
STATUS_FILE="$LOG_DIR/$RUN_ID.status"
: > "$LOG_FILE"
echo "[qaap-vps] detached run log: $LOG_FILE" >&2

setsid nohup bash -c '
    log_file="$1" status_file="$2"
    shift 2
    status=0
    "$@" >> "$log_file" 2>&1 || status=$?
    printf "%s\n" "$status" > "$status_file.tmp"
    mv "$status_file.tmp" "$status_file"
' qaap-detached-run "$LOG_FILE" "$STATUS_FILE" "$@" </dev/null >/dev/null 2>&1 &
RUN_PID=$!

LOG_OFFSET=0
relay_new_log_output() {
    local size
    size="$(stat -c '%s' "$LOG_FILE" 2>/dev/null || echo 0)"
    if (( size > LOG_OFFSET )); then
        tail -c "+$((LOG_OFFSET + 1))" "$LOG_FILE" | head -c "$((size - LOG_OFFSET))" >&2 || true
        LOG_OFFSET="$size"
    fi
}

while [[ ! -f "$STATUS_FILE" ]]; do
    relay_new_log_output
    if ! kill -0 "$RUN_PID" 2>/dev/null && [[ ! -f "$STATUS_FILE" ]]; then
        # setsid may have forked; the status file is the authority. Give it one last chance.
        sleep 1
        [[ -f "$STATUS_FILE" ]] || pgrep -f "qaap-detached-run $LOG_FILE" >/dev/null 2>&1 || break
    fi
    sleep "$POLL_SECONDS"
done
relay_new_log_output

if [[ ! -f "$STATUS_FILE" ]]; then
    printf '%s\n' \
        'QAAP_DEPLOY_RESULT=manual' \
        'QAAP_DEPLOY_REASON=detached run stopped before writing its status' \
        'QAAP_DEPLOY_SUMMARY_START' \
        '## VPS deploy result unavailable' \
        '' \
        "The detached run stopped before writing its result. Inspect $LOG_FILE on the VPS." \
        'QAAP_DEPLOY_SUMMARY_END' \
        'QAAP_DEPLOY_EXIT_CODE=3'
    exit 0
fi

grep '^QAAP_DEPLOY_RESULT=' "$LOG_FILE" | tail -n 1 || true
grep '^QAAP_DEPLOY_REASON=' "$LOG_FILE" | tail -n 1 || true
sed -n '/^QAAP_DEPLOY_SUMMARY_START$/,/^QAAP_DEPLOY_SUMMARY_END$/p' "$LOG_FILE"
printf 'QAAP_DEPLOY_EXIT_CODE=%s\n' "$(cat "$STATUS_FILE")"
