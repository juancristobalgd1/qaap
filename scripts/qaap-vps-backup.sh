#!/usr/bin/env bash
# Nightly backup of the Qaap VPS state. Run on the VPS host from the repo root (or via cron).
#
# What it protects (the six persistent state surfaces of a deployment):
#   /workspace     user repositories + /workspace/.qaap (uid-registry, project-sessions)
#   /root/.qaap    OAuth sessions, agent-task index/logs, conversations, helper tokens
#   /root/.theia   per-user settings (incl. Settings → AI API keys)
#   /tmp/qaap-worktrees, /tmp/qaap-parallel  in-progress worktrees
#   /home/qaap-tenants  private tenant agent homes
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

# The archive contains OAuth sessions, helper tokens and AI API keys — make every file this script
# creates owner-only (0600 files, 0700 dirs) so a non-root user on the VPS cannot read the secrets.
umask 077

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

BACKUP_DIR="${QAAP_BACKUP_DIR:-/var/backups/qaap}"
KEEP="${QAAP_BACKUP_KEEP:-7}"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo '[qaap-backup] KEEP must be a positive integer' >&2; exit 2; }
STAMP="$(date -u +%Y%m%d-%H%M%S)"

THEIA_CONTAINER="$(docker compose ps -q theia)"
if [[ -z "$THEIA_CONTAINER" ]]; then
    echo "[qaap-backup] theia container not running — nothing to back up" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
# Serialize cron/manual runs so publication and retention never race.
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo '[qaap-backup] another backup is running' >&2; exit 1; }

ARCHIVE="$BACKUP_DIR/qaap-$STAMP.tar.gz"
PARTIAL="$ARCHIVE.partial"
trap 'rm -f -- "$PARTIAL" "$PARTIAL.sha256"' EXIT
[[ ! -e "$ARCHIVE" ]] || { echo '[qaap-backup] archive already exists for this timestamp' >&2; exit 1; }

# Sources are read-only. A changing/unreadable source fails the backup instead of
# publishing a silently incomplete archive. This live copy is not a transactional
# snapshot across stores; rehearse recovery and schedule a quiet window if needed.
docker run --rm \
    --network none \
    --volumes-from "$THEIA_CONTAINER:ro" \
    -v "$BACKUP_DIR:/backup" \
    busybox:1.37.0 sh -c "umask 077; tar czf '/backup/qaap-$STAMP.tar.gz.partial' \
        --exclude 'node_modules' \
        /workspace /root/.qaap /root/.theia /tmp/qaap-worktrees /tmp/qaap-parallel /home/qaap-tenants"

if [[ ! -s "$PARTIAL" ]]; then
    echo "[qaap-backup] FAILED: archive is empty or missing" >&2
    exit 1
fi

# Integrity gate: a truncated/corrupt archive fails to list. Never keep a backup we cannot read back.
LISTING="$(tar -tzf "$PARTIAL" 2>/dev/null)" || {
    echo "[qaap-backup] FAILED: archive is corrupt or truncated (tar -tzf could not read it)" >&2
    exit 1
}

# Require all six state roots in addition to a successful tar exit.
for expect in 'workspace/' 'root/.qaap/' 'root/.theia/' 'tmp/qaap-worktrees/' 'tmp/qaap-parallel/' 'home/qaap-tenants/'; do
    if ! grep -Fxq "$expect" <<< "$LISTING"; then
        echo "[qaap-backup] FAILED: archive is incomplete — no '${expect}' entries (a source path failed to read)" >&2
        exit 1
    fi
done

chmod 600 "$PARTIAL"
DIGEST="$(sha256sum "$PARTIAL" | cut -d ' ' -f1)"
printf '%s  %s\n' "$DIGEST" "$(basename "$ARCHIVE")" > "$PARTIAL.sha256"
mv -- "$PARTIAL.sha256" "$ARCHIVE.sha256"
mv -- "$PARTIAL" "$ARCHIVE"

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "[qaap-backup] wrote $ARCHIVE ($SIZE, 0600)"

# ⚠️ This archive holds OAuth sessions, helper tokens and AI API keys in the CLEAR. It is safe at
# rest on this host (0600, dir 0700), but you MUST encrypt it before any offsite copy — e.g.
#   gpg --symmetric --cipher-algo AES256 "$ARCHIVE"   # or `age -p`
# and sync only the encrypted `.gpg`/`.age` file. Never rsync/upload the plaintext `.tar.gz`.

# Rotate: keep the newest $KEEP archives.
mapfile -d '' -t ARCHIVES < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'qaap-*.tar.gz' -printf '%f\0' | sort -zr)
for (( index=KEEP; index<${#ARCHIVES[@]}; index++ )); do
    rm -f -- "$BACKUP_DIR/${ARCHIVES[index]}" "$BACKUP_DIR/${ARCHIVES[index]}.sha256"
done
echo "[qaap-backup] retained $(ls -1 "$BACKUP_DIR"/qaap-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') archive(s) (keep=$KEEP)"

OFFSITE="${REPO_DIR}/scripts/qaap-vps-backup-offsite.sh"
if [[ -f "$OFFSITE" ]]; then
    export QAAP_BACKUP_ARCHIVE="$ARCHIVE"
    bash "$OFFSITE"
fi
