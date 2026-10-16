#!/usr/bin/env bash
# Roll the VPS back to the previous release in one command (no CI build, no image rebuild).
# Run on the VPS from the repo root, e.g. /opt/qaap:
#   ./scripts/qaap-vps-rollback.sh              # the release before the one serving now
#   ./scripts/qaap-vps-rollback.sh --list       # releases this host can roll back to
#   ./scripts/qaap-vps-rollback.sh --to <image id prefix | commit prefix>
#   ./scripts/qaap-vps-rollback.sh --dry-run    # print the plan, change nothing
# From a laptop: npm run qaap:vps:remote-update -- --rollback
#
# Each healthy deploy records its image id in the deploy history (qaap-vps-image-prune.sh), and the
# post-deploy cleanup keeps the serving image plus the one before it. A rollback redeploys such a
# retained GHCR image through qaap-vps-update.sh at the commit baked into it, so it goes through the
# same drain, tenant seed, health and launch-gate checks as a normal deploy.
#
# The whole script is one function called on the last line: `git checkout` below may rewrite this
# file, and bash reads a script while it runs.
set -euo pipefail

qaap_vps_rollback_main() {
    local repo_dir target='' dry_run=0 list=0
    repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    cd "$repo_dir"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --to)
                [[ $# -ge 2 ]] || { echo "--to requires a value" >&2; return 1; }
                target="$2"
                shift 2
                ;;
            --dry-run) dry_run=1; shift ;;
            --list) list=1; shift ;;
            -h|--help)
                sed -n '2,15p' "$0"
                return 0
                ;;
            *)
                echo "Unknown option: $1" >&2
                return 1
                ;;
        esac
    done

    # QAAP_IMAGE_HISTORY_FILE (one image id per healthy deploy, oldest first).
    # shellcheck source=scripts/qaap-vps-image-prune.sh
    source "$repo_dir/scripts/qaap-vps-image-prune.sh"

    local serving_container serving_id=''
    serving_container="$(docker compose ps -aq theia 2>/dev/null | tr -d '\r' | sed -n '1p' || true)"
    if [[ -n "$serving_container" ]]; then
        serving_id="$(docker inspect -f '{{.Image}}' "$serving_container" 2>/dev/null || true)"
    fi

    # Candidates: recorded releases still present in the host daemon, newest first.
    local -a candidates=()
    local id
    if [[ -r "$QAAP_IMAGE_HISTORY_FILE" ]]; then
        while IFS= read -r id; do
            [[ -n "$id" ]] || continue
            docker image inspect "$id" >/dev/null 2>&1 && candidates+=("$id")
        done < <(tac "$QAAP_IMAGE_HISTORY_FILE" 2>/dev/null || tail -r "$QAAP_IMAGE_HISTORY_FILE")
    fi

    if (( list == 1 )); then
        for id in ${candidates[@]+"${candidates[@]}"}; do
            printf '%s  %s%s\n' "${id:7:12}" "$(qaap_rollback_image_revision "$id")" \
                "$([[ "$id" == "$serving_id" ]] && echo '  (serving)')"
        done
        return 0
    fi

    local chosen=''
    for id in ${candidates[@]+"${candidates[@]}"}; do
        [[ "$id" == "$serving_id" ]] && continue
        if [[ -z "$target" ]] || [[ "${id#sha256:}" == "$target"* ]] \
            || [[ "$(qaap_rollback_image_revision "$id")" == "$target"* ]]; then
            chosen="$id"
            break
        fi
    done
    if [[ -z "$chosen" ]]; then
        echo "[qaap-vps-rollback] no retained release ${target:+matching '$target' }to roll back to" >&2
        echo "[qaap-vps-rollback] history: $QAAP_IMAGE_HISTORY_FILE; see --list" >&2
        return 1
    fi

    local revision image_ref
    revision="$(qaap_rollback_image_revision "$chosen")"
    if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
        echo "[qaap-vps-rollback] image $chosen has no commit label; it was not a CI-built release" >&2
        return 1
    fi
    image_ref="$(qaap_rollback_image_ref "$chosen" "$revision")"
    if [[ -z "$image_ref" ]]; then
        echo "[qaap-vps-rollback] image $chosen has no registry digest; cannot pin it" >&2
        return 1
    fi

    echo "[qaap-vps-rollback] serving: ${serving_id:-none} ($(qaap_rollback_image_revision "$serving_id"))"
    echo "[qaap-vps-rollback] rolling back to: $chosen"
    echo "[qaap-vps-rollback]   commit: $revision"
    echo "[qaap-vps-rollback]   image:  $image_ref"
    if (( dry_run == 1 )); then
        echo '[qaap-vps-rollback] dry run: nothing changed'
        return 0
    fi

    git fetch origin
    if [[ -n "$(git status --porcelain)" ]]; then
        # Same rule as the deploy workflow: never force a checkout over an operator's edits.
        local stash_name
        stash_name="qaap-rollback-preserve-${revision:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
        git stash push --include-untracked --message "$stash_name"
        echo "[qaap-vps-rollback] preserved dirty worktree in stash: $stash_name"
    fi
    git checkout --detach "$revision"
    # The update script of the rolled-back commit: the one that commit was deployed and tested with.
    exec ./scripts/qaap-vps-update.sh --branch "${QAAP_VPS_BRANCH:-master}" --revision "$revision" --image "$image_ref"
}

# Commit baked into a CI-built image (empty for local builds).
qaap_rollback_image_revision() {
    [[ -n "${1:-}" ]] || return 0
    docker image inspect "$1" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true
}

# `repo:<revision>@sha256:…`, the form deploys pass to --image (the tenant tag is the part before @).
qaap_rollback_image_ref() {
    local id="$1" revision="$2" repo_digest
    repo_digest="$(docker image inspect "$id" --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null \
        | grep -E '@sha256:[0-9a-f]{64}$' | sed -n '1p' || true)"
    [[ -n "$repo_digest" ]] || return 0
    printf '%s:%s@%s\n' "${repo_digest%@*}" "$revision" "${repo_digest##*@}"
}

qaap_vps_rollback_main "$@"
exit $?
