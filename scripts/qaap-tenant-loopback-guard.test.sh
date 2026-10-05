#!/usr/bin/env bash
# Test the rootless tenant host-loopback guard and its installation by the VPS deploy, against a
# fake iptables/ip6tables/systemctl (no root, no kernel firewall needed).
# Fails if the deploy stops installing the guard or the allow-list widens.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d -t qaap-loopback-guard-test.XXXXXXXX)"
cleanup() { case "$TEST_ROOT" in */qaap-loopback-guard-test.*) rm -rf -- "$TEST_ROOT" ;; *) exit 2 ;; esac; }
trap cleanup EXIT
BIN="$TEST_ROOT/bin"
mkdir -p "$BIN"
GUARD="$TEST_ROOT/qaap-tenant-loopback-guard.sh"
sed 's/\r$//' "$ROOT/deploy/rootless/qaap-tenant-loopback-guard.sh" > "$GUARD"
UPDATE="$ROOT/scripts/qaap-vps-update.sh"
DEPLOY_WORKFLOW="$ROOT/.github/workflows/qaap-vps-deploy.yml"
SERVICE="$ROOT/deploy/rootless/qaap-tenant-loopback-guard.service"
TIMER="$ROOT/deploy/rootless/qaap-tenant-loopback-guard.timer"

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "ok - $*"; }

# Fake iptables: one file per chain under $FAKE_STATE/<family>/, holding rule specs verbatim.
cat > "$BIN/fake-iptables" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
family="${0##*/}"; family="${family%-restore}"
dir="$FAKE_STATE/$family"
mkdir -p "$dir"
echo "$family ${0##*/} $*" >> "$FAKE_STATE/calls"
[[ "${1:-}" == -w ]] && shift
if [[ "$0" == *-restore ]]; then
    [[ "$1" == --noflush ]] || exit 2
    declare -A pending=()
    while IFS= read -r line; do
        case "$line" in
            '*filter') ;;
            :*) chain="${line#:}"; chain="${chain%% *}"; pending[$chain]='' ;;
            '-A '*) rest="${line#-A }"; chain="${rest%% *}"; pending[$chain]+="${rest#* }"$'\n' ;;
            COMMIT) for chain in "${!pending[@]}"; do printf '%s' "${pending[$chain]}" > "$dir/$chain"; done ;;
            *) exit 2 ;;
        esac
    done
    exit 0
fi
op="$1"; chain="$2"; shift 2
file="$dir/$chain"
[[ "$chain" != OUTPUT || -e "$file" ]] || : > "$file"
case "$op" in
    -N) [[ ! -e "$file" ]] || exit 1; : > "$file" ;;
    -S)
        [[ -e "$file" ]] || exit 1
        if [[ $# -gt 0 ]]; then
            line="$(sed -n "${1}p" "$file")"
            [[ -n "$line" ]] || exit 1
            echo "-A $chain $line"
            exit 0
        fi
        if [[ "$chain" == OUTPUT ]]; then echo '-P OUTPUT ACCEPT'; else echo "-N $chain"; fi
        while IFS= read -r line; do echo "-A $chain $line"; done < "$file"
        ;;
    -C) [[ -e "$file" ]] && grep -Fxq -- "$*" "$file" ;;
    -I)
        [[ -e "$file" ]] || exit 1
        position="$1"; shift
        { head -n $((position - 1)) "$file"; echo "$*"; tail -n +"$position" "$file"; } > "$file.new"
        mv "$file.new" "$file"
        ;;
    -D)
        [[ -e "$file" ]] || exit 1
        if [[ $# -eq 1 && "$1" =~ ^[0-9]+$ ]]; then
            sed -i "${1}d" "$file"
        else
            line="$(grep -Fxn -- "$*" "$file" | head -n 1 | cut -d: -f1)"
            [[ -n "$line" ]] || exit 1
            sed -i "${line}d" "$file"
        fi
        ;;
    -F) [[ -e "$file" ]] || exit 1; : > "$file" ;;
    -X) [[ -e "$file" && ! -s "$file" ]] || exit 1; rm "$file" ;;
    *) exit 2 ;;
