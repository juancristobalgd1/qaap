#!/usr/bin/env bash
# Test the post-deploy image cleanup against a fake Docker CLI (host + rootless daemons, no daemon needed).
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-image-prune-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-image-prune-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT
mkdir -p "$TEST_ROOT/bin"
sed 's/\r$//' "$SOURCE/qaap-vps-image-prune.sh" > "$TEST_ROOT/qaap-vps-image-prune.sh"

# State per daemon: images (id|repository|tag|digest) and containers (id|image id).
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
daemon="${FAKE_DAEMON:-host}"
dir="$FAKE_STATE/$daemon"
echo "$daemon $*" >> "$FAKE_STATE/calls"
image_of() { awk -F'|' -v c="$1" '$1 == c { print $2 }' "$dir/containers"; }
case "$1" in
    exec)
        # docker exec <theia> docker ... -> the rootless daemon
        shift 2
        [[ "$1" == docker ]] || exit 2
        shift
        FAKE_DAEMON=rootless exec "$0" "$@"
        ;;
    info) exit 0 ;;
    ps)
        [[ "${FAKE_PS_FAIL:-}" != "$daemon" ]] || exit 1
        cut -d'|' -f1 "$dir/containers"
        ;;
    inspect)
        shift
        if [[ "$1" == -f ]]; then image_of "$3"; exit 0; fi
        if [[ "$*" == *Config.Env* ]]; then printf 'QAAP_DOCKER_ROOTLESS=1\nPATH=/usr/bin\n'; exit 0; fi
        shift 2
        for c in "$@"; do image_of "$c"; done
        ;;
    image)
        case "$2" in
            inspect)
                awk -F'|' -v i="$3" '$1 == i && $3 != "<none>" { print $2 ":" $3 }' "$dir/images"
                ;;
            ls)
                repo="${*: -1}"
                awk -F'|' -v r="$repo" '$2 == r' "$dir/images"
                ;;
            rm)
                ref="$3"
                line="$(awk -F'|' -v f="$ref" '($2 ":" $3) == f || ($2 "@" $4) == f || $1 == f' "$dir/images" | head -n 1)"
                [[ -n "$line" ]] || exit 1
                id="${line%%|*}"
                if cut -d'|' -f2 "$dir/containers" | grep -Fxq "$id"; then
                    echo "conflict: image is being used by a container" >&2
                    exit 1
                fi
                grep -Fxv "$line" "$dir/images" > "$dir/images.new" || true
                mv "$dir/images.new" "$dir/images"
                echo "$daemon rm $ref" >> "$FAKE_STATE/removed"
                ;;
            prune) echo 'Total reclaimed space: 0B' ;;
            *) exit 2 ;;
        esac
        ;;
    builder) echo 'Total:	0B' ;;
    *) exit 2 ;;
esac
MOCK
chmod +x "$TEST_ROOT/bin/docker"
export PATH="$TEST_ROOT/bin:$PATH"

fail() { echo "FAIL: $*" >&2; exit 1; }

setup_state() {
    export FAKE_STATE="$TEST_ROOT/state-$1"
    mkdir -p "$FAKE_STATE/host" "$FAKE_STATE/rootless"
    : > "$FAKE_STATE/removed"
    cat > "$FAKE_STATE/host/images" <<'EOF'
sha256:old1|ghcr.io/o/qaap|aaa|sha256:d1
sha256:prev|ghcr.io/o/qaap|bbb|sha256:d2
sha256:curr|ghcr.io/o/qaap|ccc|sha256:d3
sha256:curr|ghcr.io/o/qaap|<none>|sha256:d3
sha256:used|ghcr.io/o/qaap|ddd|sha256:d4
sha256:caddy|caddy|2|sha256:d5
sha256:local|qaap-theia|local|<none>
EOF
    cat > "$FAKE_STATE/host/containers" <<'EOF'
theia|sha256:curr
stopped-old|sha256:used
caddy|sha256:caddy
EOF
    cat > "$FAKE_STATE/rootless/images" <<'EOF'
sha256:old1|ghcr.io/o/qaap|aaa|<none>
sha256:prev|ghcr.io/o/qaap|bbb|<none>
sha256:curr|ghcr.io/o/qaap|ccc|<none>
sha256:old7|ghcr.io/o/qaap|eee|<none>
EOF
    cat > "$FAKE_STATE/rootless/containers" <<'EOF'
qaap-tenant-backend-alice|sha256:old1
EOF
}

