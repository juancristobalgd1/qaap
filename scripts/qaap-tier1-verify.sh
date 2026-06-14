#!/usr/bin/env bash
# Tier-1 cloud verification — compile, drift, unit tests, optional VPS + webhook smoke.
#
# Usage:
#   ./scripts/qaap-tier1-verify.sh              # local CI parity
#   ./scripts/qaap-tier1-verify.sh --vps        # + docker health (on VPS)
#   ./scripts/qaap-tier1-verify.sh --webhook    # + signed webhook smoke (needs running backend)
#   ./scripts/qaap-tier1-verify.sh --vps --webhook
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_VPS=false
RUN_WEBHOOK=false
for arg in "$@"; do
    case "$arg" in
        --vps) RUN_VPS=true ;;
        --webhook) RUN_WEBHOOK=true ;;
        -h|--help)
            sed -n '2,8p' "$0"
            exit 0
            ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done

step() {
    echo ""
    echo "==> $*"
}

step "compile (@theia/qaap-cloud-workspace + @theia/qaap-mobile-shell)"
npx lerna run compile --scope @theia/qaap-cloud-workspace --scope @theia/qaap-mobile-shell

step "drift-check"
node scripts/qaap-drift-check.js

step "unit tests (@theia/qaap-cloud-workspace)"
npx lerna run test --scope @theia/qaap-cloud-workspace

step "unit tests (@theia/qaap-mobile-shell)"
npx lerna run test --scope @theia/qaap-mobile-shell

step "github trigger + webhook signature specs"
npx lerna run test --scope @theia/qaap-mobile-shell -- --grep 'qaap-github'
npx lerna run test --scope @theia/qaap-cloud-workspace -- --grep 'github-pr-evidence'
npx lerna run test --scope @theia/qaap-cloud-workspace -- --grep 'qaap-web-push'

if [[ "$RUN_VPS" == true ]]; then
    step "VPS health (docker compose)"
    ./scripts/qaap-vps-verify.sh
fi

if [[ "$RUN_WEBHOOK" == true ]]; then
    step "GitHub webhook smoke"
    ./scripts/qaap-github-webhook-smoke.sh
fi

echo ""
echo "qaap-tier1-verify: all automated checks passed"
if [[ "$RUN_VPS" == false && "$RUN_WEBHOOK" == false ]]; then
    echo "Tip: on VPS run  ./scripts/qaap-tier1-verify.sh --vps --webhook"
    echo "Manual: F5 after Open IDE → Work Hub; Mission Control scroll ≤767px; @qaap on real issue"
fi