esac
MOCK
chmod +x "$BIN/fake-iptables"
for name in iptables iptables-restore ip6tables ip6tables-restore; do
    ln -s fake-iptables "$BIN/$name"
done

reset_state() {
    export FAKE_STATE="$TEST_ROOT/state-$1"
    rm -rf "$FAKE_STATE"
    mkdir -p "$FAKE_STATE/iptables" "$FAKE_STATE/ip6tables"
    # Host as found on the VPS: the hand-installed qaap-tenant-host-guard rule and ufw's loopback accept.
    printf '%s\n' '-d 127.0.0.1/32 -o lo -p tcp -m tcp --dport 4873 -m owner --uid-owner 1000 -j REJECT --reject-with icmp-port-unreachable' \
        '-j ufw-before-output' > "$FAKE_STATE/iptables/OUTPUT"
    printf '%s\n' '-j ufw6-before-output' > "$FAKE_STATE/ip6tables/OUTPUT"
}
guard() { QAAP_IPTABLES="$BIN/iptables" QAAP_IP6TABLES="$BIN/ip6tables" bash "$GUARD" "$@"; }
chain_of() { cat "$FAKE_STATE/$1/QAAP_TENANT_LOOPBACK"; }
output_of() { cat "$FAKE_STATE/$1/OUTPUT"; }

EXPECTED_V4='-m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
-d 127.0.0.1/32 -p tcp -m tcp --dport 14873 -j RETURN
-p udp -m udp --dport 53 -j RETURN
-p tcp -m tcp --dport 53 -j RETURN
-p tcp -j REJECT --reject-with tcp-reset
-j REJECT --reject-with icmp-port-unreachable'
EXPECTED_V6='-m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
-p udp -m udp --dport 53 -j RETURN
-p tcp -m tcp --dport 53 -j RETURN
-p tcp -j REJECT --reject-with tcp-reset
-j REJECT --reject-with icmp6-port-unreachable'
JUMP_V4='-d 127.0.0.0/8 -o lo -m owner --uid-owner 1000 -j QAAP_TENANT_LOOPBACK'
JUMP_V6='-d ::1/128 -o lo -m owner --uid-owner 1000 -j QAAP_TENANT_LOOPBACK'

# --- apply: allow-list, first OUTPUT rule, existing rules preserved ---
reset_state apply
if guard apply > "$TEST_ROOT/apply.log" 2>&1; then
    [[ "$(chain_of iptables)" == "$EXPECTED_V4" ]] && pass 'IPv4 chain is exactly the allow-list' \
        || fail "IPv4 chain differs:"$'\n'"$(chain_of iptables)"
    [[ "$(chain_of ip6tables)" == "$EXPECTED_V6" ]] && pass 'IPv6 chain allows no loopback TCP service' \
        || fail "IPv6 chain differs:"$'\n'"$(chain_of ip6tables)"
    [[ "$(sed -n 1p "$FAKE_STATE/iptables/OUTPUT")" == "$JUMP_V4" ]] && pass 'IPv4 jump is the first OUTPUT rule' \
        || fail 'IPv4 jump is not first'
    [[ "$(sed -n 1p "$FAKE_STATE/ip6tables/OUTPUT")" == "$JUMP_V6" ]] && pass 'IPv6 jump is the first OUTPUT rule' \
        || fail 'IPv6 jump is not first'
    grep -q -- '--dport 4873 -m owner --uid-owner 1000 -j REJECT' "$FAKE_STATE/iptables/OUTPUT" \
        && grep -Fxq -- '-j ufw-before-output' "$FAKE_STATE/iptables/OUTPUT" \
        && pass 'existing qaap-tenant-host-guard and ufw rules are kept' || fail 'apply removed foreign OUTPUT rules'
    grep -Fq -- '--dport 4873 -j RETURN' "$FAKE_STATE/iptables/QAAP_TENANT_LOOPBACK" \
        && fail 'control plane port 4873 is allowed' || pass 'control plane port 4873 is not allowed'
else
    fail "apply failed: $(cat "$TEST_ROOT/apply.log")"
fi

