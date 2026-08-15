# QAAP on a VPS (Hetzner and similar)

Deploy the browser IDE with **QAIQ** (`@qaiq`) as the default background coding agent on a
single Docker host (Hetzner CX/CPX, Contabo, etc.).

## Requirements

- Ubuntu 22.04+ (or Debian bookworm) on the VPS
- Docker Engine + Docker Compose v2
- At least **4 GB RAM** for the container (`docker-compose.yml` limit); **8 GB** recommended if
  you run heavy `@qaiq` jobs on large repos
- One **provider API key** (OpenRouter, Gemini, NVIDIA NIM, OpenAI, Anthropic, or Ollama on
  the host)

## Quick start

On the VPS:

```bash
sudo apt-get update && sudo apt-get install -y git docker.io docker-compose-plugin
sudo usermod -aG docker "$USER"   # re-login once

git clone https://github.com/juancristobalgd1/qaap.git /opt/qaap
cd /opt/qaap
cp .env.docker.example .env
```

Edit `.env`:

| Variable | Example | Purpose |
|----------|---------|---------|
| `THEIA_PORT` | `4873` | Port published to the internet |
| `QAAP_OAUTH_PUBLIC_URL` | `http://203.0.113.10:4873` | Public URL (OAuth + dev preview) |
| `QAAP_GITHUB_CLIENT_ID` / `SECRET` | from GitHub OAuth app | Login (or `QAAP_SKIP_AUTH=true` for private labs) |
| `OPENROUTER_API_KEY` | `sk-or-…` | Powers `@qaiq` when no model is set in Settings |
| `QAAP_DEFAULT_AGENT` | `qaiq` | Default agent (already the image default) |
| `CODEX_CLI_VERSION` | `0.144.5` | Codex CLI version for a source build |
| `CLAUDE_CODE_VERSION` | `latest` | Claude Code CLI version for a source build |
| `ANTIGRAVITY_CLI_VERSION` | `latest` | Antigravity CLI version for a source build |
| `OPENCODE_CLI_VERSION` | `latest` | OpenCode CLI (`opencode-ai`) version for a source build |
| `COPILOT_CLI_VERSION` | `latest` | GitHub Copilot CLI (`@github/copilot`) installed during Docker build |

Open the firewall port (example with UFW):

```bash
sudo ufw allow 4873/tcp
sudo ufw enable
```

Build and run:

```bash
docker compose up --build -d
docker compose logs -f theia   # wait for "Configuration directory URI"
```

Open `http://<your-vps-ip>:4873`.

## Updating an existing VPS

After new commits land on GitHub:

```bash
cd /opt/qaap
./scripts/qaap-vps-update.sh
```

Deploy a feature branch (e.g. before merge to `master`):

```bash
./scripts/qaap-vps-update.sh --branch cursor/agent-trace-cursor-parity-ae9f
```

Force Docker to re-resolve `latest` CLI pins:

```bash
./scripts/qaap-vps-update.sh --no-cache
```

Manual equivalent:

```bash
git fetch origin
git checkout master && git pull --ff-only origin master
docker compose up --build -d
docker compose logs -f theia
```

## Automated deploy (GitHub Actions + GHCR)

One-time setup on your laptop:

```bash
./scripts/qaap-vps-setup-deploy-key.sh ~/.ssh/qaap-vps-deploy
```

Follow the printed steps:

1. **VPS** — append the generated **public** key to `~/.ssh/authorized_keys` on the server.
2. **GitHub** — add repository secrets (Settings → Secrets and variables → Actions):

| Secret | Example |
|--------|---------|
| `QAAP_VPS_HOST` | `178.105.136.93` |
| `QAAP_VPS_USER` | `root` |
| `QAAP_VPS_SSH_KEY` | contents of `~/.ssh/qaap-vps-deploy` (private key) |
| `QAAP_VPS_SSH_PORT` | `22` (optional) |
| `QAAP_VPS_REPO_DIR` | `/opt/qaap` (optional) |
| `QAAP_VPS_PUBLIC_URL` | `https://178.105.136.93.sslip.io` (health check / monitor — Caddy HTTPS, not `:4873`) |

3. **Cursor Cloud Agent** (optional) — same `QAAP_VPS_HOST` + `QAAP_VPS_SSH_KEY` as agent secrets so chat can run `./scripts/qaap-vps-remote-update.sh`.

After secrets exist:

- Every push to **`master`** (except docs-only) runs **Actions → Qaap VPS deploy**.
- The workflow runs the Rioja smoke gate, builds the production image once on GitHub's runner,
  pushes a private SHA-tagged image to GHCR, and deploys its immutable digest on the VPS.
- CI uses the version defaults committed in `Dockerfile`; VPS `.env` build arguments apply only to
  the documented source-build fallback.
- The deploy job lends its short-lived `GITHUB_TOKEN` to the SSH process only for `docker pull`,
  then logs out from GHCR. No persistent GHCR PAT is required on the VPS.
