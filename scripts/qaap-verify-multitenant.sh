#!/usr/bin/env bash
# qaap-verify-multitenant.sh — prove per-tenant OS-uid isolation on the VPS BEFORE opening to real
# tenants. Run on the VPS HOST from the repo root, AFTER two DISPOSABLE tenants have each: signed in,
# opened one of THEIR OWN repos, and run at least one @qaiq task (so their trees + uids are provisioned).
#
#   ./scripts/qaap-verify-multitenant.sh <github-login-A> <github-login-B>
#
# Exit 0 = every checked invariant holds. Any FAIL = do NOT open to multiple tenants yet.
#
# It is READ-ONLY on tenant data: cross-tenant access and getpwuid/commit are proven in a THROWAWAY
# git repo created + removed under each tenant's own tree — the tenants' real repos are never modified.
set -uo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $0 <github-login-A> <github-login-B>" >&2
    exit 2
fi

SVC="${QAAP_THEIA_SERVICE:-theia}"
REPOS_ROOT="${QAAP_REPOS_ROOT:-/workspace/repos}"
WORKTREES_ROOT="${QAAP_WORKTREES_ROOT:-/tmp/qaap-worktrees}"
PARALLEL_ROOT="${QAAP_PARALLEL_ROOT:-/tmp/qaap-parallel}"
TENANT_HOME_ROOT="${QAAP_TENANT_HOME_ROOT:-/home/qaap-tenants}"
REG="${QAAP_TENANT_UID_REGISTRY_PATH:-/workspace/.qaap/uid-registry.json}"

pass=0; fail=0
ok()  { echo "  OK   $*"; pass=$((pass + 1)); }
bad() { echo "  FAIL $*" >&2; fail=$((fail + 1)); }
# Run a command INSIDE the container (backend runs there as root). -T: no TTY (works under ssh/cron).
dexec() { docker compose exec -T "$SVC" sh -c "$1"; }

# safeUserIdSegment(login): trim, replace every char outside [A-Za-z0-9_.-] with '_', '_unknown' if empty.
seg() {
    local s
    s="$(printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/[^A-Za-z0-9_.-]/_/g')"
    [[ -n "$s" ]] && printf '%s' "$s" || printf '%s' '_unknown'
}
SEG_A="$(seg "$1")"; SEG_B="$(seg "$2")"
TREE_A="$REPOS_ROOT/users/$SEG_A"; TREE_B="$REPOS_ROOT/users/$SEG_B"

# Defensive cleanup: remove ONLY the exact throwaway paths this script creates (never a glob — a
# `.qaap-verify-*` wildcard could delete a real pre-existing entry in the tenant's tree). The func_check
# repo `.qaap-verify-$uid` lives in the repos tree; the cross_read probe `.qaap-verify-probe-$uid` may
# live in any of the tenant's roots (repos, worktrees, parallel). UID_A/UID_B are resolved before any
# path is created, so they are set by the time this runs.
clean_one() { # $1=seg $2=uid
    [[ -z "$2" ]] && return 0
    dexec "rm -rf '$REPOS_ROOT/users/$1/.qaap-verify-$2' \
        '$REPOS_ROOT/users/$1/.qaap-verify-probe-$2' \
        '$WORKTREES_ROOT/$1/.qaap-verify-probe-$2' \
        '$PARALLEL_ROOT/$1/.qaap-verify-probe-$2'" >/dev/null 2>&1
    return 0
}
cleanup() { clean_one "$SEG_A" "${UID_A:-}"; clean_one "$SEG_B" "${UID_B:-}"; return 0; }
trap cleanup EXIT INT TERM

# Robustly read map[segment] from the registry JSON with node (NOT a fragile sed on JSON). Empty if absent.
reg_uid() { dexec "node -e 'try{const j=require(process.argv[1]);const v=(j.map||{})[process.argv[2]];process.stdout.write(Number.isInteger(v)?String(v):\"\")}catch(e){}' '$REG' '$1'"; }
# Mode + numeric owner of a path inside the container, as "OWNER MODE" (empty if the path is missing).
stat_om() { dexec "stat -c '%u %a' '$1' 2>/dev/null"; }

