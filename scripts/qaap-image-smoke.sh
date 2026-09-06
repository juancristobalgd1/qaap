#!/usr/bin/env bash
# Verify the exact registry candidate in an ephemeral container, without production secrets.
set -euo pipefail
IMAGE="${1:?usage: qaap-image-smoke.sh image@sha256:digest full-source-sha}"
SOURCE_SHA="${2:?full source commit required}"
[[ "$IMAGE" =~ @sha256:[0-9a-f]{64}$ && "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Immutable image and commit required' >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACT_DIR="${QAAP_IMAGE_SMOKE_ARTIFACT_DIR:-$SCRIPT_DIR/../test-results/qaap-image-smoke}"
mkdir -p "$ARTIFACT_DIR"
CONTAINER=''
cleanup() {
    local result=$?
    if [[ "$CONTAINER" =~ ^[0-9a-f]{64}$ ]]; then
        docker logs "$CONTAINER" > "$ARTIFACT_DIR/container.log" 2>&1 || true
        docker inspect --format '{{json .State}}' "$CONTAINER" > "$ARTIFACT_DIR/state.json" || true
        docker rm -fv "$CONTAINER" >/dev/null || true
    fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker pull "$IMAGE"
REVISION="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE")"
[[ "$REVISION" == "$SOURCE_SHA" ]] || { echo 'Image label does not match source commit' >&2; exit 1; }
CONTAINER="$(docker run --detach --init --memory=4g --cpus=2 \
    --publish 127.0.0.1::4873 \
    --env PORT=4873 --env NODE_ENV=production --env QAAP_SKIP_AUTH=false \
    --env QAAP_CLOUD_MODE=local --env QAAP_AGENT_UID_PER_USER=1 \
    --env QAAP_BETA_ALLOWED_LOGINS=qaap-smoke-a,qaap-smoke-b \
    --env QAAP_GITHUB_CLIENT_ID=qaap-image-smoke \
    --env QAAP_GITHUB_CLIENT_SECRET=not-a-real-secret \
    --env QAAP_OAUTH_PUBLIC_URL=http://127.0.0.1:4873 \
    --env QAAP_AGENT_CLI_UPDATE_CHECK=0 --env QAAP_IMAGE_SMOKE=1 \
    "$IMAGE")"
[[ "$CONTAINER" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid container id' >&2; exit 1; }
MAPPING="$(docker port "$CONTAINER" 4873/tcp)"
[[ "$MAPPING" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || { echo 'Expected a loopback-only port mapping' >&2; exit 1; }
export QAAP_BASE_URL="http://127.0.0.1:${BASH_REMATCH[1]}"
export QAAP_EXPECTED_BUILD_SHA="$SOURCE_SHA"
export QAAP_ENV_FILE=/nonexistent-qaap-image-smoke.env
READY=0
for attempt in $(seq 1 60); do
    if curl -fsS --max-time 3 "$QAAP_BASE_URL/qaap/api/health" >/dev/null; then
        READY=1
        break
    fi
    [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" == 'true' ]] || { echo 'Candidate exited during startup' >&2; exit 1; }
    sleep 2
done
[[ "$READY" == 1 ]] || { echo 'Candidate startup timed out' >&2; exit 1; }
bash "$SCRIPT_DIR/qaap-verify-launch-readiness.sh"
bash "$SCRIPT_DIR/qaap-verify-auth-api-gate.sh"
curl -fsS --max-time 10 "$QAAP_BASE_URL/" > "$ARTIFACT_DIR/index.html"
grep -qi '<html' "$ARTIFACT_DIR/index.html" || { echo 'Frontend HTML missing' >&2; exit 1; }
docker exec -i "$CONTAINER" node < "$SCRIPT_DIR/qaap-image-runtime-check.js"
[[ "$(docker inspect --format '{{.RestartCount}}' "$CONTAINER")" == 0 ]] || { echo 'Candidate restarted' >&2; exit 1; }
echo "PASS: candidate $IMAGE ($SOURCE_SHA) boots with production auth and uid boundaries"
