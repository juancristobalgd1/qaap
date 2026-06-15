#!/usr/bin/env bash
# Fix gh CLI default repo for this clone — run after git clone.
set -euo pipefail

QAAP_GH_REPO="${QAAP_GH_REPO:-juancristobalgd1/qaap}"
FORBIDDEN="eclipse-theia/theia"

if ! command -v gh >/dev/null 2>&1; then
    echo "qaap-ensure-gh-default: gh not installed — skip." >&2
    exit 0
fi

current="$(gh repo set-default --view 2>/dev/null || true)"
if [[ "$current" == "$FORBIDDEN" ]] || [[ "$current" == eclipse-theia/* ]]; then
    echo "qaap-ensure-gh-default: unsetting forbidden default $current" >&2
    gh repo set-default --unset >/dev/null 2>&1 || true
    current=""
fi

if [[ "$current" != "$QAAP_GH_REPO" ]]; then
    gh repo set-default "$QAAP_GH_REPO"
    echo "qaap-ensure-gh-default: set default repo to $QAAP_GH_REPO"
else
    echo "qaap-ensure-gh-default: already $QAAP_GH_REPO"
fi
