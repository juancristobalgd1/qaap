#!/usr/bin/env bash
# Test the rootless tenant image seed (scripts/qaap-vps-tenant-image.sh) against a fake Docker CLI
# (host + rootless daemons, no daemon needed). Fails if the deploy goes back to streaming the whole
# image with `docker save | docker load` when the rootless daemon can pull the pinned digest, if it
# seeds anything but the pinned digest (never the tag), or if registry credentials could reach the
# rootless daemon or the Theia container (the GHCR package is public: every pull is anonymous).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-tenant-image-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-tenant-image-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT
mkdir -p "$TEST_ROOT/bin"
sed 's/\r$//' "$ROOT/scripts/qaap-vps-tenant-image.sh" > "$TEST_ROOT/qaap-vps-tenant-image.sh"
UPDATE="$ROOT/scripts/qaap-vps-update.sh"

DIGEST="sha256:$(printf 'd%.0s' $(seq 1 64))"
TAG_REF='ghcr.io/o/qaap:abc'
SOURCE_REF="$TAG_REF@$DIGEST"
DIGEST_REF="ghcr.io/o/qaap@$DIGEST"

# Images per daemon: one `reference|id` line per reference. Every call is logged to $FAKE_STATE/calls.
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
daemon="${FAKE_DAEMON:-host}"
if [[ "${1:-}" == -H ]]; then
    [[ "$2" == "unix://$FAKE_SOCKET" ]] || exit 3
    daemon=rootless
    shift 2
fi
dir="$FAKE_STATE/$daemon"
echo "$daemon $*" >> "$FAKE_STATE/calls"
id_of() { awk -F'|' -v r="$1" '$1 == r { print $2 }' "$dir/images" | sed -n '1p'; }
case "$1" in
    exec)
        shift
        [[ "$1" == -i ]] && shift
        # The container never inherits the host client's environment; only an empty client config
        # may be passed in.
        unset DOCKER_CONFIG
        if [[ "$1" == -e ]]; then
            [[ "$2" == DOCKER_CONFIG=/nonexistent/* ]] || exit 2
            export "$2"
            shift 2
        fi
        [[ "$1" == theia ]] || exit 2
        shift
        [[ "$1" == docker ]] || exit 2
        shift
        FAKE_DAEMON=rootless exec "$0" "$@"
        ;;
    inspect)
        [[ "$2" == theia ]] || exit 2
        if [[ "$4" == *Config.Env* ]]; then
            printf 'QAAP_DOCKER_ROOTLESS=1\nDOCKER_HOST=unix:///run/user/1000/docker.sock\nQAAP_TENANT_DOCKER_IMAGE=%s\n' "$FAKE_TENANT_IMAGE"
        elif [[ "$4" == *Mounts* && "$4" == */run/user/1000/docker.sock* ]]; then
            printf '%s\n' "$FAKE_SOCKET"
        fi
        ;;
    info) exit 0 ;;
    image)
        [[ "$2" == inspect ]] || exit 2
        id="$(id_of "$3")"
        [[ -n "$id" ]] || exit 1
        if [[ "$5" == *RepoDigests* ]]; then
            [[ -n "${FAKE_NO_REPO_DIGEST:-}" ]] || awk -F'|' -v i="$id" '$2 == i && $1 ~ /@sha256:/ { print $1 }' "$dir/images"
        else
            printf '%s\n' "$id"
        fi
        ;;
    tag)
        id="$(id_of "$2")"
        [[ -n "$id" ]] || exit 1
        printf '%s|%s\n' "$3" "$id" >> "$dir/images"
        ;;
    pull)
        [[ "$daemon" == rootless && "${FAKE_PULL:-ok}" != fail ]] || exit 1
        [[ "$2" == *@sha256:* ]] || exit 1
        # The default client config (~/.docker) holds the deploy's `docker login`.
        if [[ -z "${DOCKER_CONFIG:-}" || -e "$DOCKER_CONFIG/config.json" ]]; then
            echo 'CREDENTIALED pull' >> "$FAKE_STATE/calls"
        fi
        printf '%s|%s\n' "$2" "${FAKE_PULLED_ID:-sha256:new}" >> "$dir/images"
        ;;
    save) printf 'image-tar:%s\n' "$(id_of "$2")" ;;
    load)
        read -r payload
        [[ "$payload" == image-tar:* ]] || exit 1
        printf '%s|%s\n' "$FAKE_TENANT_IMAGE" "${payload#image-tar:}" >> "$dir/images"
        ;;
    *) exit 2 ;;