- Manual run: **Actions → Qaap VPS deploy → Run workflow** (pick branch / `--no-cache`).
- **Skip the pre-deploy smoke gate** is an emergency-only input. Use it when the
  Rioja gate is queued or blocked and a hotfix must reach the VPS. Publish still
  runs if the gate is skipped or cancelled. In-flight deploys are not cancelled
  when a newer `master` push starts.

The GHCR package remains private by default. Keep it private: the runtime image contains the built
application and source tree. GitHub links the package to this repository through the
`org.opencontainers.image.source` label.

Remote update from your machine:

```bash
export QAAP_VPS_HOST=178.105.136.93
export QAAP_VPS_SSH_KEY_FILE=~/.ssh/qaap-vps-deploy
./scripts/qaap-vps-remote-update.sh
```

## What the image includes

The runtime stage of `Dockerfile` installs:

- **QAIQ** → `/usr/local/bin/qaiq` (built from `github.com/juancristobalgd1/qaiq`)
- **Codex CLI** → `codex` (`@openai/codex`)
- **Claude Code** → `claude` (`@anthropic-ai/claude-code`)
- **Antigravity CLI** → `antigravity` (installed from `@sanchaymittal/antigravity-cli` with `antigravity` alias)
- **OpenCode** → `opencode` (`opencode-ai`)
- **GitHub Copilot CLI** → `copilot` (`@github/copilot`)
- **Grok Build** → `/opt/grok/bin/grok` (`curl -fsSL https://x.ai/cli/install.sh | bash`)
- `git`, `curl`, `bun`, `pnpm`, `yarn`, `build-essential`, `ripgrep` for agent shell work

At container start, the backend logs detected agents, for example:

```text
[qaap-agent-tasks] detected agents: qaiq, grok
[qaap-agent-tasks] qaiq: 0.15.0-qaap.1 (QAIQ)
```

## API keys: `.env` vs Settings → AI

Background jobs read credentials in this order:

1. **Environment variables** in `.env` / `docker-compose` (recommended on VPS)
2. **Theia user preferences** under `/root/.theia` (persisted via volume `qaap-theia-user`)

Set at least one key in `.env` before relying on `@qaiq`. Without a key, task creation fails
with a clear error instead of hanging on Anthropic OAuth.

OpenRouter example in `.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Gemini:

```bash
GEMINI_API_KEY=...
```

## Using `@qaiq` on the VPS

1. Open or clone a project into `/workspace` (default Docker volume).
2. In chat: `@qaiq Explain what this repo does using README and package.json only. Do not run tests.`
3. Track long jobs under **Jobs / Background tasks**.

Tips:

- Prefer **read-only prompts** for questions; avoid `npm test` unless you need it (failed tests
  trigger QAIQ’s “repeated tool failures” guard after three Bash errors).
- For Theia monorepos: run `npm run compile` before `npm test`.
- QAIQ in the container uses `--dangerously-skip-permissions` (single-tenant VPS).

## Ollama on the host

If Ollama runs on the VPS **outside** Docker, point the container at the host gateway:

```bash
# Linux (Docker 20.10+)
OLLAMA_HOST=http://host.docker.internal:11434
```

Add to `docker-compose.yml` under `theia`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

## Verify agent CLIs inside the running container

```bash
docker compose exec theia qaiq --version
docker compose exec theia codex --version
docker compose exec theia claude --version
docker compose exec theia antigravity --version
docker compose exec theia opencode --version
docker compose exec theia copilot --version
docker compose exec theia which qaiq grok codex claude antigravity opencode copilot
docker compose exec theia grok version
docker compose logs theia 2>&1 | grep 'qaap-agent-tasks'
```

## Build args (optional)

Pin the QAIQ fork revision:

```bash
docker compose build --build-arg QAIQ_REF=v0.15.0-qaap.1
```

Pin agent CLI versions for reproducible source builds. Codex is deliberately pinned because a
cached Docker layer cannot detect that the npm dist-tag `latest` moved:

```bash
CODEX_CLI_VERSION=0.144.5
CLAUDE_CODE_VERSION=2.1.159
ANTIGRAVITY_CLI_VERSION=latest
```

If you are rebuilding an existing VPS image and want Docker to re-resolve `latest`, rebuild
without cache:

```bash
docker compose build --no-cache theia
docker compose up -d
```

## HTTPS (required for any external user)

`docker-compose.yml` ships a **Caddy** service on `:80`/`:443`. Theia binds only to
`127.0.0.1:4873` on the host.

Without a custom domain, use [sslip.io](https://sslip.io) for the VPS IP:

```bash
# /opt/qaap/.env
QAAP_PUBLIC_HOST=178.105.136.93.sslip.io
QAAP_OAUTH_PUBLIC_URL=https://178.105.136.93.sslip.io
```

Then:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw delete allow 4873/tcp   # stop exposing raw Theia
docker compose up -d caddy theia
```

