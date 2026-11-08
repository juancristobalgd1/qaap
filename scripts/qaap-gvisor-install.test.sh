#!/usr/bin/env bash
# Tests the gVisor installer against a fake root, daemon and release (no root, no Docker, no network).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-gvisor-install-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-gvisor-install-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT
BIN="$TEST_ROOT/bin"
HOME_DIR="$TEST_ROOT/home/ubuntu"
LIB="$TEST_ROOT/lib"
mkdir -p "$BIN" "$HOME_DIR" "$TEST_ROOT/release/gvisor-bin"
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "ok - $*"; }

printf '#!/bin/sh\necho "runsc version test"\n' > "$TEST_ROOT/release/runsc"
chmod +x "$TEST_ROOT/release/runsc"
echo sidecar > "$TEST_ROOT/release/gvisor-bin/sentry"
tar --zstd -cf "$TEST_ROOT/release.tar.zstd" -C "$TEST_ROOT/release" .
REAL_SHA="$(sha512sum "$TEST_ROOT/release.tar.zstd" | awk '{print $1}')"
TREE_SHA="$(cd "$TEST_ROOT/release" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha512sum | sha512sum | awk '{print $1}')"

# The real pins must agree with the runtime check in the control plane.
grep -q "RUNSC_ARGS='\[\"--platform=systrap\", \"--directfs=false\", \"--systemd-cgroup\"\]'" "$ROOT/deploy/rootless/gvisor/qaap-gvisor-install.sh" \
    && grep -q "QAAP_RUNSC_ARGS: readonly string\[\] = \['--platform=systrap', '--directfs=false', '--systemd-cgroup'\]" "$ROOT/packages/qaap-cloud-workspace/src/node/qaap-tenant-runtime.ts" \
    && pass 'installer and control plane pin the same flags' || fail 'installer and control plane disagree on the flags'

# The installer under test, pinned to the fake release.
INSTALLER="$TEST_ROOT/install.sh"
sed -e "s/^GVISOR_SHA512=.*/GVISOR_SHA512='$REAL_SHA'/" -e "s/^GVISOR_TREE_SHA512=.*/GVISOR_TREE_SHA512='$TREE_SHA'/" \
    "$ROOT/deploy/rootless/gvisor/qaap-gvisor-install.sh" > "$INSTALLER"

cat > "$BIN/id" <<'MOCK'
#!/bin/sh
[ "${FAKE_NOT_ROOT:-}" = 1 ] && { echo 1000; exit 0; }
case "$*" in "-u") echo 0 ;; "-u ubuntu") echo 1000 ;; *) exit 1 ;; esac
MOCK
cat > "$BIN/getent" <<MOCK
#!/bin/sh
echo "ubuntu:x:1000:1000::$HOME_DIR:/bin/bash"
MOCK
# chown is a no-op: the test does not run as root. uname is fixed so the suite runs on any machine.
printf '#!/bin/sh\nexit 0\n' > "$BIN/chown"
printf '#!/bin/sh\necho x86_64\n' > "$BIN/uname"
# Records which commands run as the rootless user, to prove what does not run as root.
cat > "$BIN/sudo" <<'MOCK'
#!/bin/sh
shift 2
for argument in "$@"; do
    case "$argument" in
        */runsc) echo "rootless-ran-runsc" >> "$FAKE_STATE/calls" ;;
        python3) echo "rootless-ran-python" >> "$FAKE_STATE/calls" ;;
    esac
done
exec "$@"
MOCK
cat > "$BIN/systemctl" <<'MOCK'
#!/bin/sh
echo "$*" >> "$FAKE_STATE/calls"
[ "${FAKE_RELOAD_FAILS:-}" = 1 ] && exit 1
exit 0
MOCK
cat > "$BIN/docker" <<'MOCK'
#!/bin/sh
case "$1" in
    info) python3 -c "import json,sys; c=json.load(open(sys.argv[1])); print(json.dumps(c.get('runtimes',{}).get('runsc')))" "$FAKE_DAEMON_JSON" ;;
    ps) cat "$FAKE_STATE/containers" 2>/dev/null ;;
    inspect) echo runsc ;;
    image) [ "${FAKE_NO_IMAGE:-}" != 1 ] ;;
    run)
        parent="$QAAP_GVISOR_CGROUP_ROOT/user.slice/user-1000.slice/user@1000.service/qaap.slice"
        scope="$parent/qaap-smoke.slice/docker-smoke1.scope"
        mkdir -p "$scope"
        echo "${FAKE_ALL_TASKS_MAX:-50000}" > "$parent/pids.max"
        echo "${FAKE_TENANT_TASKS_MAX:-8192}" > "$parent/qaap-smoke.slice/pids.max"
        echo "${FAKE_MEMORY_MAX:-268435456}" > "$scope/memory.max"
        echo 128 > "$scope/pids.max"
        echo '50000 100000' > "$scope/cpu.max"
        echo "$*" >> "$FAKE_STATE/runs"
        echo smoke1
        ;;
    rm) echo "rm $*" >> "$FAKE_STATE/calls" ;;
