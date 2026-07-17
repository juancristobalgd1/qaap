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

# Pin this build to the exact upstream QAIQ commit so the image is reproducible and never frozen:
# same SHA → the qaiq layer stays cached, an advanced SHA → a fresh clone. The Dockerfile clones
# QAIQ in its own CACHE_BUST-keyed layer, so this only re-clones qaiq (not the whole toolchain).
if [[ -n "$IMAGE_REF" ]]; then
    export QAAP_THEIA_IMAGE="$IMAGE_REF"
    echo "[qaap-vps-update] image: $QAAP_THEIA_IMAGE"
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
    QAIQ_REF="${QAIQ_REF:-main}"
    CACHE_BUST="$(git ls-remote "$QAIQ_REPO_URL" "$QAIQ_REF" 2>/dev/null | cut -f1)"
    CACHE_BUST="${CACHE_BUST:-$(date +%s)}"
    echo "[qaap-vps-update] qaiq: $QAIQ_REF @ ${CACHE_BUST:0:12}"

    if [[ "$NO_CACHE" -eq 1 ]]; then
        docker compose build --no-cache --build-arg "CACHE_BUST=$CACHE_BUST" theia
    else
        docker compose build --build-arg "CACHE_BUST=$CACHE_BUST" theia
    fi
    docker compose up -d
fi
docker compose ps

echo "[qaap-vps-update] waiting for health..."
for _ in $(seq 1 60); do
    if docker compose exec -T theia node -e "const p=process.env.PORT||4873;require('http').get('http://127.0.0.1:'+p+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
        echo "[qaap-vps-update] ready at commit $BEFORE"
        # Report searxng health (non-fatal — the IDE runs without it, only @qaiq web search needs it).
        SX_HEALTH="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q searxng 2>/dev/null)" 2>/dev/null || echo unknown)"
        echo "[qaap-vps-update] searxng health: ${SX_HEALTH:-unknown}"
        if [[ "$SX_HEALTH" == "unhealthy" ]]; then
            echo "[qaap-vps-update] WARNING: searxng is unhealthy — @qaiq web search will fail (docker compose logs searxng)" >&2
        fi
        exit 0
    fi
    sleep 5
done

echo "[qaap-vps-update] container started but health check timed out; see: docker compose logs -f theia" >&2
exit 1
