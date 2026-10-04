#!/usr/bin/env bash
# Keep rootless tenant containers away from services bound to the host loopback.
#
# Rootless Docker runs tenants behind slirp4netns as the rootless user (host UID 1000 on the VPS).
# With host loopback enabled, a tenant's connection to 10.0.2.2:<port> leaves slirp4netns as a
# host-side connection from that UID to 127.0.0.1:<port>. The main control plane listens on
# 127.0.0.1:4873 with QAAP_SKIP_AUTH=true behind Caddy, so that path bypassed authentication.
#
# This is an allow-list: loopback traffic owned by the rootless UID may only
#   - continue already-established flows (replies from rootlesskit port-driver listeners),
#   - open TCP connections to 127.0.0.1:<QAAP_TENANT_LOOPBACK_ALLOW_TCP> (the tenant relay),
#   - reach the host stub resolver on port 53 (slirp4netns forwards tenant DNS to it).
# Everything else to 127.0.0.0/8 or ::1 is rejected. The jump into the chain is kept as the
# first OUTPUT rule so a broad "-o lo -j ACCEPT" (e.g. ufw) cannot precede it.
#
# Usage: qaap-tenant-loopback-guard {apply|check|remove}
#   QAAP_TENANT_LOOPBACK_UID         rootless Docker UID (default: 1000)
#   QAAP_TENANT_LOOPBACK_ALLOW_TCP   space-separated TCP ports allowed on 127.0.0.1 (default: 14873)
# Idempotent: apply rewrites the chain atomically and only moves the jump when it is not first.
set -euo pipefail

CHAIN=QAAP_TENANT_LOOPBACK
GUARD_UID="${QAAP_TENANT_LOOPBACK_UID:-1000}"
ALLOW_TCP="${QAAP_TENANT_LOOPBACK_ALLOW_TCP-14873}"
IPTABLES="${QAAP_IPTABLES:-iptables}"
IP6TABLES="${QAAP_IP6TABLES:-ip6tables}"

log() { echo "[qaap-tenant-loopback-guard] $*"; }
fail() { echo "[qaap-tenant-loopback-guard] $*" >&2; exit 1; }

[[ "$GUARD_UID" =~ ^[0-9]+$ ]] || fail "QAAP_TENANT_LOOPBACK_UID must be numeric: $GUARD_UID"
# Root is never a rootless Docker user; guarding UID 0 would cut the host off its own loopback.
[[ "$GUARD_UID" != 0 ]] || fail 'refusing to guard UID 0'
for port in $ALLOW_TCP; do
    [[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 )) \
        || fail "invalid port in QAAP_TENANT_LOOPBACK_ALLOW_TCP: $port"
done

# Rule specs, without "-A <chain>", in apply order. Identical strings feed iptables-restore and -C.
chain_rules() {
    local family="$1" loopback protocol reject
    if [[ "$family" == 4 ]]; then
        loopback=127.0.0.1/32
        reject=icmp-port-unreachable
    else
        loopback=::1/128
        reject=icmp6-port-unreachable
    fi
    echo '-m conntrack --ctstate ESTABLISHED,RELATED -j RETURN'
    if [[ "$family" == 4 ]]; then
        for port in $ALLOW_TCP; do
            echo "-d $loopback -p tcp -m tcp --dport $port -j RETURN"
        done
    fi
    for protocol in udp tcp; do
        echo "-p $protocol -m $protocol --dport 53 -j RETURN"
    done
    echo '-p tcp -j REJECT --reject-with tcp-reset'
    echo "-j REJECT --reject-with $reject"
}

jump_rule() {
    local destination=127.0.0.0/8
    [[ "$1" == 4 ]] || destination=::1/128
    echo "-d $destination -o lo -m owner --uid-owner $GUARD_UID -j $CHAIN"
}

tool_for() { if [[ "$1" == 4 ]]; then echo "$IPTABLES"; else echo "$IP6TABLES"; fi; }

# The first OUTPUT rule is the only jump into the chain and matches the expected spec. Compared by
# target plus -C rather than by text, since iptables -S may print match options in another order.
jump_is_first() {
    local family="$1" tool
    local -a spec
    tool="$(tool_for "$family")"
    read -ra spec <<< "$(jump_rule "$family")"
    [[ "$("$tool" -w -S OUTPUT 1)" == *" -j $CHAIN" ]] \
        && [[ "$("$tool" -w -S OUTPUT | grep -c -- " -j $CHAIN\$")" == 1 ]] \
        && "$tool" -w -C OUTPUT "${spec[@]}" 2>/dev/null
}

