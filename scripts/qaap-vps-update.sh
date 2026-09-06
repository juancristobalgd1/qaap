#!/usr/bin/env bash
# Update a Qaap VPS deployment (Docker Compose).
# Run on the VPS from the repo root, e.g. /opt/qaap:
#   ./scripts/qaap-vps-update.sh
#   ./scripts/qaap-vps-update.sh --branch cursor/agent-trace-cursor-parity-ae9f
#   ./scripts/qaap-vps-update.sh --revision <sha> --image ghcr.io/owner/qaap:<sha>@sha256:<digest>
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

BRANCH="${QAAP_VPS_BRANCH:-master}"
NO_CACHE=0
IMAGE_REF="${QAAP_THEIA_IMAGE:-}"
REVISION=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --branch)
            [[ $# -ge 2 ]] || { echo "--branch requires a value" >&2; exit 1; }
            BRANCH="$2"
            shift 2
            ;;
        --no-cache)
            NO_CACHE=1
            shift
            ;;
        --image)
            [[ $# -ge 2 ]] || { echo "--image requires a value" >&2; exit 1; }
            IMAGE_REF="$2"
            shift 2
            ;;
        --revision)
            [[ $# -ge 2 ]] || { echo "--revision requires a value" >&2; exit 1; }
            REVISION="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--branch <name>] [--revision <sha>] [--image <ref>] [--no-cache]"
            echo "  QAAP_VPS_BRANCH  default branch if --branch omitted (default: master)"
            echo "  QAAP_THEIA_IMAGE immutable prebuilt image; omit to build from source"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if ! command -v docker >/dev/null; then
    echo "docker not found" >&2
    exit 1
fi

ensure_docker_pull_space() {
    local minimum_free_gb="${QAAP_DOCKER_MIN_FREE_GB:-25}"
    if [[ ! "$minimum_free_gb" =~ ^[0-9]+$ ]]; then
        echo "QAAP_DOCKER_MIN_FREE_GB must be a non-negative integer: $minimum_free_gb" >&2
        exit 1
    fi

    local docker_root
    docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
    if [[ -z "$docker_root" || ! -d "$docker_root" ]]; then
        docker_root="/"
    fi

    local available_kb
    available_kb="$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')"
    if [[ ! "$available_kb" =~ ^[0-9]+$ ]]; then
        echo "Could not determine free space for Docker root: $docker_root" >&2
        exit 1
    fi

    local minimum_free_kb=$((minimum_free_gb * 1024 * 1024))
    echo "[qaap-vps-update] Docker free space: $((available_kb / 1024 / 1024)) GiB (minimum: ${minimum_free_gb} GiB)"
    if (( available_kb >= minimum_free_kb )); then
        return
    fi

    echo "[qaap-vps-update] low Docker disk space; pruning build cache only (retain rollback/migration images)"
    docker builder prune --all --force | tail -n 1

    available_kb="$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')"
    echo "[qaap-vps-update] Docker free space after prune: $((available_kb / 1024 / 1024)) GiB"
    if (( available_kb < minimum_free_kb )); then
        echo "Insufficient Docker disk space after pruning: need ${minimum_free_gb} GiB under $docker_root" >&2
        exit 1
    fi
}

refresh_caddy() {
    # Git replaces a checked-out bind-mounted file by inode. A running Caddy container can keep
    # the old inode, so `docker compose up -d` may leave the previous Caddyfile active even though
    # the repository contains the new one. Validate the fresh bind mount first, then recreate only
    # Caddy. `--no-deps` is deliberate: a config refresh must never rebuild the Theia image.
    if ! docker compose config --services | grep -Fxq caddy; then
        return 0
    fi

    echo "[qaap-vps-update] validating Caddy configuration"
    docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    echo "[qaap-vps-update] recreating Caddy to refresh the bind-mounted configuration"
    docker compose up -d --no-deps --force-recreate caddy
}

echo "[qaap-vps-update] repo: $REPO_DIR"
echo "[qaap-vps-update] branch: $BRANCH"

git fetch origin
if [[ -n "$REVISION" ]]; then
    if ! git cat-file -e "${REVISION}^{commit}" 2>/dev/null; then
        echo "Revision not found after fetch: $REVISION" >&2
        exit 1
    fi
    git checkout --detach "$REVISION"
else
    git checkout "$BRANCH"
    git pull --ff-only origin "$BRANCH"
fi

SOURCE_SHA="$(git rev-parse HEAD)"
BEFORE="$(git rev-parse --short=12 HEAD)"
if [[ -n "$REVISION" && "$(git rev-parse "${REVISION}^{commit}")" != "$SOURCE_SHA" ]]; then
    echo "Checked-out commit $SOURCE_SHA does not match requested revision $REVISION" >&2
    exit 1
fi
echo "[qaap-vps-update] commit: $BEFORE"

# Bake the deployed commit into the image (served via /qaap/api/auth/config and shown in the
# Work Hub footer) so "which build is serving?" is answerable at a glance. docker compose reads
# this from the environment for the QAAP_BUILD_SHA build arg.
export QAAP_BUILD_SHA="$BEFORE"

# Fail before replacing the old container if runtime state is still in its writable layer.
node scripts/qaap-persist-runtime-state.mjs --check

# Pin this build to the exact upstream QAIQ commit so the image is reproducible and never frozen:
# same SHA → the qaiq layer stays cached, an advanced SHA → a fresh clone. The Dockerfile clones
# QAIQ in its own CACHE_BUST-keyed layer, so this only re-clones qaiq (not the whole toolchain).
if [[ -n "$IMAGE_REF" ]]; then
    export QAAP_THEIA_IMAGE="$IMAGE_REF"
    echo "[qaap-vps-update] image: $QAAP_THEIA_IMAGE"
    ensure_docker_pull_space
    docker compose pull theia
    IMAGE_REVISION="$(docker image inspect "$QAAP_THEIA_IMAGE" \
        --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
    if [[ -z "$IMAGE_REVISION" ]]; then
        echo "Image has no org.opencontainers.image.revision label: $QAAP_THEIA_IMAGE" >&2
        exit 1
    fi
    if [[ "$IMAGE_REVISION" != "$SOURCE_SHA" ]]; then
        echo "Image revision $IMAGE_REVISION does not match checked-out commit $SOURCE_SHA" >&2
        exit 1
    fi
    docker compose up -d --no-build
else
    # Pin source builds to the exact upstream QAIQ commit. CI-built GHCR images already receive
    # this build arg in the publish job, so the pull path skips all build work on the VPS.
    QAIQ_REPO_URL="${QAIQ_REPO:-https://github.com/juancristobalgd1/qaiq.git}"
    CACHE_BUST="${QAIQ_COMMIT:-$(sed -n 's/^ARG QAIQ_COMMIT=//p' Dockerfile | tr -d '\r')}"
    if [[ -n "${QAIQ_REF:-}" ]]; then
        CACHE_BUST="$(git ls-remote "$QAIQ_REPO_URL" "$QAIQ_REF" | cut -f1)"
    fi
    if [[ ! "$CACHE_BUST" =~ ^[0-9a-f]{40}$ ]]; then
        echo "[qaap-vps-update] cannot resolve an exact QAIQ commit; refusing an unpinned build" >&2
        exit 1
    fi
    echo "[qaap-vps-update] qaiq pinned at ${CACHE_BUST:0:12}"

    if [[ "$NO_CACHE" -eq 1 ]]; then
        docker compose build --no-cache --build-arg "QAIQ_COMMIT=$CACHE_BUST" --build-arg "CACHE_BUST=$CACHE_BUST" theia
    else
        docker compose build --build-arg "QAIQ_COMMIT=$CACHE_BUST" --build-arg "CACHE_BUST=$CACHE_BUST" theia
    fi
    docker compose up -d
fi
refresh_caddy
docker compose ps

# Loopback :4873 only. Public HTTPS health is asserted by Actions against
# QAAP_VPS_PUBLIC_URL (Caddy / sslip.io), never against a public :4873 bind.
echo "[qaap-vps-update] waiting for health..."
for _ in $(seq 1 60); do
    if docker compose exec -T theia node -e "const p=process.env.PORT||4873;require('http').get('http://127.0.0.1:'+p+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
        echo "[qaap-vps-update] verifying integrated terminal shell..."
        if ! docker compose exec -T theia node -e '
            const { constants, accessSync } = require("fs");
            const { spawnSync } = require("child_process");
            const { ShellProcess } = require("/app/packages/terminal/lib/node/shell-process");
            const shell = ShellProcess.getShellExecutablePath();
            if (!shell) {
                throw new Error("Theia did not resolve a terminal shell (THEIA_SHELL and SHELL are empty)");
            }
            accessSync(shell, constants.X_OK);
            const probe = spawnSync(shell, ["-lc", "printf QAAP_TERMINAL_OK"], { encoding: "utf8" });
            if (probe.status !== 0 || probe.stdout !== "QAAP_TERMINAL_OK") {
                throw new Error(`Terminal shell probe failed for ${shell}: ${probe.stderr || `exit ${probe.status}`}`);
            }
            console.log(`[qaap-vps-update] terminal shell: ${shell} (OK)`);
        '; then
            echo "[qaap-vps-update] integrated terminal shell check failed" >&2
            exit 1
        fi
        THEIA_CONTAINER_ID="$(docker compose ps -q theia)"
        THEIA_RESTART_COUNT="$(docker inspect -f '{{.RestartCount}}' "$THEIA_CONTAINER_ID" 2>/dev/null || echo unknown)"
        if [[ "$THEIA_RESTART_COUNT" != "0" ]]; then
            echo "[qaap-vps-update] theia restarted ${THEIA_RESTART_COUNT} time(s) during startup; refusing to report a healthy deploy" >&2
            docker compose logs --tail=120 theia >&2
            exit 1
        fi
        THEIA_MEMORY="$(docker stats --no-stream --format '{{.MemUsage}}' "$THEIA_CONTAINER_ID" 2>/dev/null || echo unknown)"
        echo "[qaap-vps-update] theia memory: $THEIA_MEMORY; restarts: $THEIA_RESTART_COUNT"
        echo "[qaap-vps-update] ready at commit $BEFORE"
        # Report searxng health (non-fatal — the IDE runs without it, only @qaiq web search needs it).
        SX_HEALTH="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q searxng 2>/dev/null)" 2>/dev/null || echo unknown)"
        echo "[qaap-vps-update] searxng health: ${SX_HEALTH:-unknown}"
        if [[ "$SX_HEALTH" == "unhealthy" ]]; then
            echo "[qaap-vps-update] WARNING: searxng is unhealthy — @qaiq web search will fail (docker compose logs searxng)" >&2
        fi
        echo "[qaap-vps-update] running launch gate (backup cron + isolation snapshot)..."
        chmod +x "$REPO_DIR/scripts/qaap-vps-launch-gate.sh" "$REPO_DIR/scripts/qaap-vps-ensure-backup-cron.sh" || true
        "$REPO_DIR/scripts/qaap-vps-launch-gate.sh"
        exit 0
    fi
    sleep 5
done

echo "[qaap-vps-update] container started but health check timed out; see: docker compose logs -f theia" >&2
exit 1
