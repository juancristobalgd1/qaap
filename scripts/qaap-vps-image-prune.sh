#!/usr/bin/env bash
# Sourced by qaap-vps-update.sh (and qaap-vps-image-prune.test.sh). Defines prune_old_qaap_images.
# Callers may set IMAGE_REF (deployed image reference) and PRE_DEPLOY_IMAGE_ID before calling it.

# ---------------------------------------------------------------------------------------------
# Post-deploy image cleanup. Images are built in CI and pulled here, so every deploy leaves the
# previous qaap image behind in the host daemon AND (via `docker save | docker load`) in the
# rootless tenant daemon. Keep the image now serving, the image it replaced (rollback) and the
# previous recorded deploy; remove older qaap images, dangling images and old build cache.
# Never removes an image referenced by any container (running or stopped): those are skipped
# here and `docker image rm` without --force refuses them as well. Never fails the deploy.
# ---------------------------------------------------------------------------------------------
QAAP_IMAGE_HISTORY_FILE="${QAAP_IMAGE_HISTORY_FILE:-${XDG_STATE_HOME:-${HOME:-/root}/.local/state}/qaap-deploy/image-history}"

# Repository part of an image reference: drop `@digest`, then a trailing `:tag` (not a registry port).
image_repository() {
    local ref="${1%@*}"
    local last="${ref##*/}"
    if [[ "$last" == *:* ]]; then
        ref="${ref%:*}"
    fi
    printf '%s\n' "$ref"
}

# prune_qaap_images_in <label> <keep ids (one per line)> <repositories (one per line)> <docker cmd...>
prune_qaap_images_in() {
    local label="$1" keep_ids="$2" repos="$3"
    shift 3
    local -a dk=("$@")
    local containers used_ids='' repo id repo_name tag digest ref removed=0 retained=0

    if ! containers="$("${dk[@]}" ps -aq --no-trunc 2>/dev/null)"; then
        echo "[qaap-vps-update] image cleanup ($label): cannot list containers; skipping"
        return 0
    fi
    if [[ -n "$containers" ]]; then
        # shellcheck disable=SC2086 # one container id per word
        if ! used_ids="$("${dk[@]}" inspect --format '{{.Image}}' $containers 2>/dev/null)"; then
            echo "[qaap-vps-update] image cleanup ($label): cannot resolve container images; skipping"
            return 0
        fi
    fi

    while IFS= read -r repo; do
        [[ -n "$repo" ]] || continue
        while IFS='|' read -r id repo_name tag digest; do
            [[ -n "$id" ]] || continue
            if grep -Fxq -- "$id" <<<"$keep_ids" || grep -Fxq -- "$id" <<<"$used_ids"; then
                retained=$((retained + 1))
                continue
            fi
            if [[ "$tag" != '<none>' ]]; then
                ref="$repo_name:$tag"
            elif [[ "$digest" != '<none>' ]]; then
                ref="$repo_name@$digest"
            else
                ref="$id"
            fi
            if "${dk[@]}" image rm "$ref" >/dev/null 2>&1; then
                echo "[qaap-vps-update] image cleanup ($label): removed $ref"
                removed=$((removed + 1))
            else
                echo "[qaap-vps-update] image cleanup ($label): could not remove $ref (kept)"
            fi
        done < <("${dk[@]}" image ls --no-trunc --digests --format '{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Digest}}' "$repo" 2>/dev/null || true)
    done <<<"$repos"
    echo "[qaap-vps-update] image cleanup ($label): removed $removed old qaap image reference(s); retained $retained (serving, rollback or used by a container)"

    # Dangling images only (`--all` is deliberately not used); Docker never prunes images in use.
    "${dk[@]}" image prune --force 2>&1 | tail -n 1 | sed "s/^/[qaap-vps-update] dangling images ($label): /" || true
}