echo "== 0. Runtime preconditions =="
dexec 'id' | grep -q 'uid=0(root)' && ok "backend runs as root" || bad "backend is NOT root — uid-per-user degrades to NO isolation"
dexec 'command -v setpriv >/dev/null 2>&1' && ok "setpriv (util-linux) present" || bad "setpriv missing — the drop cannot clear supplementary groups"
FLAG="$(dexec 'printf %s "${QAAP_AGENT_UID_PER_USER:-}"')"
[[ "$FLAG" == "1" || "$FLAG" == "true" ]] && ok "QAAP_AGENT_UID_PER_USER=$FLAG" || bad "QAAP_AGENT_UID_PER_USER='$FLAG', expected 1"
# --no-cluster is required: uid assignment is only safe single-process (doc/qaap-uid-per-user.md). The
# image CMD is `exec node … --no-cluster`, so the backend REPLACES sh and IS PID 1 — check its cmdline.
# Exact-token match (one arg per line, grep -Fxq) so a substring can't spoof it. NOTE: this checks
# PID 1 — correct for this image (CMD `exec node … --no-cluster`). If you add an init (docker --init /
# tini) PID 1 becomes the init and this reports FAIL even when the node child has --no-cluster; verify
# the backend argv manually in that case (conservative false FAIL, never a false OK).
if dexec 'tr "\0" "\n" < /proc/1/cmdline 2>/dev/null | grep -Fxq -- "--no-cluster"'; then
    ok "backend (PID 1) runs with --no-cluster (single-process uid assignment)"
else
    bad "PID 1 cmdline has no --no-cluster token — clustered workers would race uid assignment (or PID 1 is an init; verify manually)"
fi

echo "== 1. uid registry =="
dexec "test -f '$REG'" && ok "registry exists at $REG" || bad "no uid registry at $REG — has any tenant run a task?"
UID_A="$(reg_uid "$SEG_A")"; UID_B="$(reg_uid "$SEG_B")"
[[ "$UID_A" =~ ^[0-9]+$ ]] && ok "tenant A ($SEG_A) uid = $UID_A" || { bad "no uid for A ($SEG_A) in registry.map"; UID_A=""; }
[[ "$UID_B" =~ ^[0-9]+$ ]] && ok "tenant B ($SEG_B) uid = $UID_B" || { bad "no uid for B ($SEG_B) in registry.map"; UID_B=""; }
[[ -n "$UID_A" && "$UID_A" == "$UID_B" ]] && bad "A and B resolved to the SAME uid ($UID_A) — no code isolation"
[[ -n "$UID_A" && "$UID_A" -lt 20000 ]] && bad "A uid $UID_A is below the tenant base 20000 (shared reserved bucket, not a real tenant)"
[[ -n "$UID_B" && "$UID_B" -lt 20000 ]] && bad "B uid $UID_B is below the tenant base 20000 (shared reserved bucket, not a real tenant)"

echo "== 2. On-disk ownership + modes =="
check_dir() { # $1=path $2=want_owner $3=want_mode $4=label
    local om owner mode
    om="$(stat_om "$1")"
    if [[ -z "$om" ]]; then bad "$4 ($1) is missing"; return; fi
    owner="${om%% *}"; mode="${om##* }"
    [[ "$owner" == "$2" ]] && ok "$4 owned by uid $2" || bad "$4 owner is '$owner', expected $2"
    [[ "$mode" == "$3" ]] && ok "$4 is 0$3" || bad "$4 mode is '$mode', expected $3"
}
# A tenant's ISOLATED tree roots: repos (always) + conversation-worktree + parallel-run (each only if
# that tenant used the feature). resolveTenantIsolationRoot treats ALL of them as tenant trees, so each
# must be 0700/owned exactly like the repos tree — a non-isolated worktree/parallel root is a real leak
# the parent-0711 check alone would miss. (Have the test tenants exercise New Worktree + a parallel run
# so these roots exist and get checked.)
tenant_roots() { # $1=segment -> prints each existing root, one per line
    printf '%s\n' "$REPOS_ROOT/users/$1"
    dexec "test -d '$WORKTREES_ROOT/$1'" && printf '%s\n' "$WORKTREES_ROOT/$1"
    dexec "test -d '$PARALLEL_ROOT/$1'"  && printf '%s\n' "$PARALLEL_ROOT/$1"
    return 0
}
if [[ -n "$UID_A" ]]; then while IFS= read -r r; do check_dir "$r" "$UID_A" 700 "A tree $r"; done < <(tenant_roots "$SEG_A"); fi
if [[ -n "$UID_B" ]]; then while IFS= read -r r; do check_dir "$r" "$UID_B" 700 "B tree $r"; done < <(tenant_roots "$SEG_B"); fi
# Every recognized tenant-tree PARENT must be root-owned 0711 (traversable, not listable).
check_dir "$REPOS_ROOT/users" 0 711 "repos parent"
dexec "test -d '$WORKTREES_ROOT'" && check_dir "$WORKTREES_ROOT" 0 711 "conversation-worktrees parent"
dexec "test -d '$PARALLEL_ROOT'"  && check_dir "$PARALLEL_ROOT"  0 711 "parallel-run parent"
# Per-tenant private HOME must be 0700 owned by the uid (else the dropped agent cannot write its config).
# check_dir already reports a hard FAIL when the dir is missing — do NOT guard with `&& test -d`, which
# would silently skip (a false OK) if the HOME was never provisioned.
[[ -n "$UID_A" ]] && check_dir "$TENANT_HOME_ROOT/$SEG_A" "$UID_A" 700 "A tenant HOME"
[[ -n "$UID_B" ]] && check_dir "$TENANT_HOME_ROOT/$SEG_B" "$UID_B" 700 "B tenant HOME"

