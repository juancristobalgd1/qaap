#!/usr/bin/env bash
# Fails if a base image of the production Dockerfile is not pinned by version tag AND digest
# (`name:tag@sha256:<64 hex>`). A moving tag (node:22-bookworm) lets a rebuild of the same commit
# differ from the image CI published and verified.
# Usage: scripts/qaap-dockerfile-base-pin-check.sh [Dockerfile...]   (default: ./Dockerfile)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ $# -gt 0 ]] || set -- "$ROOT/Dockerfile"

failures=0
for dockerfile in "$@"; do
    if [[ ! -f "$dockerfile" ]]; then
        echo "FAIL: $dockerfile: not found" >&2
        failures=$((failures + 1))
        continue
    fi
    stages=' '
    froms=0
    while IFS=$'\t' read -r line_no image alias; do
        froms=$((froms + 1))
        image_lower="${image,,}"
        if [[ "$image_lower" == scratch || "$stages" == *" $image_lower "* ]]; then
            : # earlier build stage or the empty image: nothing to pin
        elif [[ "$image" == *'$'* ]]; then
            echo "FAIL: $dockerfile:$line_no: base image '$image' comes from a build arg; pin it literally" >&2
            failures=$((failures + 1))
        elif [[ ! "$image" =~ ^[a-z0-9][a-z0-9._/:-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*@sha256:[0-9a-f]{64}$ ]]; then
            echo "FAIL: $dockerfile:$line_no: base image '$image' is not pinned as name:version@sha256:<digest>" >&2
            failures=$((failures + 1))
        fi
        [[ -z "$alias" ]] || stages+="${alias,,} "
    done < <(sed 's/\r$//' "$dockerfile" | awk '
        toupper($1) == "FROM" {
            i = 2
            while (i <= NF && $i ~ /^--/) { i++ }
            alias = (toupper($(i + 1)) == "AS") ? $(i + 2) : ""
            printf "%d\t%s\t%s\n", NR, $i, alias
        }')
    if (( froms == 0 )); then
        echo "FAIL: $dockerfile: no FROM instruction found" >&2
        failures=$((failures + 1))
    fi
done

if (( failures > 0 )); then
    echo "Dockerfile base image pin check failed ($failures). Resolve the index digest of the reviewed tag, e.g." >&2
    echo "  docker buildx imagetools inspect node:<version>-bookworm --format '{{json .Manifest.Digest}}'" >&2
    exit 1
fi
echo "Dockerfile base images are pinned by version and digest: $*"
