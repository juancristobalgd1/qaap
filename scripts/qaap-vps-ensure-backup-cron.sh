#!/usr/bin/env bash
# Install (or refresh) the nightly VPS backup cron. Idempotent. Run as root on the host.
#
#   ./scripts/qaap-vps-ensure-backup-cron.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    echo "[qaap-backup] not root — skip cron install (VPS deploy runs as root)"
    exit 0
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${REPO_DIR}/scripts/qaap-vps-backup.sh"
CRON_FILE="${QAAP_BACKUP_CRON_FILE:-/etc/cron.d/qaap-backup}"

if [[ ! -x "$SCRIPT" && ! -f "$SCRIPT" ]]; then
    echo "backup script missing: $SCRIPT" >&2
    exit 1
fi
chmod +x "$SCRIPT"

umask 022
cat > "$CRON_FILE" <<EOF
# Managed by scripts/qaap-vps-ensure-backup-cron.sh — do not edit by hand.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root $SCRIPT >> /var/log/qaap-backup.log 2>&1
EOF
chmod 644 "$CRON_FILE"
echo "[qaap-backup] cron installed: $CRON_FILE → $SCRIPT"

BACKUP_DIR="${QAAP_BACKUP_DIR:-/var/backups/qaap}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
if ! compgen -G "${BACKUP_DIR}/qaap-*.tar.gz" >/dev/null; then
    echo "[qaap-backup] no archives yet — running an initial backup"
    "$SCRIPT"
fi