# IPv6 is optional on the host; IPv4 is not.
family_available() {
    local tool
    tool="$(tool_for "$1")"
    command -v "$tool" >/dev/null 2>&1 && "$tool" -w -S OUTPUT >/dev/null 2>&1
}

apply_family() {
    local family="$1" tool rule index line
    local -a spec stale=()
    tool="$(tool_for "$family")"
    # One atomic transaction: --noflush keeps every other chain, the declared chain is replaced.
    {
        echo '*filter'
        echo ":$CHAIN - [0:0]"
        chain_rules "$family" | while IFS= read -r rule; do echo "-A $CHAIN $rule"; done
        echo 'COMMIT'
    } | "$tool-restore" -w --noflush

    jump_is_first "$family" && return
    read -ra spec <<< "$(jump_rule "$family")"
    # Insert first so the host is never unguarded, then drop older or misplaced copies.
    "$tool" -w -I OUTPUT 1 "${spec[@]}"
    index=0
    while IFS= read -r line; do
        [[ "$line" == -A\ OUTPUT\ * ]] || continue
        index=$((index + 1))
        if (( index > 1 )) && [[ "$line" == *" -j $CHAIN" ]]; then
            stale=("$index" "${stale[@]}")
        fi
    done < <("$tool" -w -S OUTPUT)
    for index in "${stale[@]}"; do
        "$tool" -w -D OUTPUT "$index"
    done
    log "IPv$family: jump to $CHAIN is the first OUTPUT rule"
}

check_family() {
    local family="$1" tool rule expected actual
    local -a spec
    tool="$(tool_for "$family")"
    "$tool" -w -S "$CHAIN" >/dev/null 2>&1 || { echo "IPv$family: chain $CHAIN is missing" >&2; return 1; }
    while IFS= read -r rule; do
        read -ra spec <<< "$rule"
        "$tool" -w -C "$CHAIN" "${spec[@]}" 2>/dev/null \
            || { echo "IPv$family: $CHAIN lacks: $rule" >&2; return 1; }
    done < <(chain_rules "$family")
    expected="$(chain_rules "$family" | wc -l)"
    actual="$("$tool" -w -S "$CHAIN" | grep -c -- "^-A $CHAIN ")"
    [[ "$actual" == "$expected" ]] || { echo "IPv$family: $CHAIN has $actual rules, expected $expected" >&2; return 1; }
    jump_is_first "$family" \
        || { echo "IPv$family: the jump to $CHAIN is not the first OUTPUT rule" >&2; return 1; }
}

remove_family() {
    local family="$1" tool
    local -a spec
    tool="$(tool_for "$family")"
    read -ra spec <<< "$(jump_rule "$family")"
    while "$tool" -w -C OUTPUT "${spec[@]}" 2>/dev/null; do
        "$tool" -w -D OUTPUT "${spec[@]}"
    done
    if "$tool" -w -S "$CHAIN" >/dev/null 2>&1; then
        "$tool" -w -F "$CHAIN"
        "$tool" -w -X "$CHAIN"
    fi
}

run() {
    local action="$1" family status=0
    family_available 4 || fail "$IPTABLES is unavailable; cannot $action the IPv4 guard"
    for family in 4 6; do
        if [[ "$family" == 6 ]] && ! family_available 6; then
            log "IPv6: $IP6TABLES unavailable, skipped"
            continue
        fi
        if [[ "$action" == check ]]; then
            check_family "$family" || status=1
        else
            "${action}_family" "$family"
        fi
    done
    return "$status"
}

case "${1:-}" in
    apply)
        run apply
        run check || fail 'guard did not verify after apply'
        log "UID $GUARD_UID may reach host loopback only on TCP [${ALLOW_TCP:-none}], DNS and established flows"
        ;;
    check)
        run check || fail "guard is NOT active for UID $GUARD_UID"
        log "guard active for UID $GUARD_UID"
        ;;
    remove)
        run remove
        log "guard removed for UID $GUARD_UID"
        ;;
    *)
        echo "Usage: $0 {apply|check|remove}" >&2
        exit 2
        ;;
esac
