# Multi-stage image for the browser example (frontend + Node backend).
# Works on Railway, Fly.io, Hetzner, or any host with Docker.

# Base images are pinned by version and digest (enforced by scripts/qaap-dockerfile-base-pin-check.sh):
# a moving tag such as node:22-bookworm makes a rebuild of the same commit differ from the image
# CI built and verified. Bump a pin deliberately: resolve the new index digest, let the publish and
# verify jobs prove it, then deploy. These are the bases of the verified GHCR image for 3452a58d3.

# --- Layout for layer reuse ---------------------------------------------------
# The image is rebuilt and re-pulled on every deploy, so what does not change with the sources gets
# its own runtime layer:
#   manifests -> deps: package manifests only -> `npm ci` + theia-patch (node_modules, ~1.4 GB)
#   deps -> build:     sources -> postinstall, compile, plugins, production bundle (~400 MB)
# The runtime copies node_modules, /app/plugins and the rest of /app as three layers. A commit that
# only touches sources reuses the deps stage (CI caches it on its own scope, `--target deps`,
# mode=max; see qaap-vps-deploy.yml), and BuildKit keys COPY --from on file content, so unchanged
# plugins also reuse their layer: the VPS (host and rootless tenant daemons) downloads only the
# build layer.

# --- Dependency manifests ------------------------------------------------------
# Node 22.23.3 (bookworm), multi-arch index digest.
FROM node:22.23.3-bookworm@sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7 AS manifests

WORKDIR /src
COPY package.json package-lock.json lerna.json ./
COPY dev-packages ./dev-packages
COPY packages ./packages
COPY examples ./examples
COPY sample-plugins ./sample-plugins

# Workspace package.json files (workspaces: dev-packages/*, packages/*, examples/*,
# sample-plugins/*/*), the dev-package bins npm links into node_modules/.bin, and the theia-patch
# patches. The root postinstall needs the sources, so it is stripped here and runs in `build`.
# BuildKit keys the COPY --from below on content, not timestamps: an unchanged set of manifests is
# a cache hit even though this stage reruns on every commit.
RUN mkdir /manifests \
    && { printf '%s\n' package.json package-lock.json lerna.json dev-packages/cli/patches; \
         find dev-packages packages examples -mindepth 2 -maxdepth 2 -name package.json; \
         find sample-plugins -mindepth 3 -maxdepth 3 -name package.json; \
         find dev-packages -mindepth 2 -maxdepth 2 -name bin -type d; } \
        | sort | xargs cp -r --parents -t /manifests \
    && cd /manifests \
    && npm pkg delete scripts.postinstall

# --- Dependencies --------------------------------------------------------------
# Node 22.23.3 (bookworm), multi-arch index digest.
FROM node:22.23.3-bookworm@sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7 AS deps

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

ENV NODE_OPTIONS=--max_old_space_size=4096

COPY scripts/qaap-npm-ci-retry.sh ./scripts/qaap-npm-ci-retry.sh
COPY --from=manifests /manifests ./

# Whole-install retries on registry resets (scripts/qaap-npm-ci-retry.sh, also used by CI) and a
# BuildKit cache mount for the npm cache (never part of a layer). RUN --mount needs BuildKit, the
# default builder of `docker buildx`/Compose v2; its built-in Dockerfile frontend supports cache
# mounts, so no `# syntax=` line (that would pull an unpinned frontend image at build time).
# theia-patch is the only part of the root postinstall that edits node_modules, so it runs here and
# node_modules is final after this layer (it is idempotent when `build` runs the postinstall again).
RUN --mount=type=cache,target=/root/.npm \
    bash scripts/qaap-npm-ci-retry.sh --include=optional \
    && node dev-packages/cli/bin/theia-patch.js

# --- Build ---------------------------------------------------------------------
FROM deps AS build

COPY configs ./configs
COPY scripts ./scripts
COPY dev-packages ./dev-packages
COPY packages ./packages
COPY examples ./examples
COPY sample-plugins ./sample-plugins
# The real root package.json: the deps stage installed with its postinstall stripped.
COPY package.json ./package.json

RUN npm run postinstall

# @theia/cli bin/theia.js requires ../lib/theia (built by compile)
RUN npm run compile

RUN npm run download:plugins -- --rate-limit 5 --ignore-errors

WORKDIR /app/examples/browser
RUN npm run build:production && node scripts/copy-frontend-static.mjs

# Everything the runtime needs from this stage except the npm dependency trees (from the deps stage)
# and the plugins (their own layer), each excluded exactly where npm / download:plugins put them, so
# a plugin's own node_modules or a build output is never dropped.
RUN mkdir /app-out \
    && tar -C /app --anchored --no-wildcards-match-slash \
        --exclude=./node_modules \
        --exclude=./plugins \
        --exclude='./dev-packages/*/node_modules' \
        --exclude='./packages/*/node_modules' \
        --exclude='./examples/*/node_modules' \
        --exclude='./sample-plugins/*/*/node_modules' \
        -cf - . \
    | tar -C /app-out -xf -

