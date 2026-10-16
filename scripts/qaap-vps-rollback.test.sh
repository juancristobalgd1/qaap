#!/usr/bin/env bash
# Test the one-command rollback (scripts/qaap-vps-rollback.sh) against a fake Docker CLI and a fake
# update script. Fails if the rollback picks anything but a retained CI release other than the one
# serving, if it redeploys without pinning the image digest and its commit, or if it changes the
# host on --dry-run / when nothing can be rolled back to.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-rollback-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-rollback-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT

hex() { printf "$1%.0s" $(seq 1 "$2"); }
ID_OLD="sha256:$(hex a 64)"
ID_PREV="sha256:$(hex b 64)"
ID_SERVING="sha256:$(hex c 64)"
ID_LOCAL="sha256:$(hex e 64)"
REV_OLD="$(hex 1 40)"
REV_PREV="$(hex 2 40)"
REV_SERVING="$(hex 3 40)"
DIGEST_PREV="sha256:$(hex f 64)"
DIGEST_OLD="sha256:$(hex 9 64)"

# Fake repo: the rollback script, the prune helper it sources, and an update script that records
# its arguments instead of deploying.
REPO="$TEST_ROOT/repo"
mkdir -p "$REPO/scripts" "$TEST_ROOT/bin"
cp "$ROOT/scripts/qaap-vps-rollback.sh" "$ROOT/scripts/qaap-vps-image-prune.sh" "$REPO/scripts/"
cat > "$REPO/scripts/qaap-vps-update.sh" <<'UPDATE'
#!/usr/bin/env bash
echo "update $*" >> "$FAKE_STATE/calls"
UPDATE
chmod +x "$REPO/scripts/"*.sh

# Images present in the host daemon: `id|revision|repo digest`. The serving container runs ID_SERVING.
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
echo "docker $*" >> "$FAKE_STATE/calls"
row() { awk -F'|' -v i="$1" '$1 == i' "$FAKE_STATE/images"; }
case "$1 ${2:-}" in
    'compose ps') printf 'theia-container\n' ;;
    'inspect -f') [[ "$3" == '{{.Image}}' ]] && printf '%s\n' "$FAKE_SERVING" ;;
    'image inspect')
        line="$(row "$3")"
        [[ -n "$line" ]] || exit 1
        case "${5:-}" in
            *revision*) printf '%s\n' "$(cut -d'|' -f2 <<< "$line")" ;;
            *RepoDigests*) cut -d'|' -f3 <<< "$line" | sed '/^$/d' ;;
            '') ;;
        esac
        ;;
    *) exit 2 ;;
esac
MOCK
cat > "$TEST_ROOT/bin/git" <<'MOCK'
#!/usr/bin/env bash
echo "git $*" >> "$FAKE_STATE/calls"
[[ "$1" == status ]] && printf '%s' "${FAKE_DIRTY:-}"
exit 0
MOCK
chmod +x "$TEST_ROOT/bin/"*
export PATH="$TEST_ROOT/bin:$PATH"

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "ok - $*"; }

# $1 case name. History (oldest first): an image already pruned, two retained releases, serving.
setup() {
    export FAKE_STATE="$TEST_ROOT/state-$1"
    mkdir -p "$FAKE_STATE"
    : > "$FAKE_STATE/calls"
    export QAAP_IMAGE_HISTORY_FILE="$FAKE_STATE/image-history"
    printf '%s\n' "sha256:$(hex d 64)" "$ID_OLD" "$ID_PREV" "$ID_SERVING" > "$QAAP_IMAGE_HISTORY_FILE"
    printf '%s\n' \
        "$ID_OLD|$REV_OLD|ghcr.io/o/qaap@$DIGEST_OLD" \
        "$ID_PREV|$REV_PREV|ghcr.io/o/qaap@$DIGEST_PREV" \
        "$ID_SERVING|$REV_SERVING|ghcr.io/o/qaap@sha256:$(hex 8 64)" \
        "$ID_LOCAL||" > "$FAKE_STATE/images"
    export FAKE_SERVING="$ID_SERVING" FAKE_DIRTY=''
}
rollback() { bash "$REPO/scripts/qaap-vps-rollback.sh" "$@" > "$FAKE_STATE/output" 2>&1; }
deployed() { grep '^update ' "$FAKE_STATE/calls" || true; }