Update the GitHub OAuth app callback to
`https://<QAAP_PUBLIC_HOST>/qaap/oauth/github/callback`.

Caddy obtains a Let’s Encrypt certificate for the sslip.io hostname automatically.
If you later buy a real domain, point DNS at the VPS and change `QAAP_PUBLIC_HOST`.

Set the GitHub Actions secret `QAAP_VPS_PUBLIC_URL` to that same HTTPS origin
(`https://178.105.136.93.sslip.io`). Do **not** use `:4873` — that port is loopback-only
behind Caddy, so deploy health checks and the VPS monitor will fail. Workflows rewrite a
stale `:4873` secret as a safety net (`scripts/qaap-vps-normalize-public-url.sh`), but the
secret itself should still be rotated.

## Hardening the agent for multi-tenant use (non-root privilege drop)

By default the hosted backend stays root so it can allocate isolated tenant identities, while each
agent runs under a persistent **per-user non-root uid** (`QAAP_AGENT_UID_PER_USER=1`). The normal
“Approve for me” policy keeps QAIQ shell calls behind Qaap's stdio control; only an explicit
“Full access” turn uses the CLI permission bypass. This prevents one tenant from reading another
tenant's code or root-owned secrets and lets Qaap reject global process kills before execution.

The image also ships a shared fallback `qaap-agent` user (uid 1001) and locks `/root` to `0700`.
Keep per-user uid isolation enabled for hosted deployments. Only use the shared fallback on an
explicitly single-user box, and verify it before opting out:

1. Build/pull the new image and set in your VPS `.env`:
   ```
   QAAP_AGENT_UID_PER_USER=0
   QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION=true
   QAAP_AGENT_UID=1001
   QAAP_AGENT_GID=1001
   ```
2. If your `/workspace` volume predates this image it is still root-owned — chown it once so the
   non-root agent can write:
   ```
   docker compose exec theia chown -R 1001:1001 /workspace
   ```
3. `docker compose up -d` and verify inside the container:
   ```
   # the agent process should run as uid 1001, not 0
   docker compose exec theia sh -c 'ps -o uid,cmd -C qaiq'
   # the agent user must NOT be able to read tenant secrets
   docker compose exec -u 1001 theia sh -c 'cat /root/.qaap/* 2>&1 | head'   # expect: Permission denied
   # the agent user MUST be able to write its workspace
   docker compose exec -u 1001 theia sh -c 'touch /workspace/.__perm_test && rm /workspace/.__perm_test && echo OK'
   ```
4. Run a real agent task end-to-end (edit a file, run the dev server) to confirm nothing regressed.
   If a CLI complains it can't write its config, confirm `QAAP_AGENT_HOME=/home/qaap-agent` is set.

> The shared fallback isolates root-owned secrets but does not isolate code between users. The
> default per-user uid mode is required for a public deployment.

## Backups

The deployment's state lives in three docker volumes; **without backups a bad deploy, a destructive
agent run, or an operator mistake loses every user's repositories and sessions**:

| Volume | Mounted at | Holds |
|---|---|---|
| `theia-workspace` | `/workspace` | user repositories, `.qaap/uid-registry.json`, project sessions |
| `qaap-auth-data` | `/root/.qaap` | OAuth sessions, agent-task index/logs, conversations, helper tokens |
| `qaap-theia-user` | `/root/.theia` | per-user settings, incl. Settings → AI API keys |

**Install the nightly backup (one-time, as root on the VPS):**

```bash
echo '17 3 * * * root /opt/qaap/scripts/qaap-vps-backup.sh >> /var/log/qaap-backup.log 2>&1' \
  > /etc/cron.d/qaap-backup
/opt/qaap/scripts/qaap-vps-backup.sh   # run once now and check the output
```

Archives land in `/var/backups/qaap/qaap-<UTC timestamp>.tar.gz` (`QAAP_BACKUP_DIR` to change),
keeping the newest 7 (`QAAP_BACKUP_KEEP`). `node_modules` are excluded — reinstallable, and they
dominate the size otherwise.

**Restore** (container stopped or fresh):

```bash
cd /opt/qaap && docker compose stop theia
docker run --rm --volumes-from "$(docker compose ps -aq theia)" \
  -v /var/backups/qaap:/backup busybox \
  tar xzf /backup/qaap-<STAMP>.tar.gz -C /
docker compose start theia
```

To restore a single user's repo or one JSON store, extract selectively with
`tar xzf … -C / workspace/repos/users/<login>` etc.

> **Local tars do not survive disk loss.** Pair them with the provider's snapshot feature (Hetzner
> backups ≈ 20% of the server price) or sync `/var/backups/qaap` offsite (rclone/restic to any
> object storage).

## Related docs

- [qaap-background-agents.md](./qaap-background-agents.md) — agent templates, `QAAP_AGENT_COMMANDS`, custom providers
