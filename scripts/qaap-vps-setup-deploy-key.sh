#!/usr/bin/env bash
# Generate a deploy-only SSH key and print one-time setup steps for GitHub + VPS.
#
# Usage:
#   ./scripts/qaap-vps-setup-deploy-key.sh
#   ./scripts/qaap-vps-setup-deploy-key.sh ~/.ssh/qaap-vps-deploy
set -euo pipefail

KEY_PATH="${1:-$HOME/.ssh/qaap-vps-deploy}"
PUB_PATH="${KEY_PATH}.pub"

if [[ -f "$KEY_PATH" ]]; then
    echo "Key already exists: $KEY_PATH"
else
    mkdir -p "$(dirname "$KEY_PATH")"
    chmod 700 "$(dirname "$KEY_PATH")"
    ssh-keygen -t ed25519 -N '' -C 'qaap-vps-deploy' -f "$KEY_PATH"
    chmod 600 "$KEY_PATH"
    echo "Created $KEY_PATH"
fi

PUB="$(cat "$PUB_PATH")"

cat <<EOF

=== 1) Add this public key on the VPS (as root or your deploy user) ===

ssh root@YOUR_VPS_IP 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "$PUB" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'

=== 2) GitHub repository secrets (Settings → Secrets and variables → Actions) ===

QAAP_VPS_HOST=178.105.136.93
QAAP_VPS_USER=root
QAAP_VPS_SSH_PORT=22
QAAP_VPS_REPO_DIR=/opt/qaap
# Public Caddy HTTPS origin (NOT host:4873 — that port is loopback-only).
QAAP_VPS_PUBLIC_URL=https://178.105.136.93.sslip.io
QAAP_VPS_SSH_KEY=<paste contents of $KEY_PATH>

CLI (repo owner only):

  gh secret set QAAP_VPS_HOST --body '178.105.136.93'
  gh secret set QAAP_VPS_USER --body 'root'
  gh secret set QAAP_VPS_SSH_PORT --body '22'
  gh secret set QAAP_VPS_REPO_DIR --body '/opt/qaap'
  gh secret set QAAP_VPS_PUBLIC_URL --body 'https://178.105.136.93.sslip.io'
  gh secret set QAAP_VPS_SSH_KEY < "$KEY_PATH"

=== 3) Cursor Cloud Agent secrets (optional — remote updates from chat) ===

QAAP_VPS_HOST=178.105.136.93
QAAP_VPS_SSH_KEY=<same private key PEM>

Then run: ./scripts/qaap-vps-remote-update.sh

=== 4) Test SSH ===

ssh -i "$KEY_PATH" root@178.105.136.93 'hostname && cd /opt/qaap && git rev-parse --short HEAD'

=== 5) Manual deploy trigger ===

GitHub → Actions → "Qaap VPS deploy" → Run workflow

EOF
