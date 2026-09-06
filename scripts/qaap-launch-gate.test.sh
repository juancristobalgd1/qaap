#!/usr/bin/env bash
# Regression checks for release gate decisions; no Docker daemon or real tenant data.
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-launch-gate.XXXXXXXX)"
cleanup() {
    case "$TEST_ROOT" in */qaap-launch-gate.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac
}
trap cleanup EXIT
mkdir -p "$TEST_ROOT/scripts" "$TEST_ROOT/bin" "$TEST_ROOT/backups"
sed 's/\r$//' "$SOURCE/qaap-vps-launch-gate.sh" > "$TEST_ROOT/scripts/qaap-vps-launch-gate.sh"
sed 's/\r$//' "$SOURCE/qaap-verify-launch-readiness.sh" > "$TEST_ROOT/scripts/qaap-verify-launch-readiness.sh"
cp "$SOURCE/qaap-release-config-check.js" "$TEST_ROOT/scripts/qaap-release-config-check.js"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_ROOT/scripts/qaap-vps-ensure-backup-cron.sh"
printf '#!/usr/bin/env bash\nexit "${TEST_ISOLATION_EXIT:-0}"\n' > "$TEST_ROOT/scripts/qaap-verify-multitenant.sh"
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
    *' sh -c id') echo 'uid=0(root)' ;;
    *QAAP_AGENT_UID_PER_USER*) printf 1 ;;
    *Object.keys*length*) printf '%s' "${TEST_TENANTS:-2}" ;;
    *Object.keys*join*) printf 'alice bob' ;;
esac
exit 0
MOCK
cat > "$TEST_ROOT/bin/curl" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
    */legal/*) echo '<h1>Legal</h1>' ;;
    *) printf '%s' "${TEST_AUTH_CONFIG}" ;;
esac
MOCK
chmod +x "$TEST_ROOT/scripts/"*.sh "$TEST_ROOT/bin/"*
touch "$TEST_ROOT/backups/qaap-test.tar.gz" "$TEST_ROOT/offsite.env"
export PATH="$TEST_ROOT/bin:$PATH"
export QAAP_BACKUP_DIR="$TEST_ROOT/backups" QAAP_BACKUP_OFFSITE_ENV="$TEST_ROOT/offsite.env"
export QAAP_ENV_FILE="$TEST_ROOT/missing.env" QAAP_BASE_URL=http://test.invalid
expect_status() {
    local expected="$1" script="$2" actual=0
    bash "$TEST_ROOT/scripts/$script" > "$TEST_ROOT/output" 2>&1 || actual=$?
    if [[ "$actual" != "$expected" ]]; then
        cat "$TEST_ROOT/output"
        echo "Expected exit $expected; got $actual" >&2
        exit 1
    fi
}
export TEST_TENANTS=1
expect_status 1 qaap-vps-launch-gate.sh
export TEST_TENANTS=2 TEST_ISOLATION_EXIT=1
expect_status 1 qaap-vps-launch-gate.sh
export TEST_ISOLATION_EXIT=0
expect_status 0 qaap-vps-launch-gate.sh
export TEST_AUTH_CONFIG='{"ok":true,"ready":true,"skipAuth":false,"oauthConfigured":true,"githubOAuth":true,"productionRuntime":true,"agentUidPerUser":true,"build":"abcdef123456","betaAccessRequired":true,"betaAccessConfigured":false}'
expect_status 1 qaap-verify-launch-readiness.sh
export TEST_AUTH_CONFIG='{"ok":true,"ready":true,"skipAuth":false,"oauthConfigured":true,"githubOAuth":true,"productionRuntime":true,"agentUidPerUser":true,"build":"abcdef123456","betaAccessRequired":true,"betaAccessConfigured":true}'
expect_status 0 qaap-verify-launch-readiness.sh
echo 'PASS: missing tenants, failed isolation, successful isolation, missing invitations, configured invitations'