# --- idempotent: a second apply changes nothing and never re-inserts the jump ---
before="$(output_of iptables)"
: > "$FAKE_STATE/calls"
guard apply > /dev/null
[[ "$(output_of iptables)" == "$before" && "$(chain_of iptables)" == "$EXPECTED_V4" ]] \
    && ! grep -q -- ' -I OUTPUT' "$FAKE_STATE/calls" \
    && pass 'second apply is a no-op' || fail 'second apply changed OUTPUT or re-inserted the jump'

# --- self-healing: a firewall reload put ufw first and duplicated the jump ---
printf '%s\n' '-j ufw-before-output' "$JUMP_V4" '-A dummy' "$JUMP_V4" > "$FAKE_STATE/iptables/OUTPUT"
sed -i '/^-A dummy$/d' "$FAKE_STATE/iptables/OUTPUT"
guard check > /dev/null 2>&1 && fail 'check accepted a jump behind ufw' || pass 'check rejects a jump behind ufw'
guard apply > /dev/null
[[ "$(output_of iptables)" == "$JUMP_V4"$'\n''-j ufw-before-output' ]] \
    && pass 'apply moves a single jump back to the top' || fail "apply did not repair OUTPUT:"$'\n'"$(output_of iptables)"

# --- check detects a tampered chain ---
guard check > /dev/null && pass 'check passes on an applied guard' || fail 'check failed on an applied guard'
sed -i '$d' "$FAKE_STATE/iptables/QAAP_TENANT_LOOPBACK"
guard check > /dev/null 2>&1 && fail 'check accepted a chain without the final REJECT' || pass 'check rejects a chain missing a rule'
echo '-j RETURN' >> "$FAKE_STATE/iptables/QAAP_TENANT_LOOPBACK"
guard check > /dev/null 2>&1 && fail 'check accepted an extra RETURN' || pass 'check rejects extra rules'
guard apply > /dev/null && [[ "$(chain_of iptables)" == "$EXPECTED_V4" ]] \
    && pass 'apply restores a tampered chain' || fail 'apply did not restore the chain'

# --- remove (rollback) leaves foreign rules alone ---
guard remove > /dev/null
[[ ! -e "$FAKE_STATE/iptables/QAAP_TENANT_LOOPBACK" && "$(output_of iptables)" == '-j ufw-before-output' ]] \
    && pass 'remove deletes only the guard' || fail "remove left: $(output_of iptables)"

# --- configuration validation and IPv6-less hosts ---
reset_state config
QAAP_TENANT_LOOPBACK_UID=0 guard apply > /dev/null 2>&1 && fail 'guarding UID 0 was allowed' || pass 'UID 0 is refused'
QAAP_TENANT_LOOPBACK_ALLOW_TCP='14873 4873x' guard apply > /dev/null 2>&1 \
    && fail 'invalid port accepted' || pass 'invalid ports are refused'
[[ ! -e "$FAKE_STATE/iptables/QAAP_TENANT_LOOPBACK" ]] && pass 'invalid configuration changes nothing' \
    || fail 'invalid configuration touched the firewall'
if QAAP_IPTABLES="$BIN/iptables" QAAP_IP6TABLES="$TEST_ROOT/missing-ip6tables" bash "$GUARD" apply > /dev/null 2>&1; then
    [[ ! -e "$FAKE_STATE/ip6tables/QAAP_TENANT_LOOPBACK" ]] && pass 'IPv6-less host applies IPv4 only' \
        || fail 'IPv6 chain created without ip6tables'
else
    fail 'apply failed on an IPv6-less host'
fi
QAAP_IPTABLES="$TEST_ROOT/missing-iptables" QAAP_IP6TABLES="$BIN/ip6tables" bash "$GUARD" apply > /dev/null 2>&1 \
    && fail 'apply succeeded without iptables' || pass 'apply fails closed without iptables'

# --- deploy: the VPS update installs, enables and verifies the guard ---
# The workflow runs the update directly, or through the rollback transaction that runs it.
ROLLBACK="$ROOT/scripts/qaap-vps-rollback.sh"
if grep -Eq '^[[:space:]]+\./scripts/qaap-vps-update\.sh( |\\|$)' "$DEPLOY_WORKFLOW" \
    || { grep -Eq '^[[:space:]]+bash \./scripts/qaap-vps-rollback\.sh "\$@"' "$DEPLOY_WORKFLOW" \
        && grep -Eq '^"\$SCRIPT_DIR/qaap-vps-update\.sh" ' "$ROLLBACK"; }; then
    pass 'deploy workflow runs qaap-vps-update.sh'
