#!/usr/bin/env bash
# Restart the deployed Theia service without building or pulling another image.
# Run on the VPS from the repository root (or through this script's own path).
set -euo pipefail
umask 077

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

ROTATE_MASTER_SECRET=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --rotate-master-secret)
            ROTATE_MASTER_SECRET=1
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--rotate-master-secret]"
            echo "  --rotate-master-secret  back up .env, rotate QAAP_TENANT_BACKEND_MASTER_SECRET, and restart"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

for command in docker curl python3; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "Required command not found: $command" >&2
        exit 1
    fi
done

CONTAINER=qaap-theia-1
IMAGE="$(docker inspect "$CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || true)"
if [[ ! "$IMAGE" =~ ^ghcr\.io/[^[:space:]]+@sha256:[0-9a-f]{64}$ ]]; then
    echo "Refusing restart: $CONTAINER does not use an immutable GHCR image: ${IMAGE:-<empty>}" >&2
    exit 1
fi

CONTAINER_ENV="$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
BUILD_SHA="$(sed -n 's/^QAAP_BUILD_SHA=//p' <<< "$CONTAINER_ENV" | tail -n 1)"
if [[ ! "$BUILD_SHA" =~ ^[0-9a-f]{12}$ ]]; then
    echo "Refusing restart: $CONTAINER has no valid 12-character QAAP_BUILD_SHA" >&2
    exit 1
fi

echo "[qaap-vps-safe-restart] preserving image $IMAGE (build $BUILD_SHA)"
export QAAP_THEIA_IMAGE="$IMAGE"
export QAAP_BUILD_SHA="$BUILD_SHA"

PORT="$(sed -n 's/^PORT=//p' <<< "$CONTAINER_ENV" | tail -n 1)"
PORT="${PORT:-4873}"
if [[ ! "$PORT" =~ ^[0-9]{1,5}$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "Refusing restart: invalid container PORT: $PORT" >&2
    exit 1
fi
export THEIA_PORT="$PORT"

TENANT_IMAGE="$(sed -n 's/^QAAP_TENANT_DOCKER_IMAGE=//p' <<< "$CONTAINER_ENV" | tail -n 1)"
if [[ -n "$TENANT_IMAGE" ]]; then
    export QAAP_TENANT_DOCKER_IMAGE="$TENANT_IMAGE"
else
    unset QAAP_TENANT_DOCKER_IMAGE || true
fi

HEALTH_TIMEOUT="${QAAP_SAFE_RESTART_TIMEOUT_SECONDS:-240}"
HEALTH_POLL="${QAAP_SAFE_RESTART_POLL_SECONDS:-2}"
if [[ ! "$HEALTH_TIMEOUT" =~ ^[1-9][0-9]*$ || ! "$HEALTH_POLL" =~ ^[1-9][0-9]*$ ]]; then
    echo 'QAAP_SAFE_RESTART_TIMEOUT_SECONDS and QAAP_SAFE_RESTART_POLL_SECONDS must be positive integers' >&2
    exit 2
fi

TEMP_ENV=''
cleanup() {
    if [[ -n "$TEMP_ENV" && -f "$TEMP_ENV" ]]; then
        rm -f -- "$TEMP_ENV"
    fi
}
trap cleanup EXIT

if (( ROTATE_MASTER_SECRET )); then
    ENV_FILE="$REPO_DIR/.env"
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "Cannot rotate master secret: $ENV_FILE does not exist" >&2
        exit 1
    fi

    BACKUP_FILE="$(mktemp "${ENV_FILE}.backup.$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
    cat -- "$ENV_FILE" > "$BACKUP_FILE"
    echo "[qaap-vps-safe-restart] backed up .env to $BACKUP_FILE (mode 0600)"

    NEW_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
    if [[ ! "$NEW_SECRET" =~ ^[0-9a-f]{64}$ ]]; then
        echo "Could not generate a 32-byte master secret" >&2
        exit 1
    fi
    TEMP_ENV="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
    awk -v secret="$NEW_SECRET" '
        BEGIN { written = 0 }
        /^[[:space:]]*QAAP_TENANT_BACKEND_MASTER_SECRET=/ {
            if (!written) {
                print "QAAP_TENANT_BACKEND_MASTER_SECRET=" secret
                written = 1
            }
            next
        }
        { print }
        END {
            if (!written) {
                print "QAAP_TENANT_BACKEND_MASTER_SECRET=" secret
            }
        }
    ' "$ENV_FILE" > "$TEMP_ENV"
    mv -- "$TEMP_ENV" "$ENV_FILE"
    TEMP_ENV=''
    echo '[qaap-vps-safe-restart] rotated QAAP_TENANT_BACKEND_MASTER_SECRET'
fi

# Force recreation makes this a restart even when Compose sees no config delta. The immutable
# image was read from the serving container above; never build, pull, or resolve a mutable tag.
docker compose up -d --no-build --pull never --no-deps --force-recreate theia

echo '[qaap-vps-safe-restart] waiting for theia healthcheck'
DEADLINE=$((SECONDS + HEALTH_TIMEOUT))
while :; do
    if ! HEALTH="$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null)"; then
        echo "Could not inspect health for $CONTAINER" >&2
        exit 1
    fi
    case "$HEALTH" in
        healthy)
            break
            ;;
        unhealthy)
            echo "Theia became unhealthy; see: docker compose logs --tail=120 theia" >&2
            exit 1
            ;;
        starting)
            ;;
        *)
            echo "Theia has no usable Docker healthcheck status: ${HEALTH:-<empty>}" >&2
            exit 1
            ;;
    esac
    if (( SECONDS >= DEADLINE )); then
        echo "Theia did not become healthy within ${HEALTH_TIMEOUT}s; see: docker compose logs --tail=120 theia" >&2
        exit 1
    fi
    sleep "$HEALTH_POLL"
done

echo "[qaap-vps-safe-restart] checking /qaap/api/auth/config on port $PORT"
AUTH_CONFIG="http://127.0.0.1:${PORT}/qaap/api/auth/config"
if ! RESPONSE="$(curl -fsS --max-time 15 "$AUTH_CONFIG")"; then
    echo "Could not read $AUTH_CONFIG after restart" >&2
    exit 1
fi
if ! ACTUAL_BUILD="$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("build") or "")')"; then
    echo 'The auth config endpoint returned invalid JSON' >&2
    exit 1
fi
if [[ "$ACTUAL_BUILD" != "$BUILD_SHA" ]]; then
    echo "Theia build mismatch after restart: expected $BUILD_SHA, got ${ACTUAL_BUILD:-<empty>}" >&2
    exit 1
fi

echo "[qaap-vps-safe-restart] healthy; auth/config confirms build $BUILD_SHA"