esac
MOCK
chmod +x "$TEST_ROOT/bin/docker"
export PATH="$TEST_ROOT/bin:$PATH"

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "ok - $*"; }

SOCKET="$TEST_ROOT/docker.sock"
python3 -c 'import socket, sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$SOCKET"

# $1 case name; the host always holds the deployed image (pulled by `docker compose pull`).
setup() {
    export FAKE_STATE="$TEST_ROOT/state-$1"
    mkdir -p "$FAKE_STATE/host" "$FAKE_STATE/rootless"
    : > "$FAKE_STATE/calls"
    printf '%s|sha256:new\n%s|sha256:new\n' "$SOURCE_REF" "$TAG_REF" > "$FAKE_STATE/host/images"
    printf 'ghcr.io/o/qaap:old|sha256:old\n' > "$FAKE_STATE/rootless/images"
    export FAKE_SOCKET="$SOCKET" FAKE_TENANT_IMAGE="$TAG_REF" FAKE_PULL=ok FAKE_PULLED_ID=sha256:new FAKE_NO_REPO_DIGEST=''
}
# $@: preload_tenant_image arguments.
seed() {
    (
        # shellcheck source=/dev/null
        source "$TEST_ROOT/qaap-vps-tenant-image.sh"
        preload_tenant_image "$@"
    ) > "$FAKE_STATE/output" 2>&1
}
rootless_id() { awk -F'|' -v r="$1" '$1 == r { print $2 }' "$FAKE_STATE/rootless/images" | tail -n 1; }
streamed() { grep -q '^host save ' "$FAKE_STATE/calls"; }

# 1) Pinned GHCR digest, socket reachable: the rootless daemon pulls through the host client.
setup host-pull
if seed theia "$TAG_REF" "$SOURCE_REF"; then
    grep -Fxq "rootless pull $DIGEST_REF" "$FAKE_STATE/calls" \
        && pass 'rootless daemon pulls the pinned digest (changed layers only)' || fail 'digest not pulled into rootless Docker'
    streamed && fail 'whole image still streamed with docker save | docker load' || pass 'no docker save | docker load'
    [[ "$(rootless_id "$TAG_REF")" == sha256:new ]] \
        && pass 'tenant tag points at the pulled digest' || fail 'tenant tag missing or wrong in rootless Docker'
    grep -q 'exec theia docker pull' "$FAKE_STATE/calls" \
        && fail 'pull ran inside Theia although the host client can reach the socket' || pass 'pull runs from the host client'
else
    fail "seed failed: $(cat "$FAKE_STATE/output")"
fi

# 2) Already seeded (post-switch safety net): nothing is pulled or streamed again.
: > "$FAKE_STATE/calls"
if seed theia "$TAG_REF" "$SOURCE_REF" && ! grep -Eq ' (pull|save|load) ' "$FAKE_STATE/calls"; then
    pass 'second seed is a no-op'
else
    fail "second seed did work again: $(cat "$FAKE_STATE/calls")"
fi

# 3) Socket not reachable from the host: anonymous pull inside Theia, still no stream.
setup in-container
export FAKE_SOCKET="$TEST_ROOT/missing.sock"
if seed theia "$TAG_REF" "$SOURCE_REF"; then
    grep -Fxq "host exec -e DOCKER_CONFIG=/nonexistent/qaap-anonymous-pull theia docker pull $DIGEST_REF" "$FAKE_STATE/calls" && ! streamed \
        && pass 'falls back to an anonymous digest pull inside Theia' || fail 'in-container digest pull not used'
else
    fail "in-container seed failed: $(cat "$FAKE_STATE/output")"
fi

# 4) Registry pull fails: fall back to docker save | docker load, deploy keeps going.
setup pull-fails
export FAKE_PULL=fail
if seed theia "$TAG_REF" "$SOURCE_REF"; then
    streamed && [[ "$(rootless_id "$TAG_REF")" == sha256:new ]] \
        && pass 'failed pull falls back to docker save | docker load' || fail 'no fallback after a failed pull'
else
    fail "fallback seed failed: $(cat "$FAKE_STATE/output")"
fi