run_prune() {
    (
        # shellcheck source=/dev/null
        source "$TEST_ROOT/qaap-vps-image-prune.sh"
        prune_old_qaap_images theia
    ) > "$FAKE_STATE/output" 2>&1 || fail "prune_old_qaap_images returned non-zero: $(cat "$FAKE_STATE/output")"
}

# 1) Normal deploy: keep serving + previous + anything a container uses, in both daemons.
setup_state normal
export QAAP_IMAGE_HISTORY_FILE="$TEST_ROOT/history-normal/image-history"
export IMAGE_REF='ghcr.io/o/qaap:ccc@sha256:d3' PRE_DEPLOY_IMAGE_ID='sha256:prev'
run_prune
sort "$FAKE_STATE/removed" > "$FAKE_STATE/removed.sorted"
printf '%s\n' 'host rm ghcr.io/o/qaap:aaa' 'host rm qaap-theia:local' 'rootless rm ghcr.io/o/qaap:eee' \
    | sort | diff -u - "$FAKE_STATE/removed.sorted" || fail 'unexpected removals'
grep -q 'sha256:prev' "$FAKE_STATE/host/images" || fail 'rollback image removed'
grep -q 'sha256:used' "$FAKE_STATE/host/images" || fail 'image of a stopped container removed'
grep -q 'sha256:caddy' "$FAKE_STATE/host/images" || fail 'non-qaap image removed'
grep -q 'sha256:old1' "$FAKE_STATE/rootless/images" || fail 'image of a stopped tenant container removed'
grep -q 'host builder prune --all --force --filter until=168h' "$FAKE_STATE/calls" || fail 'build cache not pruned with the age filter'
grep -q 'image prune --force' "$FAKE_STATE/calls" || fail 'dangling images not pruned'
if grep -q 'image prune.*-a' "$FAKE_STATE/calls"; then fail 'image prune must not use --all'; fi
[[ "$(cat "$QAAP_IMAGE_HISTORY_FILE")" == 'sha256:curr' ]] || fail 'history not recorded'

# 2) Re-deploy of the same image: the recorded previous release is still retained.
setup_state redeploy
printf '%s\n' 'sha256:prev' 'sha256:curr' > "$QAAP_IMAGE_HISTORY_FILE"
export PRE_DEPLOY_IMAGE_ID='sha256:curr'
run_prune
if grep -q 'bbb' "$FAKE_STATE/removed"; then fail 'previous release removed on re-deploy'; fi
grep -q 'host rm ghcr.io/o/qaap:aaa' "$FAKE_STATE/removed" || fail 'old image kept on re-deploy'

# 3) First recorded deploy without a known previous image: no qaap image is removed.
setup_state first
export QAAP_IMAGE_HISTORY_FILE="$TEST_ROOT/history-first/image-history" PRE_DEPLOY_IMAGE_ID=''
run_prune
[[ ! -s "$FAKE_STATE/removed" ]] || fail 'removed images without a rollback image'
grep -q 'no previous release recorded' "$FAKE_STATE/output" || fail 'missing first-deploy notice'

# 4) Docker errors never fail the deploy and never remove anything.
setup_state broken
export QAAP_IMAGE_HISTORY_FILE="$TEST_ROOT/history-normal/image-history" PRE_DEPLOY_IMAGE_ID='sha256:prev'
export FAKE_PS_FAIL=host
run_prune
unset FAKE_PS_FAIL
if grep -q '^host ' "$FAKE_STATE/removed"; then fail 'removed host images although containers could not be listed'; fi
grep -q 'cannot list containers; skipping' "$FAKE_STATE/output" || fail 'missing skip notice'

echo 'qaap-vps-image-prune tests passed'
