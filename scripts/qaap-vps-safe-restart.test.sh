#!/usr/bin/env bash
# Exercise safe restart behavior with fake Docker/curl commands; no daemon or network needed.
set -euo pipefail

SOURCE="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-vps-safe-restart-test.XXXXXXXX)"
cleanup() {
    case "$TEST_ROOT" in
        */qaap-vps-safe-restart-test.*) rm -rf -- "$TEST_ROOT" ;;
        *) echo "Refusing to remove unexpected test path: $TEST_ROOT" >&2; exit 2 ;;
    esac
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/repo/scripts" "$TEST_ROOT/bin"
sed 's/\r$//' "$SOURCE/qaap-vps-safe-restart.sh" > "$TEST_ROOT/repo/scripts/qaap-vps-safe-restart.sh"
chmod +x "$TEST_ROOT/repo/scripts/qaap-vps-safe-restart.sh"

cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker' >> "$QAAP_TEST_CALLS"
printf ' <%s>' "$@" >> "$QAAP_TEST_CALLS"
printf '\n' >> "$QAAP_TEST_CALLS"
case "$*" in
    *'{{.Config.Image}}'*) printf '%s\n' "${QAAP_TEST_IMAGE:-ghcr.io/qaap/theia:abc123456789@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
    *'{{range .Config.Env}}'*)
        printf 'QAAP_BUILD_SHA=abc123456789\nPORT=4873\nQAAP_TENANT_DOCKER_IMAGE=ghcr.io/qaap/theia:abc123456789\n'
        ;;
    *'{{.State.Health.Status}}'*)
        calls=0
        [[ ! -f "$QAAP_TEST_HEALTH_CALLS" ]] || calls="$(cat "$QAAP_TEST_HEALTH_CALLS")"
        calls=$((calls + 1))
        printf '%s\n' "$calls" > "$QAAP_TEST_HEALTH_CALLS"
        if [[ "${QAAP_TEST_HEALTH:-starting-then-healthy}" == healthy ]]; then
            printf 'healthy\n'
        elif [[ "${QAAP_TEST_HEALTH:-starting-then-healthy}" == unhealthy ]]; then
            printf 'unhealthy\n'
        elif (( calls == 1 )); then
            printf 'starting\n'
        else
            printf 'healthy\n'
        fi
        ;;
    'compose up -d --no-build --pull never --no-deps --force-recreate theia')
        printf 'QAAP_THEIA_IMAGE=%s\nQAAP_BUILD_SHA=%s\n' "$QAAP_THEIA_IMAGE" "$QAAP_BUILD_SHA" >> "$QAAP_TEST_CALLS"
        printf 'QAAP_TENANT_DOCKER_IMAGE=%s\nTHEIA_PORT=%s\n' "$QAAP_TENANT_DOCKER_IMAGE" "$THEIA_PORT" >> "$QAAP_TEST_CALLS"
        ;;
    *)
        echo "Unexpected docker call: $*" >&2
        exit 2
        ;;
esac
MOCK

cat > "$TEST_ROOT/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl' >> "$QAAP_TEST_CALLS"
printf ' <%s>' "$@" >> "$QAAP_TEST_CALLS"
printf '\n' >> "$QAAP_TEST_CALLS"
printf '{"build":"%s"}\n' "${QAAP_TEST_AUTH_BUILD:-abc123456789}"
MOCK

cat > "$TEST_ROOT/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK

cat > "$TEST_ROOT/bin/od" <<'MOCK'
#!/usr/bin/env bash
printf ' 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 20\n'
MOCK

chmod +x "$TEST_ROOT/bin/docker" "$TEST_ROOT/bin/curl" "$TEST_ROOT/bin/sleep" "$TEST_ROOT/bin/od"
export PATH="$TEST_ROOT/bin:$PATH"
export QAAP_TEST_CALLS="$TEST_ROOT/calls" QAAP_TEST_HEALTH_CALLS="$TEST_ROOT/health-calls"
export QAAP_SAFE_RESTART_TIMEOUT_SECONDS=5 QAAP_SAFE_RESTART_POLL_SECONDS=1

fail() { echo "FAIL: $*" >&2; exit 1; }
reset_case() {
    : > "$QAAP_TEST_CALLS"
    rm -f -- "$QAAP_TEST_HEALTH_CALLS"
    unset QAAP_TEST_IMAGE QAAP_TEST_AUTH_BUILD QAAP_TEST_HEALTH || true
}