# 5) Pulled image id differs from the serving image: never tag it, stream the host image instead.
setup id-mismatch
export FAKE_PULLED_ID=sha256:other
if seed theia "$TAG_REF" "$SOURCE_REF"; then
    streamed && [[ "$(rootless_id "$TAG_REF")" == sha256:new ]] \
        && pass 'id mismatch falls back to the host image' || fail 'mismatching pulled image was used'
else
    fail "mismatch seed failed: $(cat "$FAKE_STATE/output")"
fi

# 5b) Pulled image does not carry the pinned digest: never tagged, host image streamed instead.
setup no-repo-digest
export FAKE_NO_REPO_DIGEST=1
if seed theia "$TAG_REF" "$SOURCE_REF"; then
    streamed && [[ "$(rootless_id "$TAG_REF")" == sha256:new ]] \
        && pass 'pulled image without the pinned digest falls back to the host image' || fail 'unverified pulled image was used'
else
    fail "repo digest seed failed: $(cat "$FAKE_STATE/output")"
fi

# 5c) Pinned digest, pull fails and no host image to copy: clear error, never a pull by tag.
setup no-host-image
export FAKE_PULL=fail
: > "$FAKE_STATE/host/images"
if seed theia "$TAG_REF" "$SOURCE_REF"; then
    fail 'seed succeeded without any verified image'
elif grep -Fq " pull $TAG_REF" "$FAKE_STATE/calls"; then
    fail 'pinned deploy fell back to pulling the mutable tag'
else
    pass 'pinned deploy without a host image fails instead of pulling the tag'
fi

# 6) Local build (no digest) and operator-chosen tenant image: only save | load, never a pull.
setup local-build
if seed theia "$TAG_REF" '' && streamed && ! grep -q ' pull ' "$FAKE_STATE/calls"; then
    pass 'without a pinned digest the host build is copied'
else
    fail "local build seed: $(cat "$FAKE_STATE/calls")"
fi
setup override
if seed theia "$TAG_REF" "ghcr.io/o/other:abc@$DIGEST" && ! grep -q ' pull ' "$FAKE_STATE/calls"; then
    pass 'a digest for another tag is never pulled under the tenant tag'
else
    fail "override seed pulled: $(cat "$FAKE_STATE/calls")"
fi

# 7) No credentials anywhere: no login, no env injected through exec except an empty client
# config, and no pull (host client or inside Theia) that could send the deploy's registry login.
grep -rhE ' login|exec (-i )?(--env|-e [^D]|-e DOCKER_CONFIG=[^/])' "$TEST_ROOT"/state-*/calls \
    && fail 'credentials passed into the Theia container' || pass 'no credentials passed into the Theia container'
grep -rh '^CREDENTIALED' "$TEST_ROOT"/state-*/calls \
    && fail 'a digest pull sent the registry login' || pass 'digest pulls are anonymous'

# 8) Digest reference parsing (registry ports are not tags; tags without a digest are not pulled).
(
    # shellcheck source=/dev/null
    source "$TEST_ROOT/qaap-vps-tenant-image.sh"
    [[ "$(tenant_image_digest_ref "localhost:5000/o/qaap:abc@$DIGEST")" == "localhost:5000/o/qaap@$DIGEST" ]] || exit 1
    [[ "$(tenant_image_digest_ref "localhost:5000/o/qaap@$DIGEST")" == "localhost:5000/o/qaap@$DIGEST" ]] || exit 1
    [[ -z "$(tenant_image_digest_ref 'ghcr.io/o/qaap:abc')" ]] || exit 1
    [[ -z "$(tenant_image_digest_ref 'ghcr.io/o/qaap:abc@sha256:short')" ]] || exit 1
) && pass 'digest references are parsed strictly' || fail 'digest reference parsing'

# 9) Deploy wiring: the update script sources the seed and hands it the pinned digest.
grep -Fxq 'source "$REPO_DIR/scripts/qaap-vps-tenant-image.sh"' "$UPDATE" \
    && grep -Fxq '        QAAP_TENANT_IMAGE_SOURCE_REF="$IMAGE_REF"' "$UPDATE" \
    && pass 'qaap-vps-update.sh seeds tenants from the pinned digest' || fail 'qaap-vps-update.sh no longer wires the digest seed'

if (( failures > 0 )); then
    echo "$failures failure(s)" >&2
    exit 1
fi
echo 'qaap-vps-tenant-image tests passed'