echo "== 3. Cross-tenant read is DENIED (the test that matters) =="
cross_read() { # $1=reader_uid $2=victim_tree $3=victim_uid $4=label
    # The victim's tree ROOT is 0700 owned by the victim, so a different uid can neither LIST it nor
    # TRAVERSE into it to read a known path. Test BOTH — all against FIXED, operator-controlled paths
    # (never a tenant-controlled filename, which could break shell quoting into a false OK):
    #   (a) `ls` the root  -> needs read on the 0700 dir;
    #   (b) `cat` a known probe file at a fixed path -> needs traverse (execute) on the root. (b) catches
    #       an execute-only / ACL-traversable root that (a) alone would miss (children may be readable).
    if ! dexec "test -d '$2'"; then bad "$4: victim tree $2 does not exist (cannot test isolation)"; return; fi
    local listed=0 read=0
    dexec "setpriv --reuid $1 --regid $1 --clear-groups -- ls -A '$2' >/dev/null 2>&1" && listed=1
    local probe="$2/.qaap-verify-probe-$3"
    # Create the probe as root and CONFIRM it exists + is owned/readable before the reader test. A failed
    # create would make `cat` fail for the wrong reason (missing file) and hide a real traversal leak — so
    # a failed probe setup is a hard FAIL, not a silent pass (fail-open guard).
    if ! dexec "printf secret > '$probe' && chmod 0644 '$probe' && chown $3:$3 '$probe' && test -r '$probe'"; then
        bad "$4: could not create the read probe at $probe (cannot verify traversal denial)"
        dexec "rm -f '$probe'" >/dev/null 2>&1 || true
        return
    fi
    dexec "setpriv --reuid $1 --regid $1 --clear-groups -- cat '$probe' >/dev/null 2>&1" && read=1
    dexec "rm -f '$probe'" >/dev/null 2>&1 || true
    if [[ "$listed" -eq 0 && "$read" -eq 0 ]]; then
        ok "$4 (uid $1 can neither list nor read the tree)"
    else
        bad "LEAK: uid $1 could$([[ $listed -eq 1 ]] && echo ' list')$([[ $read -eq 1 ]] && echo ' read a known path') in $2"
    fi
}
if [[ -n "$UID_A" && -n "$UID_B" ]]; then
    while IFS= read -r r; do cross_read "$UID_A" "$r" "$UID_B" "A cannot read B ($r)"; done < <(tenant_roots "$SEG_B")
    while IFS= read -r r; do cross_read "$UID_B" "$r" "$UID_A" "B cannot read A ($r)"; done < <(tenant_roots "$SEG_A")
fi

echo "== 4. Each tenant uid is functional (passwd + group + getpwuid-less git commit) =="
func_check() { # $1=uid $2=seg $3=tree $4=label
    dexec "getent passwd $1 >/dev/null" && ok "$4: uid $1 has an /etc/passwd record" || bad "$4: uid $1 has NO passwd record (git commit fails)"
    dexec "getent group $1 >/dev/null"  && ok "$4: gid $1 has an /etc/group record"  || bad "$4: gid $1 has NO group record"
    # Prove write + commit under the uid in a THROWAWAY repo inside the tenant tree (never touches real repos).
    local d="$3/.qaap-verify-$1"
    local script="set -e; rm -rf '$d'; mkdir -p '$d'; cd '$d'; git init -q; echo x > f; git add f; git -c user.email=v@q -c user.name=v commit -q -m v; test -n \"\$(git rev-parse HEAD)\""
    if dexec "setpriv --reuid $1 --regid $1 --clear-groups -- sh -c \"$script\" >/dev/null 2>&1"; then
        ok "$4: uid $1 can write + git commit (getpwuid works)"
    else
        bad "$4: uid $1 CANNOT write/commit (getpwuid / ownership problem)"
    fi
    dexec "rm -rf '$d'" >/dev/null 2>&1 || true
}
[[ -n "$UID_A" ]] && func_check "$UID_A" "$SEG_A" "$TREE_A" "A"
[[ -n "$UID_B" ]] && func_check "$UID_B" "$SEG_B" "$TREE_B" "B"

echo
echo "==================================================================="
echo "  PASSED: $pass   FAILED: $fail"
if [[ "$fail" -eq 0 && "$pass" -gt 0 ]]; then
    echo "  Multi-tenant isolation VERIFIED. Safe to open to multiple tenants."
    exit 0
fi
echo "  Isolation NOT verified — DO NOT open to multiple tenants."
echo "  (Also close the OAuth 'git pull' filter residual — see SECURITY.md — before opening.)"
exit 1