# 1) Default: the newest retained release that is not serving, pinned by digest and commit.
setup default
if rollback; then
    [[ "$(deployed)" == "update --branch master --revision $REV_PREV --image ghcr.io/o/qaap:$REV_PREV@$DIGEST_PREV" ]] \
        && pass 'rolls back to the previous release, pinned by digest and commit' || fail "default rollback: $(deployed)"
    grep -Fxq "git checkout --detach $REV_PREV" "$FAKE_STATE/calls" \
        && pass 'checks out the commit baked into the image' || fail 'commit not checked out'
    grep -q '^git stash' "$FAKE_STATE/calls" && fail 'stashed a clean worktree' || pass 'clean worktree is not stashed'
else
    fail "default rollback failed: $(cat "$FAKE_STATE/output")"
fi

# 2) --to by commit prefix and by image id prefix.
setup to-commit
if rollback --to "${REV_OLD:0:7}" && [[ "$(deployed)" == *"--revision $REV_OLD --image ghcr.io/o/qaap:$REV_OLD@$DIGEST_OLD" ]]; then
    pass '--to selects a release by commit prefix'
else
    fail "--to commit: $(cat "$FAKE_STATE/output")"
fi
setup to-id
if rollback --to "$(hex a 12)" && [[ "$(deployed)" == *"--revision $REV_OLD "* ]]; then
    pass '--to selects a release by image id prefix'
else
    fail "--to id: $(cat "$FAKE_STATE/output")"
fi

# 3) --dry-run prints the plan and touches nothing.
setup dry-run
if rollback --dry-run && grep -q "$REV_PREV" "$FAKE_STATE/output" \
    && ! grep -Eq '^(update|git )' "$FAKE_STATE/calls"; then
    pass '--dry-run changes nothing'
else
    fail "dry run: $(cat "$FAKE_STATE/calls")"
fi

# 4) Dirty worktree is preserved in a stash before the checkout (never a forced checkout).
setup dirty
export FAKE_DIRTY=' M Dockerfile'
if rollback && grep -q '^git stash push --include-untracked' "$FAKE_STATE/calls"; then
    pass 'dirty worktree is stashed before the checkout'
else
    fail "dirty: $(cat "$FAKE_STATE/calls")"
fi

# 5) Nothing to roll back to: only the serving image, or a target that is not retained / not CI-built.
setup nothing
printf '%s\n' "$ID_SERVING" > "$QAAP_IMAGE_HISTORY_FILE"
if rollback; then fail 'rolled back without a retained release'; else
    [[ -z "$(deployed)" ]] && pass 'no retained release: fails without deploying' || fail 'deployed anyway'
fi
setup serving-target
if rollback --to "${REV_SERVING:0:7}"; then fail 'rolled back onto the serving release'; else
    pass 'never "rolls back" to the release already serving'
fi
setup local-build
printf '%s\n' "$ID_LOCAL" "$ID_SERVING" > "$QAAP_IMAGE_HISTORY_FILE"
if rollback; then fail 'rolled back to a local build without a commit label'; else
    [[ -z "$(deployed)" ]] && pass 'a local build without a commit label is refused' || fail 'local build deployed'
fi

# 6) --list shows retained releases and marks the serving one.
setup list
if rollback --list && grep -q "$REV_SERVING  (serving)" "$FAKE_STATE/output" \
    && grep -q "$REV_PREV" "$FAKE_STATE/output" && [[ -z "$(deployed)" ]]; then
    pass '--list shows retained releases'
else
    fail "list: $(cat "$FAKE_STATE/output")"
fi

if (( failures > 0 )); then
    echo "$failures failure(s)" >&2
    exit 1
fi
echo 'qaap-vps-rollback tests passed'
