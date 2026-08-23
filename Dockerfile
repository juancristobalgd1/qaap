# Multi-stage image for the browser example (frontend + Node backend).
# Works on Railway, Fly.io, Hetzner, or any host with Docker.

# --- Build -------------------------------------------------------------------
FROM node:22-bookworm AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    pkg-config \
    libx11-dev \
    libxkbfile-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json lerna.json ./
COPY configs ./configs
COPY scripts ./scripts
COPY dev-packages ./dev-packages
COPY packages ./packages
COPY examples ./examples
COPY sample-plugins ./sample-plugins

ENV NODE_OPTIONS=--max_old_space_size=4096

RUN npm ci --include=optional

# @theia/cli bin/theia.js requires ../lib/theia (built by compile)
RUN npm run compile

RUN npm run download:plugins -- --rate-limit 5 --ignore-errors

WORKDIR /app/examples/browser
RUN npm run build:production && node scripts/copy-frontend-static.mjs

# --- Runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Connect the GHCR package to this repository and make the image provenance discoverable.
LABEL org.opencontainers.image.source="https://github.com/juancristobalgd1/qaap"

# QAIQ source. Default tracks `main`; the deploy script pins each build to the current main SHA via
# CACHE_BUST (below) so builds are reproducible AND never frozen. Override the ref with
# `--build-arg QAIQ_REF=<tag-or-branch>`.
ARG QAIQ_REPO=https://github.com/juancristobalgd1/qaiq.git
ARG QAIQ_REF=main
ARG CODEX_CLI_VERSION=0.144.5
ARG CLAUDE_CODE_VERSION=latest
ARG ANTIGRAVITY_CLI_VERSION=latest
ARG OPENCODE_CLI_VERSION=latest
ARG COPILOT_CLI_VERSION=latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    python3 \
    build-essential \
    ripgrep \
    # Headless Chromium for server-side visual evidence (QaapHeadlessVisualCaptureService).
    chromium \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10 --activate \
    && corepack prepare yarn@stable --activate \
    && npm install -g \
        @openai/codex@"${CODEX_CLI_VERSION}" \
        @anthropic-ai/claude-code@"${CLAUDE_CODE_VERSION}" \
        @sanchaymittal/antigravity-cli@"${ANTIGRAVITY_CLI_VERSION}" \
        opencode-ai@"${OPENCODE_CLI_VERSION}" \
        @github/copilot@"${COPILOT_CLI_VERSION}" \
    && npm install -g bun \
    && codex --version \
    && claude --version \
    && opencode --version \
    && copilot --version \
    && ln -sf "$(command -v ag)" /usr/local/bin/antigravity \
    && antigravity --version \
    && mkdir -p /opt/grok \
    && HOME=/opt/grok GROK_BIN_DIR=/opt/grok/bin bash -c 'curl -fsSL https://x.ai/cli/install.sh | bash' \
    && /opt/grok/bin/grok version

# QAIQ builds in its OWN layer so a deploy can pull a fresh `main` (or a pinned ref) without
# rebuilding the whole toolchain above, and so it is never silently frozen at the first build's
# commit (the RUN above stays cached; only this layer re-runs). Cached by (QAIQ_REF, CACHE_BUST) —
# the deploy script passes the current `main` SHA as CACHE_BUST, so it re-clones exactly when
# upstream advances. Manual force: --build-arg CACHE_BUST=$(date +%s).
ARG CACHE_BUST=unpinned
RUN git clone --depth 1 --branch "${QAIQ_REF}" "${QAIQ_REPO}" /opt/qaiq \
    && cd /opt/qaiq && bun install && bun run build \
    && ln -sf /opt/qaiq/bin/qaiq /usr/local/bin/qaiq \
    && ln -sf /opt/qaiq/bin/openclaude /usr/local/bin/openclaude \
    && qaiq --version \
    && openclaude --version

ENV PATH="/opt/grok/bin:/root/.local/bin:${PATH}" \
    QAAP_DEFAULT_AGENT=qaiq

WORKDIR /app/examples/browser