# --- Runtime -----------------------------------------------------------------
# Python 3.12.15 (slim bookworm), multi-arch index digest.
FROM python:3.12.15-slim-bookworm@sha256:54c85f3c47607a77f32adec749d3c81d1348bf25833671f512b26a9b6d778cb3 AS python-runtime

# Node 22.23.3 (slim bookworm), multi-arch index digest of the Debian rebuild published on
# 2026-10-06 under node:22-bookworm-slim (the 22.23.3-bookworm-slim tag still names the older build).
FROM node:22.23.3-bookworm-slim@sha256:1b3abbc0bf2421c8733f58c6fd7bbb961a960f37e05ed7369eccd1fbb0edcc84 AS runtime

# Debian Bookworm's system Python is 3.11, but Qaap's backup restore guard uses
# tarfile.data_filter, which was introduced in Python 3.12. Copy the official
# Python runtime into the Node image so `python3` has the same safety contract
# in the deployed image and in the CI smoke verifier.
COPY --from=python-runtime /usr/local /usr/local

# Connect the GHCR package to this repository and make the image provenance discoverable.
LABEL org.opencontainers.image.source="https://github.com/juancristobalgd1/qaap"

# Agent upgrades are explicit release changes. QAIQ_COMMIT below is also read by CI.
ARG QAIQ_REPO=https://github.com/juancristobalgd1/qaiq.git
ARG CODEX_CLI_VERSION=0.144.5
ARG CLAUDE_CODE_VERSION=2.1.261
ARG COPILOT_CLI_VERSION=1.0.91
ARG ANTIGRAVITY_CLI_VERSION=0.1.1
ARG GEMINI_CLI_VERSION=0.62.0
ARG OPENCODE_CLI_VERSION=1.18.28
ARG PI_CLI_VERSION=1.4.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    docker.io \
    python3 \
    build-essential \
    acl \
    util-linux \
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
        @github/copilot@"${COPILOT_CLI_VERSION}" \
        @sanchaymittal/antigravity-cli@"${ANTIGRAVITY_CLI_VERSION}" \
        @google/gemini-cli@"${GEMINI_CLI_VERSION}" \
        opencode-ai@"${OPENCODE_CLI_VERSION}" \
        @earendil-works/pi-coding-agent@"${PI_CLI_VERSION}" \
    && npm install -g bun \
    && codex --version \
    && claude --version \
    && copilot --version \
    && opencode --version \
    && pi --version \
    && ln -sf "$(command -v ag)" /usr/local/bin/antigravity \
    && antigravity --version \
    && gemini --version \
    && python3 -c "import tarfile; assert hasattr(tarfile, 'data_filter')"
RUN setpriv --version >/dev/null && setfacl --version >/dev/null

# Fetch and verify the reviewed commit itself, rather than using its SHA only as a cache key.
ARG CACHE_BUST=unpinned
ARG QAIQ_COMMIT=2d62dc34938495010c87b34ce03f47931ab147ab
RUN test -n "${QAIQ_COMMIT}" \
    && echo "${QAIQ_COMMIT}" | grep -Eq '^[0-9a-f]{40}$' \
    && git init /opt/qaiq \
    && cd /opt/qaiq \
    && git remote add origin "${QAIQ_REPO}" \
    && git fetch --depth 1 origin "${QAIQ_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${QAIQ_COMMIT}" \
    && bun install --frozen-lockfile && bun run build \
    && ln -sf /opt/qaiq/bin/qaiq /usr/local/bin/qaiq \
    && ln -sf /opt/qaiq/bin/openclaude /usr/local/bin/openclaude \
    && qaiq --version \
    && openclaude --version

ENV PATH="/root/.local/bin:${PATH}" \
    QAAP_DEFAULT_AGENT=qaiq

# These executables are runtime dependencies of Jobs / Background tasks. Keep the image build
# fail-fast: a worker based on a partially built image must never reach a VPS and silently accept
# tasks without a coding harness.
RUN for harness in qaiq openclaude codex claude opencode antigravity; do \
        command -v "$harness" >/dev/null 2>&1 \
            || { echo "Required Qaap harness is missing: $harness" >&2; exit 1; }; \
    done

# `gh` for projects. It carries no credential: agents never receive the user's GitHub token (see
# doc/qaap-github-token-boundary.md); a user who wants `gh` in a terminal signs it in themselves.
ARG GH_CLI_VERSION=2.102.0
ARG GH_CLI_SHA256_AMD64=bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386
ARG GH_CLI_SHA256_ARM64=7862c86c72f43df3a2d93ddde6f473285b4e2af61b494849846827e513ef6484
ARG TARGETARCH
RUN arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && case "$arch" in amd64) sha="${GH_CLI_SHA256_AMD64}" ;; arm64) sha="${GH_CLI_SHA256_ARM64}" ;; *) echo "Unsupported gh arch: $arch" >&2; exit 1 ;; esac \
    && curl -fsSL -o /tmp/gh.tar.gz "https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_${arch}.tar.gz" \
    && echo "${sha}  /tmp/gh.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/gh.tar.gz -C /usr/local --strip-components=1 "gh_${GH_CLI_VERSION}_linux_${arch}/bin/gh" \
    && rm /tmp/gh.tar.gz \
    && gh --version

