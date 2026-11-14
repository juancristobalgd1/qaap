#!/usr/bin/env bash
# Test the CI apt installer: retries, backoff, the azure to archive mirror fallback, and the
# native-deps wrapper. Uses a fake apt-get and sleep, so no network or root is needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$ROOT/scripts/qaap-ci-apt-install.sh"
NATIVE="$ROOT/scripts/qaap-ci-install-native-deps.sh"
TEST_ROOT="$(mktemp -d -t qaap-ci-apt-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-ci-apt-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "ok - $*"; }

FAKE_BIN="$TEST_ROOT/bin"
APT_LOG="$TEST_ROOT/apt.log"
SLEEP_LOG="$TEST_ROOT/sleep.log"
APT_ROOT="$TEST_ROOT/apt"
mkdir -p "$FAKE_BIN" "$APT_ROOT/sources.list.d"

# apt-get fails its `update` while the counter is <= FAKE_APT_FAIL_UPDATES.
cat > "$FAKE_BIN/apt-get" <<'EOF'
#!/usr/bin/env bash
echo "apt-get $*" >> "$APT_LOG"
for arg in "$@"; do
    if [[ "$arg" == update ]]; then
        count=$(( $(cat "$APT_COUNTER" 2>/dev/null || echo 0) + 1 ))
        echo "$count" > "$APT_COUNTER"
        if (( count <= ${FAKE_APT_FAIL_UPDATES:-0} )); then
            echo 'Temporary failure resolving azure.archive.ubuntu.com' >&2
            exit 100
        fi
        exit 0
    fi
done
exit 0
EOF
cat > "$FAKE_BIN/fake-sleep" <<'EOF'
#!/usr/bin/env bash
echo "$1" >> "$SLEEP_LOG"
EOF
chmod +x "$FAKE_BIN/apt-get" "$FAKE_BIN/fake-sleep"

AZURE_SOURCE='Types: deb
URIs: http://azure.archive.ubuntu.com/ubuntu/
Suites: noble noble-updates
Components: main universe

Types: deb
URIs: http://security.ubuntu.com/ubuntu/
Suites: noble-security
Components: main'

# run_install <fail-updates> <sources-content|-> : runs the installer with the fakes.
run_install() {
    local fail_updates="$1" sources="$2"
    rm -rf "$APT_ROOT" && mkdir -p "$APT_ROOT/sources.list.d"
    if [[ "$sources" != "-" ]]; then
        printf '%s\n' "$sources" > "$APT_ROOT/sources.list.d/ubuntu.sources"
    fi
    rm -f "$APT_LOG" "$SLEEP_LOG" "$TEST_ROOT/counter"
    set +e
    PATH="$FAKE_BIN:$PATH" APT_LOG="$APT_LOG" APT_COUNTER="$TEST_ROOT/counter" SLEEP_LOG="$SLEEP_LOG" \
        FAKE_APT_FAIL_UPDATES="$fail_updates" QAAP_APT_ROOT="$APT_ROOT" QAAP_APT_SUDO='' \
        QAAP_APT_SLEEP="$FAKE_BIN/fake-sleep" bash "$INSTALL" libx11-dev libxkbfile-dev >"$TEST_ROOT/out" 2>&1
    status=$?
    set -e
}

run_install 0 "$AZURE_SOURCE"
if [[ $status -eq 0 ]] && [[ $(wc -l < "$APT_LOG") -eq 2 ]] && [[ ! -s "$SLEEP_LOG" ]]; then
    pass 'first attempt succeeds without retry or backoff'
else
    fail "first attempt: status=$status log=$(cat "$APT_LOG" 2>/dev/null) sleeps=$(cat "$SLEEP_LOG" 2>/dev/null)"
fi
if grep -q 'azure' "$APT_ROOT/sources.list.d/ubuntu.sources"; then pass 'successful run keeps the azure mirror'; else fail 'successful run rewrote the mirror'; fi

run_install 2 "$AZURE_SOURCE"
if [[ $status -eq 0 ]]; then pass 'succeeds on the third attempt after two failed updates'; else fail "third attempt: status=$status out=$(cat "$TEST_ROOT/out")"; fi
if [[ "$(cat "$SLEEP_LOG" | tr '\n' ' ')" == '15 30 ' ]]; then pass 'backs off 15s then 30s'; else fail "backoff: $(cat "$SLEEP_LOG" | tr '\n' ' ')"; fi
if grep -q 'archive.ubuntu.com/ubuntu/' "$APT_ROOT/sources.list.d/ubuntu.sources" && ! grep -q 'azure' "$APT_ROOT/sources.list.d/ubuntu.sources"; then
    pass 'azure mirror rewritten to archive.ubuntu.com before the last attempt'
else
    fail "mirror not rewritten: $(cat "$APT_ROOT/sources.list.d/ubuntu.sources")"
fi
if grep -q 'security.ubuntu.com' "$APT_ROOT/sources.list.d/ubuntu.sources"; then pass 'security source left untouched'; else fail 'security source changed'; fi
if [[ -f "$APT_ROOT/sources.list.d/ubuntu.sources.qaap-azure.bak" ]] && grep -q 'azure' "$APT_ROOT/sources.list.d/ubuntu.sources.qaap-azure.bak"; then
    pass 'original sources kept as a backup'
else
    fail 'no backup of the original sources'
fi
if [[ $(grep -c '^apt-get' "$APT_LOG") -eq 4 ]]; then pass 'a failed update stops its attempt; the successful one runs update then install'; else fail "apt calls: $(cat "$APT_LOG")"; fi

run_install 99 "$AZURE_SOURCE"
if [[ $status -eq 1 ]] && [[ $(grep -c 'update' "$APT_LOG") -eq 3 ]] && grep -q 'after 3 attempts' "$TEST_ROOT/out"; then
    pass 'gives up after three attempts with a non-zero exit'
else
    fail "exhausted: status=$status out=$(cat "$TEST_ROOT/out")"
fi
if grep -q 'archive.ubuntu.com/ubuntu/' "$APT_ROOT/sources.list.d/ubuntu.sources"; then pass 'fallback applied even when every attempt fails'; else fail 'fallback not applied on exhaustion'; fi

PLAIN_SOURCE='URIs: http://archive.ubuntu.com/ubuntu/
Suites: noble'
run_install 2 "$PLAIN_SOURCE"
if [[ $status -eq 0 ]] && ! [[ -f "$APT_ROOT/sources.list.d/ubuntu.sources.qaap-azure.bak" ]]; then
    pass 'sources without azure are not rewritten'
else
    fail "plain sources: status=$status"
fi

set +e
bash "$INSTALL" >/dev/null 2>&1
no_args=$?
set -e
if [[ $no_args -eq 2 ]]; then pass 'no packages is a usage error'; else fail "no args exit $no_args"; fi

if grep -qF 'qaap-ci-apt-install.sh" libx11-dev libxkbfile-dev' "$NATIVE"; then
    pass 'native deps wrapper delegates to the shared installer'
else
    fail 'native deps wrapper does not delegate'
fi

if (( failures > 0 )); then
    echo "$failures failure(s)" >&2
    exit 1
fi
echo 'all qaap-ci-apt-install checks passed'
