#!/usr/bin/env bash
# Sourced by qaap-vps-update.sh (and qaap-vps-tenant-image.test.sh). Defines preload_tenant_image.
# Callers may set QAAP_TENANT_IMAGE_SOURCE_REF (the deployed `name:tag@sha256:…` reference) before
# calling it.

# ---------------------------------------------------------------------------------------------
# Tenant backends run in the rootless Docker daemon (socket mounted into the Theia container),
# not in the host daemon that pulls the serving image. That daemon must hold the same image.
#
# Copying it with `docker save | docker exec -i <theia> docker load` streams every layer of the
# multi-GB image (uncompressed) through the exec stdin on every deploy, because each deploy is a
# new image: tens of minutes per deploy. When the deployed image is an immutable GHCR digest, the
# rootless daemon pulls that same digest itself instead. A registry pull only downloads layers
# it does not already have (the toolchain base layers stay from earlier deploys), compressed.
#
# Credentials: the pull goes from the host Docker CLI straight to the rootless socket, so the
# deploy user's registry login travels as a per-request header to the daemon only. Nothing is
# written into the Theia container or any tenant. If the host cannot reach the socket, the pull
# runs inside Theia without credentials (works only for a public package). Any failure, or a
# pulled image whose id differs from the host image, falls back to `docker save | docker load`.
# ---------------------------------------------------------------------------------------------

# `name@sha256:…` from `name:tag@sha256:…` (a registry port is not a tag). Empty unless digest-pinned.
tenant_image_digest_ref() {
    local ref="$1" name last
    [[ "$ref" =~ @sha256:[0-9a-f]{64}$ ]] || return 0
    name="${ref%@*}"
    last="${name##*/}"
    if [[ "$last" == *:* ]]; then
        name="${name%:*}"
    fi
    printf '%s@%s\n' "$name" "${ref##*@}"
}