esac
MOCK
chmod +x "$BIN"/*
export PATH="$BIN:$PATH" FAKE_STATE="$TEST_ROOT" FAKE_DAEMON_JSON="$HOME_DIR/.config/docker/daemon.json"
export QAAP_GVISOR_LIB_ROOT="$LIB" QAAP_GVISOR_TARBALL="$TEST_ROOT/release.tar.zstd" QAAP_GVISOR_CGROUP_ROOT="$TEST_ROOT/cgroup"
# The permissions check needs "owned by root", which a test without root cannot produce; it is exercised through -perm.
DIR="$LIB/qaap-20261102.0-1"
run() { bash "$INSTALLER" "$@"; }
check_perms_only() { find "$LIB" -perm /022 ! -type l | head -1; }

if FAKE_NOT_ROOT=1 run install >/dev/null 2>&1; then fail 'runs without root'; else pass 'refuses to run without root'; fi

mkdir -p "$(dirname "$FAKE_DAEMON_JSON")"
echo '{"log-level": "warn", "runtimes": {"other": {"path": "/x"}}}' > "$FAKE_DAEMON_JSON"
run install >/dev/null || fail 'install failed'
if [ -x "$DIR/runsc" ] && [ -f "$DIR/gvisor-bin/sentry" ]; then pass 'installs the release'; else fail 'files missing'; fi
if [ -z "$(find "$LIB" -maxdepth 1 -name '.*' ! -name "$(basename "$LIB")")" ]; then pass 'leaves no staging directory'; else fail 'staging directory left behind'; fi
if grep -q -- '--user reload docker' "$TEST_ROOT/calls"; then pass 'reloads the daemon'; else fail 'no reload'; fi
if grep -q restart "$TEST_ROOT/calls"; then fail 'restarted the daemon'; else pass 'never restarts the daemon'; fi
if grep -q rootless-ran-runsc "$TEST_ROOT/calls"; then pass 'first runs the new binary as the rootless user'; else fail 'ran the new binary as root'; fi
if grep -q rootless-ran-python "$TEST_ROOT/calls"; then pass 'edits daemon.json as the rootless user'; else fail 'edited daemon.json as root'; fi
if grep -q 'TasksMax=8192' "$HOME_DIR/.config/systemd/user/qaap-.slice.d/50-qaap-gvisor.conf" && grep -q 'TasksMax=50000' "$HOME_DIR/.config/systemd/user/qaap.slice.d/50-qaap-gvisor.conf"; then pass 'sets task limits per tenant and overall'; else fail 'slice limits missing'; fi
if grep -q -- '--user daemon-reload' "$TEST_ROOT/calls"; then pass 'reloads the user manager for the slice limits'; else fail 'no daemon-reload'; fi
if grep -q -- '--pull never' "$TEST_ROOT/runs" && grep -q -- '--runtime runsc' "$TEST_ROOT/runs"; then pass 'the limits check starts a real sandbox from a local image'; else fail 'limits check not run as expected'; fi
if grep -q 'rm .*smoke1' "$TEST_ROOT/calls"; then pass 'removes the limits-check container'; else fail 'limits-check container left behind'; fi
if python3 - "$FAKE_DAEMON_JSON" "$DIR/runsc" <<'PYTHON'
import json, sys
config = json.load(open(sys.argv[1]))
assert config['log-level'] == 'warn' and config['runtimes']['other'] == {'path': '/x'}
assert config['runtimes']['runsc'] == {'path': sys.argv[2], 'runtimeArgs': ['--platform=systrap', '--directfs=false', '--systemd-cgroup']}
PYTHON
then pass 'adds the runtime and keeps other settings'; else fail 'daemon.json is wrong'; fi

chmod -R go-w "$LIB"
# Test files are not owned by root, so run the permission rule on its -perm half and the rest of check through a stub.
sed -i.bak 's/! -user root 2>\/dev\/null/-false 2>\/dev\/null/' "$INSTALLER"
if run check >/dev/null 2>&1; then pass 'check accepts an intact install'; else fail 'check refuses an intact install'; fi
echo tampered >> "$DIR/gvisor-bin/sentry"
if run check >/dev/null 2>&1; then fail 'check accepts changed files'; else pass 'check detects changed files'; fi
run install >/dev/null || fail 'reinstall failed'
if [ "$(cat "$DIR/gvisor-bin/sentry")" = sidecar ]; then pass 'install repairs changed files'; else fail 'changed files stayed'; fi
chmod -R go-w "$LIB"
echo extra > "$DIR/gvisor-bin/extra"
if run check >/dev/null 2>&1; then fail 'check accepts an added file'; else pass 'check detects an added file'; fi
rm -f "$DIR/gvisor-bin/extra"
chmod g+w "$DIR/gvisor-bin"
if run check >/dev/null 2>&1; then fail 'check accepts a writable nested directory'; else pass 'check detects a writable nested directory'; fi
chmod g-w "$DIR/gvisor-bin"
if [ -z "$(check_perms_only)" ]; then pass 'permissions restored'; else fail 'permissions left writable'; fi

if FAKE_MEMORY_MAX=max run check >/dev/null 2>&1; then fail 'check accepts a limit that was not applied'; else pass 'check detects a limit that was not applied'; fi
if FAKE_TENANT_TASKS_MAX=max run check >/dev/null 2>&1; then fail 'check accepts an unlimited tenant slice'; else pass 'check detects an unlimited tenant slice'; fi
if FAKE_ALL_TASKS_MAX=max run check >/dev/null 2>&1; then fail 'check accepts an unlimited qaap.slice'; else pass 'check detects an unlimited qaap.slice'; fi
if FAKE_NO_IMAGE=1 run check >/dev/null 2>&1; then fail 'check passes without the limits test'; else pass 'check fails when it cannot run the limits test'; fi

python3 -c "import json,sys; p=sys.argv[1]; c=json.load(open(p)); c['runtimes']['runsc']['runtimeArgs'].append('--ignore-cgroups'); json.dump(c,open(p,'w'))" "$FAKE_DAEMON_JSON"
if run check >/dev/null 2>&1; then fail 'check accepts an extra runtime flag'; else pass 'check detects an extra runtime flag'; fi
run install >/dev/null || fail 'install after flag change failed'
chmod -R go-w "$LIB"

cp "$TEST_ROOT/release.tar.zstd" "$TEST_ROOT/bad.tar.zstd"
echo x >> "$TEST_ROOT/bad.tar.zstd"
rm -rf -- "$DIR"
if QAAP_GVISOR_TARBALL="$TEST_ROOT/bad.tar.zstd" run install >/dev/null 2>&1; then fail 'installs a tarball with the wrong hash'; else pass 'refuses a tarball with the wrong hash'; fi
if [ ! -e "$DIR" ]; then pass 'leaves nothing behind on a bad hash'; else fail 'partial install'; fi
run install >/dev/null || fail 'install after bad hash failed'

echo qaap-backend-alice > "$TEST_ROOT/containers"
if run remove >/dev/null 2>&1; then fail 'removes a runtime in use'; else pass 'refuses to remove a runtime in use'; fi
: > "$TEST_ROOT/containers"
run remove >/dev/null || fail 'remove failed'
if python3 -c "import json,sys; c=json.load(open(sys.argv[1])); assert 'runsc' not in c['runtimes'] and c['log-level']=='warn'" "$FAKE_DAEMON_JSON"; then
    pass 'remove keeps other settings'
    if [ -e "$HOME_DIR/.config/systemd/user/qaap-.slice.d/50-qaap-gvisor.conf" ]; then fail 'remove left the slice limits'; else pass 'remove takes out the slice limits'; fi
else
    fail 'remove broke daemon.json'
fi

if FAKE_RELOAD_FAILS=1 run install >/dev/null 2>&1; then fail 'ignores a failed reload'; else pass 'fails when the reload fails'; fi

[ "$failures" -eq 0 ] || { echo "$failures failure(s)" >&2; exit 1; }
echo 'all gVisor installer tests passed'
