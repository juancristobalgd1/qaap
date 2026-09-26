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
cp "$SOURCE/qaap-tenant-backend-isolation-check.js" "$TEST_ROOT/scripts/qaap-tenant-backend-isolation-check.js"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_ROOT/scripts/qaap-vps-ensure-backup-cron.sh"
printf '#!/usr/bin/env bash\nexit "${TEST_ISOLATION_EXIT:-0}"\n' > "$TEST_ROOT/scripts/qaap-verify-multitenant.sh"
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
# The per-tenant isolation check really runs (node -e <source> A B) against fixture inspect JSON.
if [[ "$1 $2 $3 $5 $6" == 'compose exec -T node -e' ]]; then
    shift 6
    exec node -e "$@"
fi
case "$*" in
    *'docker ps -a'*tenant-backend*) printf '%b' "${TEST_TENANT_BACKENDS-alice qaap-backend-aaaaaaaaaaaa
bob qaap-backend-bbbbbbbbbbbb
}" ;;
    *'docker inspect'*) cat "$TEST_INSPECT_FILE" ;;
    *'docker info'*SecurityOptions*) printf '%s' "${TEST_DAEMON_SECURITY-[\"name=seccomp,profile=builtin\",\"name=rootless\"]}" ;;
    *' sh -c id') echo 'uid=1000(theia)' ;;
    *'command -v'* )
        if [[ "${TEST_HARNESSES:-1}" == 1 ]]; then exit 0; else printf 'missing-harness\n'; exit 1; fi ;;
    *QAAP_TENANT_CONTAINER_ISOLATION*) printf 1 ;;
    *DOCKER_HOST*) printf 'unix:///run/user/1000/docker.sock' ;;
    *QAAP_AGENT_UID_PER_USER*) printf 1 ;;
    *QAAP_BETA_ALLOWED_LOGINS*) printf '%s' "${TEST_BETA_ALLOWED_LOGINS:-}" ;;
    *QAAP_BACKEND_PER_TENANT*) printf '%s' "${TEST_BACKEND_PER_TENANT:-}" ;;
    *QAAP_TENANT_BACKEND_MASTER_SECRET*) printf '%s' "${TEST_BACKEND_SECRET_LEN:-0}" ;;
    *QAAP_PREVIEW_BASE_DOMAIN*) printf '%s' "${TEST_PREVIEW_BASE_DOMAIN:-}" ;;
    *QAAP_OPERATOR_LOGINS*) printf '%s' "${TEST_OPERATOR_LOGINS:-}" ;;
    *qaap-backend-isolation.js*) printf '%s' "${TEST_BACKEND_ISOLATION_MODE:-per-tenant}" ;;
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
write_inspect() { # $1=variant
    TEST_INSPECT_FILE="$TEST_ROOT/inspect-$1.json" node - "$1" <<'NODE'
const variant = process.argv[2];
const backend = (login, hash) => ({
    Name: `/qaap-backend-${hash}`,
    Config: {
        User: '1000:1000',
        Env: ['QAAP_TENANT_BACKEND_MODE=1', `QAAP_TENANT_BACKEND_SECRET=secret-${login}`, `QAAP_TENANT_LOGIN=${login}`],
        Labels: { 'com.qaap.managed': 'true', 'com.qaap.tenant-backend': 'true', 'com.qaap.tenant-login': login },
    },
    HostConfig: {
        CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], ReadonlyRootfs: true, Privileged: false,
        NetworkMode: `qaap-tenant-net-${hash}`,
    },
    Mounts: [
        { Source: `/srv/repos/users/${login}`, Destination: `/workspace/repos/users/${login}`, RW: true },
        { Source: `/srv/worktrees/${login}`, Destination: `/tmp/qaap-worktrees/${login}`, RW: true },
        { Source: `/srv/parallel/${login}`, Destination: `/tmp/qaap-parallel/${login}`, RW: true },
        { Source: `/srv/tenants/${login}`, Destination: '/home/theia/.qaap', RW: true },
        { Source: `/srv/tenants/${login}/theia-home`, Destination: '/home/theia/.theia', RW: true },
    ],
});
const [a, b] = [backend('alice', 'aaaaaaaaaaaa'), backend('bob', 'bbbbbbbbbbbb')];
if (variant === 'root') { b.Config.User = '0:0'; }
if (variant === 'privileged') { b.HostConfig.Privileged = true; }
if (variant === 'shared') { b.Mounts[0].Source = '/srv/repos/users/alice'; }
if (variant === 'secret') { a.Config.Env.push('QAAP_TENANT_BACKEND_MASTER_SECRET=x'); }
if (variant === 'socket') { a.Mounts[4] = { Source: '/run/user/1000/docker.sock', Destination: '/home/theia/.theia', RW: true }; }
require('fs').writeFileSync(process.env.TEST_INSPECT_FILE, JSON.stringify([a, b]));
NODE
    export TEST_INSPECT_FILE="$TEST_ROOT/inspect-$1.json"
}
write_inspect good
export TEST_TENANTS=1
expect_status 1 qaap-vps-launch-gate.sh
export TEST_TENANTS=2 TEST_ISOLATION_EXIT=1
expect_status 1 qaap-vps-launch-gate.sh
export TEST_ISOLATION_EXIT=0
expect_status 0 qaap-vps-launch-gate.sh
export TEST_HARNESSES=0
expect_status 1 qaap-vps-launch-gate.sh
export TEST_HARNESSES=1
export TEST_BETA_ALLOWED_LOGINS=alice TEST_BACKEND_ISOLATION_MODE=shared-control-plane
expect_status 1 qaap-vps-launch-gate.sh
export TEST_BACKEND_ISOLATION_MODE=per-tenant TEST_BACKEND_PER_TENANT=1 TEST_BACKEND_SECRET_LEN=32
expect_status 1 qaap-vps-launch-gate.sh
export TEST_OPERATOR_LOGINS=Alice
expect_status 0 qaap-vps-launch-gate.sh
unset TEST_OPERATOR_LOGINS
export TEST_PREVIEW_BASE_DOMAIN=qaap-previews.example
expect_status 0 qaap-vps-launch-gate.sh
export TEST_BACKEND_SECRET_LEN=31
expect_status 1 qaap-vps-launch-gate.sh

