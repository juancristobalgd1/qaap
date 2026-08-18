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

# The archive contains OAuth sessions, helper tokens and AI API keys — make every file this script
# creates owner-only (0600 files, 0700 dirs) so a non-root user on the VPS cannot read the secrets.
umask 077

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
chmod 700 "$BACKUP_DIR"

ARCHIVE="$BACKUP_DIR/qaap-$STAMP.tar.gz"

# --volumes-from mounts the same named volumes the app uses; tar sees live, atomic-written JSON
# (every store writes via tmp+rename), so archives are consistent enough for restore.
#
# busybox tar exits non-zero on the benign "file changed as we read it" race, so we tolerate its
# exit code here — but we do NOT trust it: the archive is integrity-checked below with `tar -tzf`,
# which fails on a TRUNCATED archive. That catches a real tar failure that left a partial file (the
# old `|| [ -s ... ]` marked any non-empty file — including a truncated one — as success).
docker run --rm \
    --volumes-from "$THEIA_CONTAINER" \
    -v "$BACKUP_DIR:/backup" \
    busybox sh -c "umask 077; tar czf '/backup/qaap-$STAMP.tar.gz' \
        --exclude 'node_modules' \
        /workspace /root/.qaap /root/.theia 2>/dev/null || true"

if [[ ! -s "$ARCHIVE" ]]; then
    echo "[qaap-backup] FAILED: archive is empty or missing" >&2
    rm -f "$ARCHIVE"
    exit 1
fi

# Integrity gate: a truncated/corrupt archive fails to list. Never keep a backup we cannot read back.
LISTING="$(tar -tzf "$ARCHIVE" 2>/dev/null)" || {
    echo "[qaap-backup] FAILED: archive is corrupt or truncated (tar -tzf could not read it)" >&2
    rm -f "$ARCHIVE"
    exit 1
}

# Completeness gate: `tar ... || true` above swallows a HARD tar failure (e.g. a source path missing
# or unreadable), which can still leave a well-formed but INCOMPLETE archive that `tar -tzf` accepts.
# Require an entry from each of the three state surfaces (tar stores absolute paths without the leading
# slash, so match `workspace/`, `root/.qaap/`, `root/.theia/`).
for expect in 'workspace/' 'root/.qaap/' 'root/.theia/'; do
    if ! grep -q "^${expect}" <<< "$LISTING"; then
        echo "[qaap-backup] FAILED: archive is incomplete — no '${expect}' entries (a source path failed to read)" >&2
        rm -f "$ARCHIVE"
        exit 1
    fi
done

chmod 600 "$ARCHIVE"

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "[qaap-backup] wrote $ARCHIVE ($SIZE, 0600)"

# ⚠️ This archive holds OAuth sessions, helper tokens and AI API keys in the CLEAR. It is safe at
# rest on this host (0600, dir 0700), but you MUST encrypt it before any offsite copy — e.g.
#   gpg --symmetric --cipher-algo AES256 "$ARCHIVE"   # or `age -p`
# and sync only the encrypted `.gpg`/`.age` file. Never rsync/upload the plaintext `.tar.gz`.

# Rotate: keep the newest $KEEP archives.
ls -1t "$BACKUP_DIR"/qaap-*.tar.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f
echo "[qaap-backup] retained $(ls -1 "$BACKUP_DIR"/qaap-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') archive(s) (keep=$KEEP)"

OFFSITE="${REPO_DIR}/scripts/qaap-vps-backup-offsite.sh"
if [[ -f "$OFFSITE" ]]; then
    export QAAP_BACKUP_ARCHIVE="$ARCHIVE"
    bash "$OFFSITE"
fi