else
    fail 'deploy workflow no longer runs scripts/qaap-vps-update.sh'
fi
call_line="$(grep -nx 'ensure_tenant_loopback_guard' "$UPDATE" | head -n 1 | cut -d: -f1 || true)"
switch_line="$(grep -nx 'run_runtime_state_check' "$UPDATE" | head -n 1 | cut -d: -f1 || true)"
[[ -n "$call_line" && -n "$switch_line" && "$call_line" -lt "$switch_line" ]] \
    && pass 'qaap-vps-update.sh installs the guard before switching containers' \
    || fail 'qaap-vps-update.sh no longer calls ensure_tenant_loopback_guard at top level before the switch'
grep -Fxq 'ExecStart=/usr/local/sbin/qaap-tenant-loopback-guard apply' "$SERVICE" \
    && grep -Fxq 'WantedBy=multi-user.target' "$SERVICE" \
    && grep -Fxq 'Before=network-pre.target shutdown.target' "$SERVICE" \
    && pass 'service applies the guard at boot before networking' || fail 'service unit lost its boot wiring'
grep -Fxq 'WantedBy=timers.target' "$TIMER" && grep -Fxq 'OnUnitActiveSec=1min' "$TIMER" \
    && pass 'timer re-asserts the guard' || fail 'timer unit lost its schedule'
grep -Fq 'QAAP_TENANT_LOOPBACK_GUARD_BIN:-/usr/local/sbin/qaap-tenant-loopback-guard}' "$UPDATE" \
    && pass 'deploy installs the binary the unit executes' || fail 'deploy and unit disagree on the guard path'

sed -n '/^ensure_tenant_loopback_guard() {$/,/^}$/p' "$UPDATE" > "$TEST_ROOT/ensure.sh"
[[ -s "$TEST_ROOT/ensure.sh" ]] || fail 'ensure_tenant_loopback_guard() not found in qaap-vps-update.sh'
DEPLOY_BIN="$TEST_ROOT/deploy-bin"
mkdir -p "$DEPLOY_BIN"
cat > "$DEPLOY_BIN/id" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == -u ]] && echo 0
MOCK
# Fake systemctl: records calls; restarting the service runs the installed guard like systemd would.
cat > "$DEPLOY_BIN/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
echo "systemctl $*" >> "$FAKE_STATE/systemctl"
if [[ "$1" == restart && "$2" == qaap-tenant-loopback-guard.service ]]; then
    grep -Fxq 'ExecStart=/usr/local/sbin/qaap-tenant-loopback-guard apply' "$QAAP_SYSTEMD_UNIT_DIR/qaap-tenant-loopback-guard.service"
    set -a; . "$QAAP_TENANT_LOOPBACK_GUARD_DEFAULTS"; set +a
    exec "$QAAP_TENANT_LOOPBACK_GUARD_BIN" apply
fi
MOCK
chmod +x "$DEPLOY_BIN/id" "$DEPLOY_BIN/systemctl"
run_ensure() {
    local install_root="$1"
    shift
    (
        export PATH="$DEPLOY_BIN:$PATH" REPO_DIR="$ROOT"
        export QAAP_IPTABLES="$BIN/iptables" QAAP_IP6TABLES="$BIN/ip6tables"
        export QAAP_SYSTEMD_UNIT_DIR="$install_root/etc/systemd/system"
        export QAAP_TENANT_LOOPBACK_GUARD_BIN="$install_root/usr/local/sbin/qaap-tenant-loopback-guard"
        export QAAP_TENANT_LOOPBACK_GUARD_DEFAULTS="$install_root/etc/default/qaap-tenant-loopback-guard"
        mkdir -p "$install_root/etc/default"
        for assignment in "$@"; do export "${assignment?}"; done
        # shellcheck source=/dev/null
        . "$TEST_ROOT/ensure.sh"
        ensure_tenant_loopback_guard
    )
}