# Backend-per-tenant mode: evidence is Qaap-managed tenant backend containers, not the host-mode
# uid registry (which stays empty there). Fewer than two tenants and any isolation break still fail.
export TEST_TENANTS=0 TEST_BACKEND_PER_TENANT=1 TEST_BACKEND_SECRET_LEN=32
expect_status 0 qaap-vps-launch-gate.sh
grep -q 'tenant backend containers: 2 (alice bob)' "$TEST_ROOT/output" || { cat "$TEST_ROOT/output"; echo 'expected backend evidence' >&2; exit 1; }
grep -q 'uid registry' "$TEST_ROOT/output" && { cat "$TEST_ROOT/output"; echo 'per-tenant mode must not read the uid registry' >&2; exit 1; }
export TEST_TENANT_BACKENDS='alice qaap-backend-aaaaaaaaaaaa
'
expect_status 1 qaap-vps-launch-gate.sh
# Two containers of the same tenant, anonymous or malformed rows are not two tenants.
export TEST_TENANT_BACKENDS='alice qaap-backend-aaaaaaaaaaaa
alice qaap-backend-cccccccccccc
__anonymous__ qaap-backend-dddddddddddd
bob not-a-backend
'
expect_status 1 qaap-vps-launch-gate.sh
export TEST_TENANT_BACKENDS=''
expect_status 1 qaap-vps-launch-gate.sh
unset TEST_TENANT_BACKENDS
# Container uid 0 is accepted only when the daemon reports rootless (it maps to the daemon owner).
write_inspect root
expect_status 0 qaap-vps-launch-gate.sh
export TEST_DAEMON_SECURITY='["name=seccomp,profile=builtin"]'
expect_status 1 qaap-vps-launch-gate.sh
unset TEST_DAEMON_SECURITY
for variant in shared secret socket privileged; do
    write_inspect "$variant"
    expect_status 1 qaap-vps-launch-gate.sh
done
unset TEST_TENANTS TEST_INSPECT_FILE
unset TEST_BETA_ALLOWED_LOGINS TEST_BACKEND_ISOLATION_MODE TEST_BACKEND_PER_TENANT TEST_BACKEND_SECRET_LEN TEST_PREVIEW_BASE_DOMAIN
export TEST_AUTH_CONFIG='{"ok":true,"ready":true,"skipAuth":false,"oauthConfigured":true,"githubOAuth":true,"productionRuntime":true,"agentUidPerUser":true,"backendIsolationReady":true,"backendIsolationMode":"per-tenant","build":"abcdef123456","betaAccessRequired":true,"betaAccessConfigured":false}'
expect_status 1 qaap-verify-launch-readiness.sh
export TEST_AUTH_CONFIG='{"ok":true,"ready":true,"skipAuth":false,"oauthConfigured":true,"githubOAuth":true,"productionRuntime":true,"agentUidPerUser":true,"backendIsolationReady":true,"backendIsolationMode":"per-tenant","build":"abcdef123456","betaAccessRequired":true,"betaAccessConfigured":true}'
expect_status 0 qaap-verify-launch-readiness.sh
echo 'PASS: missing tenants, failed isolation, per-tenant backend evidence/isolation, successful isolation, missing preview domain, operator-only allowlist, missing invitations, configured invitations'
