#!/usr/bin/env bash
# Optional offsite copy of the newest Qaap VPS backup archive.
#
# Called by scripts/qaap-vps-backup.sh after a successful local tar. Does nothing unless the
# operator configured a command. Never uploads the plaintext archive unless the command does —
# encrypt first (gpg/age), then copy only the ciphertext.
#
# Config (first file that exists is sourced):
#   /opt/qaap/.env.backup
#   $QAAP_BACKUP_OFFSITE_ENV
#
# Then set:
#   QAAP_BACKUP_OFFSITE_CMD   command run with QAAP_BACKUP_ARCHIVE in the environment
#
# Example /opt/qaap/.env.backup:
#   QAAP_BACKUP_OFFSITE_CMD='gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file /root/.qaap-backup-passphrase --output "${QAAP_BACKUP_ARCHIVE}.gpg" "$QAAP_BACKUP_ARCHIVE" && rclone copy "${QAAP_BACKUP_ARCHIVE}.gpg" remote:qaap-backups && rm -f "${QAAP_BACKUP_ARCHIVE}.gpg"'
set -euo pipefail

ENV_FILE="${QAAP_BACKUP_OFFSITE_ENV:-/opt/qaap/.env.backup}"
if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
fi

if [[ -z "${QAAP_BACKUP_OFFSITE_CMD:-}" ]]; then
    echo "[qaap-backup] offsite skipped (set QAAP_BACKUP_OFFSITE_CMD or ${ENV_FILE})"
    exit 0
fi

if [[ -z "${QAAP_BACKUP_ARCHIVE:-}" || ! -s "${QAAP_BACKUP_ARCHIVE}" ]]; then
    echo "[qaap-backup] offsite FAILED: QAAP_BACKUP_ARCHIVE missing or empty" >&2
    exit 1
fi

echo "[qaap-backup] running offsite command for ${QAAP_BACKUP_ARCHIVE}"
bash -c "$QAAP_BACKUP_OFFSITE_CMD"
echo "[qaap-backup] offsite command finished"
