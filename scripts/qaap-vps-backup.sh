#!/usr/bin/env bash
# Nightly backup of the Qaap VPS state. Run on the VPS host from the repo root (or via cron).
#
# What it protects (the three state surfaces of a deployment):
#   /workspace     user repositories + /workspace/.qaap (uid-registry, project-sessions)
#   /root/.qaap    OAuth sessions, agent-task index/logs, conversations, helper tokens
#   /root/.theia   per-user settings (incl. Settings → AI API keys)
#
# node_modules are excluded (reinstallable, and they dominate the size otherwise).
#
# Install (as root on the VPS):
#   echo '17 3 * * * root /opt/qaap/scripts/qaap-vps-backup.sh >> /var/log/qaap-backup.log 2>&1' \
#     > /etc/cron.d/qaap-backup
#
# Restore: see the "Backups" section in doc/qaap-vps-deployment.md.
#
# NOTE: local tars protect against app-level corruption/deletion, NOT disk loss. Pair with the
# provider's snapshot/backup feature (e.g. Hetzner backups) or sync $QAAP_BACKUP_DIR offsite.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

BACKUP_DIR="${QAAP_BACKUP_DIR:-/var/backups/qaap}"
KEEP="${QAAP_BACKUP_KEEP:-7}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

THEIA_CONTAINER="$(docker compose ps -q theia)"
if [[ -z "$THEIA_CONTAINER" ]]; then
    echo "[qaap-backup] theia container not running — nothing to back up" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

# --volumes-from mounts the same named volumes the app uses; tar sees live, atomic-written JSON
# (every store writes via tmp+rename), so archives are consistent enough for restore.
docker run --rm \
    --volumes-from "$THEIA_CONTAINER" \
    -v "$BACKUP_DIR:/backup" \
    busybox sh -c "tar czf '/backup/qaap-$STAMP.tar.gz' \
        --exclude 'node_modules' \
        /workspace /root/.qaap /root/.theia 2>/dev/null || [ -s '/backup/qaap-$STAMP.tar.gz' ]"

if [[ ! -s "$BACKUP_DIR/qaap-$STAMP.tar.gz" ]]; then
    echo "[qaap-backup] FAILED: archive is empty or missing" >&2
    exit 1
fi

SIZE="$(du -h "$BACKUP_DIR/qaap-$STAMP.tar.gz" | cut -f1)"
echo "[qaap-backup] wrote $BACKUP_DIR/qaap-$STAMP.tar.gz ($SIZE)"

# Rotate: keep the newest $KEEP archives.
ls -1t "$BACKUP_DIR"/qaap-*.tar.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f
echo "[qaap-backup] retained $(ls -1 "$BACKUP_DIR"/qaap-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') archive(s) (keep=$KEEP)"