prune_old_qaap_images() {
    local container_id="$1"
    local current_id previous_id='' keep_ids repos='' history_dir rootless
    current_id="$(docker inspect -f '{{.Image}}' "$container_id" 2>/dev/null || true)"
    if [[ -z "$current_id" ]]; then
        echo '[qaap-vps-update] image cleanup: cannot resolve the serving image; skipping'
        return 0
    fi

    # Deploy history (image ids, oldest first): a re-deploy of the same image still keeps the
    # previous release for rollback, not just whatever was running a minute ago.
    history_dir="$(dirname "$QAAP_IMAGE_HISTORY_FILE")"
    if mkdir -p "$history_dir" 2>/dev/null && touch "$QAAP_IMAGE_HISTORY_FILE" 2>/dev/null; then
        if [[ "$(tail -n 1 "$QAAP_IMAGE_HISTORY_FILE")" != "$current_id" ]]; then
            printf '%s\n' "$current_id" >>"$QAAP_IMAGE_HISTORY_FILE"
        fi
        tail -n 20 "$QAAP_IMAGE_HISTORY_FILE" >"$QAAP_IMAGE_HISTORY_FILE.tmp" \
            && mv "$QAAP_IMAGE_HISTORY_FILE.tmp" "$QAAP_IMAGE_HISTORY_FILE"
        previous_id="$(grep -Fxv -- "$current_id" "$QAAP_IMAGE_HISTORY_FILE" | tail -n 1 || true)"
    else
        echo "[qaap-vps-update] image cleanup: cannot write $QAAP_IMAGE_HISTORY_FILE; relying on the pre-deploy image"
    fi
    if [[ -n "${PRE_DEPLOY_IMAGE_ID:-}" && "$PRE_DEPLOY_IMAGE_ID" != "$current_id" ]]; then
        previous_id="${previous_id:-$PRE_DEPLOY_IMAGE_ID}"
    fi
    keep_ids="$(printf '%s\n' "$current_id" "${PRE_DEPLOY_IMAGE_ID:-}" "$previous_id" | sed '/^$/d' | sort -u)"

    if [[ -z "$previous_id" ]]; then
        # No known rollback image yet (first recorded deploy): only dangling data is cleaned.
        echo '[qaap-vps-update] image cleanup: no previous release recorded yet; keeping all qaap images'
    else
        repos="$( {
            docker image inspect "$current_id" --format '{{range .RepoTags}}{{println .}}{{end}}' 2>/dev/null || true
            if [[ -n "$IMAGE_REF" ]]; then printf '%s\n' "$IMAGE_REF"; fi
            printf '%s\n' 'qaap-theia:local'
        } | sed '/^$/d' | while IFS= read -r ref; do image_repository "$ref"; done | sort -u)"
    fi
    echo "[qaap-vps-update] image cleanup: retaining $(printf '%s\n' "$keep_ids" | cut -c1-19 | paste -sd' ' -)"

    prune_qaap_images_in host "$keep_ids" "$repos" docker

    rootless="$(docker inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
        | sed -n 's/^QAAP_DOCKER_ROOTLESS=//p' | sed -n '1p')"
    if [[ "$rootless" =~ ^(1|true)$ ]]; then
        if docker exec "$container_id" docker info >/dev/null 2>&1; then
            # Same image ids in both daemons: `docker save | docker load` preserves the image id.
            # Stopped tenant containers still on an old image keep it (docker refuses to remove it).
            prune_qaap_images_in rootless "$keep_ids" "$repos" docker exec "$container_id" docker
        else
            echo '[qaap-vps-update] image cleanup (rootless): tenant Docker not reachable; skipping'
        fi
    fi

    # Build cache: the VPS normally pulls CI-built images (deploys pass --image). Keep recent
    # cache so a manual source build (no --image) stays incremental; drop unused older cache.
    local until="${QAAP_DOCKER_BUILDER_PRUNE_UNTIL:-168h}"
    docker builder prune --all --force --filter "until=$until" 2>&1 | tail -n 1 \
        | sed "s/^/[qaap-vps-update] build cache older than $until: /" || true
}
