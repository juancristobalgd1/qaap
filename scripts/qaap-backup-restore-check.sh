#!/usr/bin/env bash
# Rehearse one backup in a NEW anonymous volume; never mount the live state volumes.
set -euo pipefail
ARCHIVE="${1:?usage: qaap-backup-restore-check.sh archive.tar.gz qaap-image@sha256:digest}"
IMAGE="${2:?an immutable Qaap image is required}"
EXTRA=()
if [[ "${3:-}" == '--legacy-three-roots' && "$#" == 3 ]]; then
    EXTRA=(--legacy-three-roots)
elif [[ "$#" != 2 ]]; then
    echo 'Optional third argument: --legacy-three-roots (does not cover runtime worktrees)' >&2
    exit 2
fi
[[ "$IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo 'Image digest required' >&2; exit 2; }
[[ -f "$ARCHIVE" && -f "$ARCHIVE.sha256" ]] || { echo 'Archive and SHA-256 sidecar required' >&2; exit 1; }
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
[[ "$ARCHIVE" != *,* ]] || { echo 'Docker bind source cannot contain a comma' >&2; exit 2; }
read -r DIGEST _ < "$ARCHIVE.sha256"
[[ "$DIGEST" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid SHA-256 sidecar' >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Only the archive is mounted from the host, read-only. /restore is disposable.
# No OAuth credentials, provider keys, repository processes or network are used.
docker run --rm --network none --read-only --user 0 \
    --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
    --security-opt no-new-privileges --memory 1g --cpus 2 \
    --mount "type=bind,source=$ARCHIVE,target=/input/backup.tar.gz,readonly" \
    --volume /restore --entrypoint python3 -i "$IMAGE" \
    - /input/backup.tar.gz /restore/rehearsal "$DIGEST" "${EXTRA[@]}" \
    < "$SCRIPT_DIR/qaap-backup-restore-check.py"
