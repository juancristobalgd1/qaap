#!/usr/bin/env bash
# Trigger a VPS update over SSH from your laptop or a Cursor Cloud Agent.
#
# Required env:
#   QAAP_VPS_HOST          e.g. 178.105.136.93
#   QAAP_VPS_SSH_KEY       private key PEM (or set QAAP_VPS_SSH_KEY_FILE)
#
# Optional:
#   QAAP_VPS_USER          default: root
#   QAAP_VPS_SSH_PORT      default: 22
#   QAAP_VPS_REPO_DIR      default: /opt/qaap
#   QAAP_VPS_BRANCH        default: master
#
# Usage:
#   export QAAP_VPS_HOST=178.105.136.93
#   export QAAP_VPS_SSH_KEY="$(cat ~/.ssh/qaap-vps-deploy)"
#   ./scripts/qaap-vps-remote-update.sh
#   ./scripts/qaap-vps-remote-update.sh --no-cache
set -euo pipefail

HOST="${QAAP_VPS_HOST:-}"
USER="${QAAP_VPS_USER:-root}"
PORT="${QAAP_VPS_SSH_PORT:-22}"
REPO_DIR="${QAAP_VPS_REPO_DIR:-/opt/qaap}"
BRANCH="${QAAP_VPS_BRANCH:-master}"
NO_CACHE=0
KEY_FILE="${QAAP_VPS_SSH_KEY_FILE:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        --no-cache)
            NO_CACHE=1
            shift
            ;;
        -h|--help)
            sed -n '2,20p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$HOST" ]]; then
    echo "QAAP_VPS_HOST is required" >&2
    exit 1
fi

TMP_KEY=""
cleanup() {
    if [[ -n "$TMP_KEY" && -f "$TMP_KEY" ]]; then
        rm -f "$TMP_KEY"
    fi
}
trap cleanup EXIT

if [[ -n "$KEY_FILE" ]]; then
    SSH_IDENTITY=(-i "$KEY_FILE")
elif [[ -n "${QAAP_VPS_SSH_KEY:-}" ]]; then
    TMP_KEY="$(mktemp)"
    chmod 600 "$TMP_KEY"
    printf '%s\n' "$QAAP_VPS_SSH_KEY" > "$TMP_KEY"
    SSH_IDENTITY=(-i "$TMP_KEY")
else
    echo "Set QAAP_VPS_SSH_KEY or QAAP_VPS_SSH_KEY_FILE" >&2
    exit 1
fi

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -p "$PORT" "${SSH_IDENTITY[@]}")

NO_CACHE_FLAG=""
if [[ "$NO_CACHE" -eq 1 ]]; then
    NO_CACHE_FLAG="--no-cache"
fi

echo "[qaap-vps-remote] $USER@$HOST:$REPO_DIR branch=$BRANCH"

ssh "${SSH_OPTS[@]}" "$USER@$HOST" bash -s -- "$REPO_DIR" "$BRANCH" "$NO_CACHE_FLAG" <<'REMOTE'
set -euo pipefail
REPO_DIR="$1"
BRANCH="$2"
NO_CACHE_FLAG="${3:-}"
cd "$REPO_DIR"
export QAAP_VPS_BRANCH="$BRANCH"
./scripts/qaap-vps-update.sh --branch "$BRANCH" $NO_CACHE_FLAG
REMOTE

echo "[qaap-vps-remote] done"