WORKDIR /app/examples/browser

# Three layers, most stable first: npm dependencies, plugins, then this commit's sources and build.
COPY --from=deps /app /app
COPY --from=build /app/plugins /app/plugins
COPY --from=build /app-out /app

# Bundled slash skills (global for every tenant, read-only at runtime). User-specific skills live
# under /home/theia/.qaap/users/{login}/skills on the qaap-auth-data volume.
COPY packages/qaap-product/resources/qaap-system-skills /opt/qaap/system-skills

# --- Agent privilege-drop (on by default via QAAP_AGENT_UID below) -------------
# The backend intentionally runs as non-root. In hosted Docker mode, tenant worker containers are
# the execution boundary and start the agent as their configured non-root uid. The image still
# provisions qaap-agent (uid 1001) for local compatibility; hosted startup refuses the host
# fallback and refuses a root agent — see evaluateAgentIsolationPolicy.
RUN groupadd --gid 1001 qaap-agent \
    && useradd --uid 1001 --gid 1001 --create-home --home-dir /home/qaap-agent --shell /usr/sbin/nologin qaap-agent \
    && chmod 700 /root \
    && chmod a+rX /opt/qaiq \
    && mkdir -p /workspace \
    && chown -R 1001:1001 /workspace /home/qaap-agent \
    # uid-per-user mode (QAAP_AGENT_UID_PER_USER=1): each tenant gets a private agent HOME under here.
    # 0711 root-owned lets a tenant uid enter its own 0700 subdir by name but not list sibling logins;
    # the privileged host-fallback backend creates the per-tenant subdirs at spawn. No-op in worker
    # container mode, where the container boundary provides the primary isolation.
    && mkdir -p /home/qaap-tenants \
    && chmod 0711 /home/qaap-tenants \
    && mkdir -p /tmp/qaap-worktrees /tmp/qaap-parallel \
    && chmod 0711 /tmp/qaap-worktrees /tmp/qaap-parallel \
    # The legacy host-fallback backend may run git (status/stage/discard/commit/diff) on per-user
    # repos that the agent owns after chown-on-spawn. Without this, git aborts with "detected dubious
    # ownership", breaking the composer Accept/Discard/Commit and the diff review. Worker mode routes
    # tenant git through docker exec instead.
    && git config --system --add safe.directory '*' \
    # Belt-and-suspenders identity so a tenant uid (even before its /etc/passwd record is written) can
    # `git commit` without "unable to look up current user in the passwd file". The backend writes a
    # real passwd record per tenant at spawn; this is the fallback.
    && git config --system user.name 'Qaap Agent' \
    && git config --system user.email 'agent@qaap.local' \
    && (id -u node >/dev/null 2>&1 && usermod -l theia -d /home/theia -m node || useradd -u 1000 -m -s /bin/bash theia) \
    && (getent group node >/dev/null 2>&1 && groupmod -n theia node || true) \
    && mkdir -p /home/theia/.theia /home/theia/.qaap \
    && chown -R 1000:1000 /home/theia /workspace 2>/dev/null || true \
    # Files copied into the runtime image already have the standard 0644/0755
    # permissions needed by the non-root Theia user. Avoid recursively touching
    # the dependency trees here: on large deployments that turns image export
    # into a multi-minute metadata-only operation.
    && chmod a+rX /opt/qaiq /app

ARG QAAP_IDE_PORT=4873
# Deployed-build identity: the short git SHA the image was built from. Surfaced via
# /qaap/api/auth/config and the Work Hub footer so "which build is serving?" is answerable
# at a glance; the deploy pipeline asserts it matches the pushed commit post-deploy.
ARG QAAP_BUILD_SHA=dev
ENV NODE_ENV=production \
    HOME=/home/theia \
    USER=theia \
    LOGNAME=theia \
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

# The probe exits on its own after 4 s: Docker's --timeout does not always kill a hung exec (rootless
# daemon, paused upstream), and every leftover node process held threads against the PidsLimit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD node -e "const p=process.env.PORT||4873;require('http').get('http://127.0.0.1:'+p+'/qaap/api/health',r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1)).setTimeout(4000,()=>process.exit(1))"

USER theia

CMD ["sh", "-c", "exec node src-gen/backend/main.js \
    --hostname=${HOST} \
    --port=${PORT} \
    --no-cluster \
    --plugins=local-dir:${THEIA_PLUGINS_DIR} \
    --ovsx-router-config=/app/examples/ovsx-router-config.json"]