COPY --from=build /app /app

# Bundled slash skills (global for every tenant). User-specific skills live under
# /root/.qaap/users/{login}/skills on the qaap-auth-data volume.
COPY packages/qaap-product/resources/qaap-system-skills /opt/qaap/system-skills

# --- Agent privilege-drop (on by default via QAAP_AGENT_UID below) -------------
# The backend runs as root so it can spawn the agent under a non-root uid. A non-root agent cannot
# traverse the root-owned /root/{.qaap,.theia} trees where every tenant's API keys, OAuth tokens and
# helper tokens live — bounding the agent's --dangerously-skip-permissions to OS permissions.
# The image provisions the qaap-agent user (uid 1001) and owns /workspace + /home/qaap-agent by it, so
# the drop is safe to enable by default (see the QAAP_AGENT_UID ENV below). The backend additionally
# refuses to spawn the agent as root in a production runtime unless the drop is applied — see
# evaluateAgentIsolationPolicy in packages/qaap-cloud-workspace.
RUN groupadd --gid 1001 qaap-agent \
    && useradd --uid 1001 --gid 1001 --create-home --home-dir /home/qaap-agent --shell /usr/sbin/nologin qaap-agent \
    && chmod 700 /root \
    && chmod -R a+rX /opt/qaiq /opt/grok \
    && mkdir -p /workspace \
    && chown -R 1001:1001 /workspace /home/qaap-agent \
    # uid-per-user mode (QAAP_AGENT_UID_PER_USER=1): each tenant gets a private agent HOME under here.
    # 0711 root-owned lets a tenant uid enter its own 0700 subdir by name but not list sibling logins;
    # the root backend creates the per-tenant subdirs at spawn. No-op when the flag is off.
    && mkdir -p /home/qaap-tenants \
    && chmod 0711 /home/qaap-tenants \
    # The root backend runs git (status/stage/discard/commit/diff) on per-user repos that the agent
    # (uid 1001, or a per-tenant uid) owns after chown-on-spawn. Without this, git aborts every such
    # command with "detected dubious ownership", breaking the composer Accept/Discard/Commit and the
    # diff review. Root deliberately manages these repos, so trust them all.
    && git config --system --add safe.directory '*' \
    # Belt-and-suspenders identity so a tenant uid (even before its /etc/passwd record is written) can
    # `git commit` without "unable to look up current user in the passwd file". The backend writes a
    # real passwd record per tenant at spawn; this is the fallback.
    && git config --system user.name 'Qaap Agent' \
    && git config --system user.email 'agent@qaap.local'

ARG QAAP_IDE_PORT=4873
# Deployed-build identity: the short git SHA the image was built from. Surfaced via
# /qaap/api/auth/config and the Work Hub footer so "which build is serving?" is answerable
# at a glance; the deploy pipeline asserts it matches the pushed commit post-deploy.
ARG QAAP_BUILD_SHA=dev
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=${QAAP_IDE_PORT} \
    SHELL=/bin/bash \
    THEIA_SHELL=/bin/bash \
    QAAP_SYSTEM_SKILLS_DIR=/opt/qaap/system-skills \
    THEIA_PLUGINS_DIR=/app/plugins \
    QAAP_AGENT_HOME=/home/qaap-agent \
    QAAP_AGENT_UID=1001 \
    QAAP_AGENT_GID=1001 \
    QAAP_HEADLESS_CHROMIUM=/usr/bin/chromium \
    QAAP_BUILD_SHA=${QAAP_BUILD_SHA}

EXPOSE ${QAAP_IDE_PORT}

VOLUME ["/workspace"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD node -e "const p=process.env.PORT||4873;require('http').get('http://127.0.0.1:'+p+'/qaap/api/health',r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["sh", "-c", "exec node src-gen/backend/main.js \
    --hostname=${HOST} \
    --port=${PORT} \
    --no-cluster \
    --plugins=local-dir:${THEIA_PLUGINS_DIR} \
    --ovsx-router-config=/app/examples/ovsx-router-config.json"]