# Host path of the rootless Docker socket the container talks to (DOCKER_HOST bind mount source).
tenant_docker_socket_on_host() {
    local container_id="$1" docker_host target
    docker_host="$(docker inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}' \
        | sed -n 's/^DOCKER_HOST=//p' | sed -n '1p')"
    [[ "$docker_host" == unix://* ]] || return 0
    target="${docker_host#unix://}"
    docker inspect "$container_id" \
        --format "{{range .Mounts}}{{if eq .Destination \"$target\"}}{{.Source}}{{end}}{{end}}"
}

# Pulls the digest into the rootless daemon and tags it as the tenant image. Non-zero on any failure.
pull_tenant_image_digest() {
    local container_id="$1" tenant_image="$2" digest_ref="$3" host_image_id="$4" socket pulled_id
    local -a limit=()
    if command -v timeout >/dev/null; then
        limit=(timeout "${QAAP_TENANT_IMAGE_PULL_TIMEOUT_SECONDS:-1800}")
    fi
    socket="$(tenant_docker_socket_on_host "$container_id" || true)"
    if [[ -n "$socket" && -S "$socket" && -w "$socket" ]]; then
        echo "[qaap-vps-update] pulling $digest_ref into rootless Docker (host client, changed layers only)"
        ${limit[@]+"${limit[@]}"} docker -H "unix://$socket" pull "$digest_ref" || return 1
    else
        echo "[qaap-vps-update] rootless socket not reachable from the host; anonymous pull of $digest_ref inside Theia"
        ${limit[@]+"${limit[@]}"} docker exec "$container_id" docker pull "$digest_ref" || return 1
    fi
    pulled_id="$(docker exec "$container_id" docker image inspect "$digest_ref" --format '{{.Id}}' 2>/dev/null || true)"
    if [[ -z "$pulled_id" || ( -n "$host_image_id" && "$pulled_id" != "$host_image_id" ) ]]; then
        echo "[qaap-vps-update] pulled tenant image id ${pulled_id:-absent} does not match host image ${host_image_id:-absent}" >&2
        return 1
    fi
    docker exec "$container_id" docker tag "$digest_ref" "$tenant_image"
}

# Seeds the rootless tenant daemon through a Theia container that mounts its socket.
# Args (all optional): the container to exec into (default: the current theia service
# container), the tenant image to seed (default: that container's QAAP_TENANT_DOCKER_IMAGE) and
# the deployed digest reference (default: QAAP_TENANT_IMAGE_SOURCE_REF).
preload_tenant_image() {
    local container_id="${1:-}" tenant_image="${2:-}" source_ref="${3:-${QAAP_TENANT_IMAGE_SOURCE_REF:-}}" rootless
    if [[ -z "$container_id" ]]; then
        container_id="$(docker compose ps -q theia | tr -d '\r' | sed -n '1p')"
    fi
    if [[ -z "$container_id" ]]; then
        echo '[qaap-vps-update] no Theia container available to preload the tenant image' >&2
        return 1
    fi

    rootless="$(docker inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}' \
        | sed -n 's/^QAAP_DOCKER_ROOTLESS=//p')"
    if [[ ! "$rootless" =~ ^(1|true)$ ]]; then
        return 0
    fi

    if [[ -z "$tenant_image" ]]; then
        tenant_image="$(docker inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}' \
            | sed -n 's/^QAAP_TENANT_DOCKER_IMAGE=//p')"
    fi
    if [[ -z "$tenant_image" ]]; then
        echo '[qaap-vps-update] QAAP_DOCKER_ROOTLESS is enabled but QAAP_TENANT_DOCKER_IMAGE is empty' >&2
        return 1
    fi

    # The serving image is pulled by the host Docker daemon, while tenant backends use the
    # separate rootless daemon mounted inside Theia. Wait for that daemon before seeding it;
    # otherwise a freshly recreated Theia container can accept HTTP traffic before its Docker
    # socket is ready and the first tenant request reports "No such image".
    echo '[qaap-vps-update] waiting for rootless Docker before preloading tenant image'
    for _ in $(seq 1 60); do
        if docker exec "$container_id" docker info >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    if ! docker exec "$container_id" docker info >/dev/null 2>&1; then
        echo '[qaap-vps-update] rootless Docker did not become ready' >&2
        return 1
    fi

    local host_image_id tenant_image_id digest_ref=''
    host_image_id="$(docker image inspect "$tenant_image" --format '{{.Id}}' 2>/dev/null || true)"
    tenant_image_id="$(docker exec "$container_id" docker image inspect "$tenant_image" --format '{{.Id}}' 2>/dev/null || true)"
    if [[ -n "$tenant_image_id" && ( -z "$host_image_id" || "$tenant_image_id" == "$host_image_id" ) ]]; then
        echo "[qaap-vps-update] tenant image already present in rootless Docker: $tenant_image"
        return 0
    fi

    # Only the digest this deploy pinned for exactly this tenant tag; never an operator override.
    if [[ -n "$source_ref" && "${source_ref%@*}" == "$tenant_image" ]]; then
        digest_ref="$(tenant_image_digest_ref "$source_ref")"
    fi
    if [[ -n "$digest_ref" ]]; then
        if pull_tenant_image_digest "$container_id" "$tenant_image" "$digest_ref" "$host_image_id"; then
            echo "[qaap-vps-update] tenant image pulled into rootless Docker: $tenant_image ($digest_ref)"
            return 0
        fi
        echo '[qaap-vps-update] rootless digest pull failed; falling back to docker save | docker load' >&2
    fi

    # A locally built serving image (e.g. qaap-theia:local) keeps its tag across deploys, so the tag
    # alone says nothing about freshness: copy the host build into the rootless daemon whenever the
    # ids differ. Existing tenant containers notice the new id and are recreated on their next use.
    if [[ -n "$host_image_id" ]]; then
        echo "[qaap-vps-update] loading host build of $tenant_image into rootless Docker (${tenant_image_id:-absent} -> $host_image_id)"
        docker save "$tenant_image" | docker exec -i "$container_id" docker load
        return 0
    fi

    echo "[qaap-vps-update] preloading tenant image into rootless Docker: $tenant_image"
    docker exec "$container_id" docker pull "$tenant_image"
}
