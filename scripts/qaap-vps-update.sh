#!/usr/bin/env bash
# Update a Qaap VPS deployment (Docker Compose).
# Run on the VPS from the repo root, e.g. /opt/qaap:
#   ./scripts/qaap-vps-update.sh
#   ./scripts/qaap-vps-update.sh --branch cursor/agent-trace-cursor-parity-ae9f
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

BRANCH="${QAAP_VPS_BRANCH:-master}"
NO_CACHE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        --no-cache)
            NO_CACHE=1
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--branch <name>] [--no-cache]"
            echo "  QAAP_VPS_BRANCH  default branch if --branch omitted (default: master)"
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
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

BEFORE="$(git rev-parse --short HEAD)"
echo "[qaap-vps-update] commit: $BEFORE"

if [[ "$NO_CACHE" -eq 1 ]]; then
    docker compose build --no-cache theia
else
    docker compose build theia
fi

docker compose up -d
docker compose ps

echo "[qaap-vps-update] waiting for health..."
for _ in $(seq 1 60); do
    if docker compose exec -T theia node -e "const p=process.env.PORT||4873;require('http').get('http://127.0.0.1:'+p+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
        echo "[qaap-vps-update] ready at commit $BEFORE"
        exit 0
    fi
    sleep 5
done

echo "[qaap-vps-update] container started but health check timed out; see: docker compose logs -f theia" >&2
exit 1
