#!/usr/bin/env bash
# qaap-vps-launch-gate.sh — host-side production gate after docker compose is up.
#
# Run on the VPS from the repo root (root). This is a multi-user beta release gate:
# two disposable invited accounts must exercise agent, worktree and parallel runs
# first. Missing or failed isolation evidence blocks the release.
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

CONTAINER_ISOLATION="$(dexec 'printf %s "${QAAP_TENANT_CONTAINER_ISOLATION:-}"')"
if [[ "$CONTAINER_ISOLATION" == "1" || "$CONTAINER_ISOLATION" == "true" ]]; then
    if dexec 'id' | grep -q 'uid=0(root)'; then
        bad "backend runs as root — hosted Theia must remain non-root when worker containers are enabled"
    else
        ok "backend runs as non-root; tenant worker containers are the execution boundary"
    fi
else
    bad "QAAP_TENANT_CONTAINER_ISOLATION='$CONTAINER_ISOLATION' — public deploy requires container-per-tenant isolation"
fi

DOCKER_HOST_IN_CONTAINER="$(dexec 'printf %s "${DOCKER_HOST:-}"')"
ALLOW_ROOTFUL_DOCKER="$(dexec 'printf %s "${QAAP_ALLOW_ROOTFUL_DOCKER_SOCKET_IN_PRODUCTION:-}"')"
if [[ -n "$ALLOW_ROOTFUL_DOCKER" && "$ALLOW_ROOTFUL_DOCKER" =~ ^(1|true|yes)$ ]]; then
    bad "rootful Docker socket override is enabled — public launch is blocked"
elif [[ "$DOCKER_HOST_IN_CONTAINER" == unix:///var/run/docker.sock || "$DOCKER_HOST_IN_CONTAINER" == unix:///run/docker.sock || -z "$DOCKER_HOST_IN_CONTAINER" ]]; then
    bad "hosted Docker control plane uses the rootful default; configure a rootless socket"
elif [[ "$DOCKER_HOST_IN_CONTAINER" == unix:///* ]]; then
    ok "hosted Docker control plane uses a non-system Unix socket (${DOCKER_HOST_IN_CONTAINER})"
else
    bad "hosted Docker control plane is not a rootless Unix socket (${DOCKER_HOST_IN_CONTAINER})"
fi

if dexec 'command -v setpriv >/dev/null 2>&1'; then
    ok "setpriv is present"
else
    bad "setpriv missing"
fi

if dexec 'for harness in qaiq openclaude codex claude opencode antigravity; do command -v "$harness" >/dev/null 2>&1 || exit 1; done'; then
    ok "coding-agent harnesses are installed in the serving image"
else
    bad "one or more coding-agent harnesses are missing from the serving image; rebuild/pull the Qaap image"
fi

# Public beta must use the compiled backend-per-tenant router. A tenant worker
# alone is insufficient because Theia singletons, memory, operator logs and
# in-process indexes otherwise remain shared.
BETA_ALLOWED_LOGINS="$(dexec 'printf %s "${QAAP_BETA_ALLOWED_LOGINS:-}"')"
BACKEND_ISOLATION_MODE="$(dexec 'node -e "const m=require(\"/app/packages/qaap-adapters/lib/common/qaap-backend-isolation.js\"); process.stdout.write(m.QAAP_BACKEND_ISOLATION_MODE)"')"
BACKEND_PER_TENANT="$(dexec 'printf %s "${QAAP_BACKEND_PER_TENANT:-}"')"
BACKEND_SECRET_LENGTH="$(dexec 'printf %s "${#QAAP_TENANT_BACKEND_MASTER_SECRET}"')"
PREVIEW_BASE_DOMAIN="$(dexec 'printf %s "${QAAP_PREVIEW_BASE_DOMAIN:-}"')"
OPERATOR_LOGINS="$(dexec 'printf %s "${QAAP_OPERATOR_LOGINS:-}"')"
# Third party = an admitted login that is not an operator; only those need isolated previews.
OPERATOR_SET=",${OPERATOR_LOGINS//[[:space:]]/},"
OPERATOR_SET="${OPERATOR_SET,,}"
ADMITS_THIRD_PARTY=0
IFS=',' read -ra BETA_LOGIN_LIST <<< "${BETA_ALLOWED_LOGINS//[[:space:]]/}"
for login in "${BETA_LOGIN_LIST[@]}"; do
    login="${login,,}"
    if [[ -n "$login" && "$OPERATOR_SET" != *",$login,"* ]]; then
        ADMITS_THIRD_PARTY=1
    fi
done
if [[ -n "${BETA_ALLOWED_LOGINS//[[:space:],]/}" && "$BACKEND_ISOLATION_MODE" != "per-tenant" ]]; then
    bad "public beta is configured but the compiled backend isolation mode is '$BACKEND_ISOLATION_MODE'; backend-per-tenant is required"
elif [[ -n "${BETA_ALLOWED_LOGINS//[[:space:],]/}" && ! "$BACKEND_PER_TENANT" =~ ^(1|true)$ ]]; then
    bad "public beta is configured but QAAP_BACKEND_PER_TENANT='$BACKEND_PER_TENANT'"
elif [[ -n "${BETA_ALLOWED_LOGINS//[[:space:],]/}" && "$BACKEND_SECRET_LENGTH" -lt 32 ]]; then
    bad "public beta requires QAAP_TENANT_BACKEND_MASTER_SECRET with at least 32 characters"
elif [[ "$ADMITS_THIRD_PARTY" == 1 && -z "${PREVIEW_BASE_DOMAIN//[[:space:]]/}" ]]; then
    # The backend readiness gate also validates that the domain is a separate site.
    bad "public beta requires QAAP_PREVIEW_BASE_DOMAIN (isolated preview origins; see SECURITY.md)"
else
    ok "compiled backend isolation mode is '$BACKEND_ISOLATION_MODE'"
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
        bad "multi-tenant isolation failed for ${LOGIN_A} / ${LOGIN_B} — release blocked"
    fi
else
    bad "only ${TENANT_COUNT} tenant(s): exercise two disposable invited accounts (agent + New Worktree + parallel) before release"
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