SOCKET="$TEST_ROOT/docker.sock"
python3 -c 'import socket, sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$SOCKET"

reset_state deploy
INSTALL="$TEST_ROOT/install-deploy"
if run_ensure "$INSTALL" "QAAP_ROOTLESS_DOCKER_SOCKET=$SOCKET" > "$TEST_ROOT/deploy.log" 2>&1; then
    [[ -x "$INSTALL/usr/local/sbin/qaap-tenant-loopback-guard" \
        && -f "$INSTALL/etc/systemd/system/qaap-tenant-loopback-guard.service" \
        && -f "$INSTALL/etc/systemd/system/qaap-tenant-loopback-guard.timer" ]] \
        && pass 'deploy installs the guard script and units' || fail 'deploy did not install the guard files'
    grep -Fxq 'systemctl enable qaap-tenant-loopback-guard.service qaap-tenant-loopback-guard.timer' "$FAKE_STATE/systemctl" \
        && grep -Fxq 'systemctl start qaap-tenant-loopback-guard.timer' "$FAKE_STATE/systemctl" \
        && pass 'deploy enables the service and timer for reboots' || fail 'deploy did not enable the units'
    [[ "$(chain_of iptables)" == "$EXPECTED_V4" && "$(sed -n 1p "$FAKE_STATE/iptables/OUTPUT")" == "$JUMP_V4" ]] \
        && pass 'deploy leaves the guard active' || fail 'deploy did not activate the guard'
    grep -Fxq 'QAAP_TENANT_LOOPBACK_ALLOW_TCP=14873' "$INSTALL/etc/default/qaap-tenant-loopback-guard" \
        && pass 'deploy writes default settings once' || fail 'deploy did not write the defaults file'
    # Operator settings survive later deploys.
    printf 'QAAP_TENANT_LOOPBACK_UID=1000\nQAAP_TENANT_LOOPBACK_ALLOW_TCP="14873 14874"\n' \
        > "$INSTALL/etc/default/qaap-tenant-loopback-guard"
    run_ensure "$INSTALL" "QAAP_ROOTLESS_DOCKER_SOCKET=$SOCKET" > /dev/null 2>&1 \
        && grep -Fq -- '--dport 14874 -j RETURN' "$FAKE_STATE/iptables/QAAP_TENANT_LOOPBACK" \
        && pass 'redeploy keeps operator settings' || fail 'redeploy overwrote operator settings'
else
    fail "deploy install failed: $(cat "$TEST_ROOT/deploy.log")"
fi

reset_state broken
printf '%s\n' '#!/usr/bin/env bash' 'exit 1' > "$BIN/broken-iptables"
chmod +x "$BIN/broken-iptables"
run_ensure "$TEST_ROOT/install-broken" "QAAP_ROOTLESS_DOCKER_SOCKET=$SOCKET" "QAAP_IPTABLES=$BIN/broken-iptables" > /dev/null 2>&1 \
    && fail 'deploy succeeded although the guard could not be applied' || pass 'deploy fails when the guard cannot be applied'

reset_state skip
run_ensure "$TEST_ROOT/install-skip" "QAAP_ROOTLESS_DOCKER_SOCKET=$TEST_ROOT/absent.sock" > /dev/null 2>&1 \
    && [[ ! -e "$FAKE_STATE/systemctl" ]] \
    && pass 'hosts without a rootless daemon are left untouched' || fail 'guard installed on a host without rootless Docker'
run_ensure "$TEST_ROOT/install-skip" "QAAP_TENANT_LOOPBACK_GUARD=1" "QAAP_ROOTLESS_DOCKER_SOCKET=$TEST_ROOT/absent.sock" > /dev/null 2>&1 \
    && [[ -e "$FAKE_STATE/systemctl" ]] \
    && pass 'QAAP_TENANT_LOOPBACK_GUARD=1 forces installation' || fail 'forced installation did not run'

if (( failures > 0 )); then
    echo "$failures check(s) failed" >&2
    exit 1
fi
echo 'All tenant loopback guard checks passed.'