# The normal path reuses the serving GHCR digest, forces recreation without build/pull, waits
# through the Docker `starting` state, and checks the exact auth/config build.
reset_case
"$TEST_ROOT/repo/scripts/qaap-vps-safe-restart.sh" > "$TEST_ROOT/normal.out" 2>&1 \
    || fail "safe restart failed: $(cat "$TEST_ROOT/normal.out")"
grep -Fq 'docker <compose> <up> <-d> <--no-build> <--pull> <never> <--no-deps> <--force-recreate> <theia>' "$QAAP_TEST_CALLS" \
    || fail 'Compose did not use no-build/no-pull forced recreation'
grep -Fq 'QAAP_THEIA_IMAGE=ghcr.io/qaap/theia:abc123456789@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$QAAP_TEST_CALLS" \
    || fail 'deployed GHCR image was not exported'
grep -Fq 'QAAP_BUILD_SHA=abc123456789' "$QAAP_TEST_CALLS" || fail 'deployed build SHA was not exported'
grep -Fq 'QAAP_TENANT_DOCKER_IMAGE=ghcr.io/qaap/theia:abc123456789' "$QAAP_TEST_CALLS" \
    || fail 'tenant worker image override was not preserved'
grep -Fq 'THEIA_PORT=4873' "$QAAP_TEST_CALLS" || fail 'container port was not preserved'
grep -Fq 'curl <-fsS> <--max-time> <15> <http://127.0.0.1:4873/qaap/api/auth/config>' "$QAAP_TEST_CALLS" \
    || fail 'auth/config endpoint was not checked on the container port'
grep -q 'auth/config confirms build abc123456789' "$TEST_ROOT/normal.out" || fail 'successful build verification was not reported'

# A response reporting another build must fail after health becomes healthy.
reset_case
export QAAP_TEST_AUTH_BUILD=111111111111
if "$TEST_ROOT/repo/scripts/qaap-vps-safe-restart.sh" > "$TEST_ROOT/mismatch.out" 2>&1; then
    fail 'a mismatched auth/config build was accepted'
fi
grep -q 'build mismatch after restart: expected abc123456789, got 111111111111' "$TEST_ROOT/mismatch.out" \
    || fail 'mismatch failure did not explain the expected and actual build'

# Secret rotation keeps an owner-only byte-for-byte backup and changes only the target setting.
reset_case
printf 'KEEP_ME=unchanged\nQAAP_TENANT_BACKEND_MASTER_SECRET=old-secret\n' > "$TEST_ROOT/repo/.env"
chmod 600 "$TEST_ROOT/repo/.env"
"$TEST_ROOT/repo/scripts/qaap-vps-safe-restart.sh" --rotate-master-secret > "$TEST_ROOT/rotate.out" 2>&1 \
    || fail "secret rotation failed: $(cat "$TEST_ROOT/rotate.out")"
BACKUP_FILE="$(find "$TEST_ROOT/repo" -maxdepth 1 -name '.env.backup.*' -type f -print -quit)"
[[ -n "$BACKUP_FILE" ]] || fail 'secret rotation did not create a backup'
diff -u <(printf 'KEEP_ME=unchanged\nQAAP_TENANT_BACKEND_MASTER_SECRET=old-secret\n') "$BACKUP_FILE" \
    || fail 'backup did not preserve the old .env contents'
[[ "$(stat -c '%a' "$BACKUP_FILE")" == 600 ]] || fail 'backup is not owner-only'
grep -Fxq 'KEEP_ME=unchanged' "$TEST_ROOT/repo/.env" || fail 'rotation changed an unrelated .env entry'
grep -Eq '^QAAP_TENANT_BACKEND_MASTER_SECRET=[0-9a-f]{64}$' "$TEST_ROOT/repo/.env" \
    || fail 'rotation did not write a 32-byte hex secret'

# Non-GHCR or mutable image references are rejected before Compose can touch the service.
reset_case
export QAAP_TEST_IMAGE=qaap-theia:local
if "$TEST_ROOT/repo/scripts/qaap-vps-safe-restart.sh" > "$TEST_ROOT/image.out" 2>&1; then
    fail 'a local image was accepted'
fi
grep -q 'does not use an immutable GHCR image' "$TEST_ROOT/image.out" || fail 'invalid image was not rejected'
if grep -q 'compose up' "$QAAP_TEST_CALLS"; then fail 'Compose ran after the invalid image was rejected'; fi

echo 'qaap-vps-safe-restart tests passed'
