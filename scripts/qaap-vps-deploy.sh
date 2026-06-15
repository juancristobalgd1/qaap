#!/usr/bin/env bash
# Deploy Qaap to the Hetzner VPS over SSH (same flow as prior agent deploys).
#
# Usage (from Mac, repo root):
#   ./scripts/qaap-vps-deploy.sh
#   QAAP_VPS_BRANCH=master ./scripts/qaap-vps-deploy.sh
#
# Defaults: root@178.105.136.93, /opt/qaap, feat/agent-task-limits-and-queue
set -euo pipefail

SSH_TARGET="${QAAP_VPS_SSH:-root@178.105.136.93}"
BRANCH="${QAAP_VPS_BRANCH:-feat/agent-task-limits-and-queue}"
REMOTE_DIR="${QAAP_VPS_DIR:-/opt/qaap}"
LOG="/tmp/docker-deploy.log"
PUBLIC_URL="${QAAP_OAUTH_PUBLIC_URL:-http://178.105.136.93:4873}"

echo "==> Deploy $BRANCH → $SSH_TARGET:$REMOTE_DIR"

ssh -o BatchMode=yes "$SSH_TARGET" "bash -s" <<EOF
set -euo pipefail
cd "$REMOTE_DIR"

echo "==> git fetch + checkout $BRANCH"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "=== DEPLOYED COMMIT ==="
git log --oneline -1

echo "==> docker compose up --build -d (background, log: $LOG)"
nohup docker compose up --build -d > "$LOG" 2>&1 &
echo "Build PID: \$!"
EOF

echo "==> waiting for docker compose (tail $LOG)..."
for i in $(seq 1 120); do
  if ssh -o BatchMode=yes "$SSH_TARGET" "grep -qE 'Started|Created|Recreate|healthy|done' $LOG 2>/dev/null && ! pgrep -af 'docker compose up' >/dev/null 2>&1"; then
    break
  fi
  sleep 15
  if [[ $((i % 4)) -eq 0 ]]; then
    ssh -o BatchMode=yes "$SSH_TARGET" "tail -3 $LOG 2>/dev/null" || true
  fi
  if [[ $i -eq 120 ]]; then
    echo "Build still running — check: ssh $SSH_TARGET 'tail -f $LOG'" >&2
    exit 1
  fi
done

ssh -o BatchMode=yes "$SSH_TARGET" "bash -s" <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
docker compose ps
if [[ -x scripts/qaap-vps-verify.sh ]]; then
  ./scripts/qaap-vps-verify.sh || true
else
  curl -sf "http://127.0.0.1:\${THEIA_PORT:-4873}/qaap/api/health" | head -c 200 || true
  echo
fi
EOF

echo ""
echo "Deploy done: $PUBLIC_URL"
