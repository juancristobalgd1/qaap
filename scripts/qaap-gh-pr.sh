#!/usr/bin/env bash
# Safe gh pr wrapper — blocks PRs to eclipse-theia/* and defaults to the Qaap fork.
set -euo pipefail

QAAP_GH_REPO="${QAAP_GH_REPO:-juancristobalgd1/qaap}"

if ! command -v gh >/dev/null 2>&1; then
    echo "qaap-gh-pr: gh CLI not found." >&2
    exit 1
fi

if [[ $# -lt 1 ]]; then
    echo "Usage: scripts/qaap-gh-pr.sh <gh pr subcommand> [flags...]" >&2
    echo "Example: scripts/qaap-gh-pr.sh create --title \"...\" --body \"...\"" >&2
    exit 1
fi

repo_flag=""
repo_value=""
filtered=()
i=1
while [[ $i -le $# ]]; do
    arg="${!i}"
    if [[ "$arg" == --repo && $((i + 1)) -le $# ]]; then
        repo_flag="--repo"
        i=$((i + 1))
        repo_value="${!i}"
    elif [[ "$arg" == --repo=* ]]; then
        repo_flag="--repo"
        repo_value="${arg#--repo=}"
    else
        filtered+=("$arg")
    fi
    i=$((i + 1))
done

if [[ -n "$repo_value" ]]; then
    if [[ "$repo_value" == eclipse-theia/* ]]; then
        echo "qaap-gh-pr: refusing PR target $repo_value (Qaap product PRs belong on $QAAP_GH_REPO)." >&2
        exit 1
    fi
    exec gh pr "${filtered[@]}" --repo "$repo_value"
fi

# No --repo passed: enforce fork default (never rely on gh global/upstream default).
exec gh pr "${filtered[@]}" --repo "$QAAP_GH_REPO"
