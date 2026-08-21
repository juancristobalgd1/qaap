#!/usr/bin/env bash
# qaap-vps-launch-gate.sh — host-side production gate after docker compose is up.
#
# Run on the VPS from the repo root (root). Safe for a single-user box: isolation
# verification runs when two tenant uids already exist, but a failed check is a WARN
# (not a deploy blocker). Inviting a second real user still requires a green
# `qaap-verify-multitenant.sh` — see SECURITY.md.
#
#   ./scripts/qaap-vps-launch-gate.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"
SVC="${QAAP_THEIA_SERVICE:-theia}"

pass=0
fail=0
ok()  { echo "  OK   $*"; pass=$((pass + 1)); }
bad() { echo "  FAIL $*" >&2; fail=$((fail + 1)); }

echo "Qaap VPS launch gate"

if [[ ! -x ./scripts/qaap-vps-ensure-backup-cron.sh ]]; then
    chmod +x ./scripts/qaap-vps-ensure-backup-cron.sh ./scripts/qaap-vps-backup.sh || true
fi
if ./scripts/qaap-vps-ensure-backup-cron.sh; then
    ok "nightly backup cron is installed"
else
    bad "could not install nightly backup cron"
fi

BACKUP_DIR="${QAAP_BACKUP_DIR:-/var/backups/qaap}"
if compgen -G "${BACKUP_DIR}/qaap-*.tar.gz" >/dev/null; then
    ok "local backup archives exist in ${BACKUP_DIR}"
else
    bad "no local backup archives in ${BACKUP_DIR}"
fi

OFFSITE_ENV="${QAAP_BACKUP_OFFSITE_ENV:-/opt/qaap/.env.backup}"
if [[ -n "${QAAP_BACKUP_OFFSITE_CMD:-}" || -f "$OFFSITE_ENV" ]]; then
    ok "offsite backup command is configured"
else
    echo "  WARN no ${OFFSITE_ENV} — local tars do not survive disk loss (see doc/qaap-vps-deployment.md)"
fi

dexec() { docker compose exec -T "$SVC" sh -c "$1"; }

if dexec 'id' | grep -q 'uid=0(root)'; then
    ok "backend runs as root (required for uid-per-user drop)"
else
    bad "backend is not root — uid-per-user degrades to no isolation"
fi

if dexec 'command -v setpriv >/dev/null 2>&1'; then
    ok "setpriv is present"
else
    bad "setpriv missing"
fi

FLAG="$(dexec 'printf %s "${QAAP_AGENT_UID_PER_USER:-}"')"
if [[ "$FLAG" == "1" || "$FLAG" == "true" ]]; then
    ok "QAAP_AGENT_UID_PER_USER=$FLAG"
else
    bad "QAAP_AGENT_UID_PER_USER='$FLAG' (public deploy requires 1)"
fi

if dexec 'tr "\0" "\n" < /proc/1/cmdline 2>/dev/null | grep -Fxq -- "--no-cluster"'; then
    ok "backend PID 1 has --no-cluster"
else
    echo "  WARN PID 1 has no --no-cluster token (verify manually if docker --init is in use)"
fi

REG="${QAAP_TENANT_UID_REGISTRY_PATH:-/workspace/.qaap/uid-registry.json}"
TENANT_COUNT="$(dexec "node -e 'try{const j=require(\"$REG\");process.stdout.write(String(Object.keys(j.map||{}).length))}catch(e){process.stdout.write(\"0\")}'" || echo 0)"
TENANT_LOGINS="$(dexec "node -e 'try{const j=require(\"$REG\");process.stdout.write(Object.keys(j.map||{}).join(\" \"))}catch(e){}'" || true)"
echo "  INFO tenant uid registry size: ${TENANT_COUNT} (${TENANT_LOGINS:-none})"

if [[ "$TENANT_COUNT" -ge 2 ]]; then
    # shellcheck disable=SC2086
    set -- $TENANT_LOGINS
    LOGIN_A="$1"
    LOGIN_B="$2"
    echo "  INFO running multi-tenant isolation against ${LOGIN_A} and ${LOGIN_B}"
    if ./scripts/qaap-verify-multitenant.sh "$LOGIN_A" "$LOGIN_B"; then
        ok "multi-tenant isolation PASSED"
    else
        echo "  WARN multi-tenant isolation not verified for ${LOGIN_A} / ${LOGIN_B}"
        echo "       Extra GitHub logins in the uid registry are not a second-user launch."
        echo "       Do not invite a real second user until this script PASSES (SECURITY.md)."
        ok "single-user launch; isolation deferred"
    fi
else
    echo "  WARN only ${TENANT_COUNT} tenant(s) on this box — run two disposable GitHub logins"
    echo "       (agent + New Worktree + parallel) then re-run scripts/qaap-verify-multitenant.sh"
    ok "single-tenant box; isolation script deferred"
fi

# Paid-beta Stripe: WARN if incomplete; FAIL only when DEV_CHECKOUT is on.
stripe_secret="$(dexec 'printf %s "${STRIPE_SECRET_KEY:-}"' || true)"
stripe_pro="$(dexec 'printf %s "${STRIPE_PRICE_PRO_MONTHLY:-}"' || true)"
stripe_team="$(dexec 'printf %s "${STRIPE_PRICE_TEAM_MONTHLY:-}"' || true)"
stripe_wh="$(dexec 'printf %s "${STRIPE_WEBHOOK_SECRET:-}"' || true)"
public_url="$(dexec 'printf %s "${QAAP_PUBLIC_URL:-}"' || true)"
dev_checkout="$(dexec 'printf %s "${QAAP_BILLING_DEV_CHECKOUT:-}"' || true)"
stripe_ready=0
[[ -n "${stripe_secret}" ]] && stripe_ready=$((stripe_ready + 1))
[[ -n "${stripe_pro}" ]] && stripe_ready=$((stripe_ready + 1))
[[ -n "${stripe_team}" ]] && stripe_ready=$((stripe_ready + 1))
[[ -n "${stripe_wh}" ]] && stripe_ready=$((stripe_ready + 1))
[[ -n "${public_url}" ]] && stripe_ready=$((stripe_ready + 1))
if [[ "${stripe_ready}" -eq 0 ]]; then
    echo "  WARN Stripe unset in container — Work Hub Billing checkout disabled"
elif [[ "${stripe_ready}" -lt 5 ]]; then
    echo "  WARN Stripe partial in container (${stripe_ready}/5) — set STRIPE_* + QAAP_PUBLIC_URL (doc/qaap-vps-deployment.md)"
else
    ok "Stripe checkout + webhook env present in container"
fi
if [[ "${dev_checkout}" == "1" || "${dev_checkout}" == "true" ]]; then
    bad "QAAP_BILLING_DEV_CHECKOUT is on — refuse paid beta on a public VPS"
fi

echo
echo "${pass} passed, ${fail} failed"
if [[ "${fail}" -gt 0 ]]; then
    echo "Launch gate failed. See SECURITY.md." >&2
    exit 1
fi
echo "VPS launch gate passed."
exit 0
