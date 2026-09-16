# @theia/qaap-cloud-workspace

Cloud workspace for Qaap (browser/VPS + optional Electron dev containers).

## Docker orchestrator (`QAAP_CLOUD_MODE=docker`)

When set, Qaap creates or starts a **hardened Docker worker per authenticated tenant** and routes
agent, preview, deploy, job, and terminal execution through that worker. The worker receives only
the canonical tenant root as `/workspace`; it is non-root, resource-limited, drops all capabilities,
uses a read-only root filesystem, is attached to a dedicated tenant network with ICC disabled, and
is inspected before reuse. Hosted startup refuses the legacy host fallback.

```bash
export QAAP_CLOUD_MODE=docker
export QAAP_THEIA_IMAGE=qaap-theia:immutable-tag
# Hosted mode requires a rootless socket; rootful /var/run/docker.sock is rejected.
export DOCKER_HOST=unix:///run/user/1000/docker.sock
# Compose must bind the same rootless socket path into theia.
export QAAP_DOCKER_SOCKET_SOURCE=/run/user/1000/docker.sock
export QAAP_DOCKER_SOCKET_TARGET=/run/user/1000/docker.sock
export QAAP_TENANT_NETWORK_MODE=isolated-bridge
```

The shared Docker `bridge`, `host`, `container:<id>` and rootful socket modes are rejected in
hosting. Set `QAAP_TENANT_NETWORK_MODE=none` only when provider egress is supplied through an
external proxy.

Workspace records include `containerRef` (Docker container id).

## Backend Theia por tenant

El worker de código y el backend Theia son límites separados. Para ofrecer Qaap a
terceros se debe activar también el router de backend por tenant:

```bash
export QAAP_BACKEND_PER_TENANT=1
export QAAP_TENANT_BACKEND_MASTER_SECRET="$(openssl rand -hex 32)"
export QAAP_BETA_ALLOWED_LOGINS="alice,bob"
```

El control-plane mantiene únicamente health, OAuth y admisión. Las peticiones
autenticadas HTTP/RPC/WebSocket se enrutan al backend del login correspondiente.
Cada backend valida una aserción HMAC de corta duración y recibe un token interno
de BrowserConnection sólo para su propia conexión. Si falta el flag, el secreto,
el worker o el wiring del proxy, el arranque hospedado falla cerrado.

La prueba local de dos tenants confirmó contenedores, puertos y redes distintos y
rechazo de autenticación cruzada. La validación de producción requiere además
`scripts/qaap-vps-launch-gate.sh` y `scripts/qaap-verify-multitenant.sh` en un VPS
Linux con Docker rootless.

## Validación local

Desde la raíz del repositorio:

```bash
npm run compile
node scripts/qaap-drift-check.js
npm audit --omit=dev
docker compose config --quiet
```

La suite de aislamiento y los tests del orchestrator deben ejecutarse después de
compilar y antes de declarar un despliegue listo. No se deben versionar los
directorios `.qaap-it-data/`, que son artefactos runtime de pruebas.

## Electron + dev-container

Command **Open in Qaap Cloud Container** (`qaap.cloud.openInDevContainer`) writes `.devcontainer/devcontainer.json` if missing, then runs `dev-container:reopen-in-container`.

Requires Electron app with `@theia/dev-container` and `@theia/remote` (e.g. `examples/electron`).

## Deploy CLI (server-side)

| Endpoint | Description |
|----------|-------------|
| `POST /qaap/api/cloud/deploy/run` | Runs `vercel deploy` or `wrangler pages deploy` in `workspaceRoot` with env from deploy-env store |

Agent tools `qaap_deploy_vercel` / `qaap_deploy_cloudflare` call this endpoint (not hints only).

## Web Push (server subscriptions)

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Set on the backend:

```bash
export QAAP_VAPID_PUBLIC_KEY=...
export QAAP_VAPID_PRIVATE_KEY=...
export QAAP_VAPID_SUBJECT=mailto:you@example.com
```

3. Browser registers via service worker `pushManager.subscribe` → `POST /qaap/api/cloud/push/subscribe`
4. Events trigger `POST /qaap/api/cloud/push/notify` (build failed, agent completed)

PWA service worker includes `push` / `notificationclick` handlers (see `FrontendGenerator.compileServiceWorker`).

## Other env

- `QAAP_CLOUD_MODE=local` — local-sandbox metadata only (default)
- `QAAP_AGENT_MEMORY_LIMIT` — Linux host memory ceiling for every workspace child process
  (default `2GiB`; supports `MiB`/`GiB` values). Host production mode requires `systemd-run` so the
  limit is enforced by a cgroup and covers the complete descendant tree.
- `QAAP_AGENT_CPU_LIMIT` — Linux host CPU quota in cores (default `2`; percentages such as `150%`
  are also accepted). On a local Linux host without systemd, bounded rlimits are used as a fallback;
  production fails closed instead of launching an unbounded process.
- `QAAP_TENANT_MEMORY_LIMIT` / `QAAP_TENANT_CPU_LIMIT` — optional Docker worker limits (bytes and
  cores respectively); these are also accepted as host-limit fallbacks for deployment consistency.
- `QAAP_OAUTH_PUBLIC_URL` — canonical Qaap application origin (also the trusted parent of preview iframes)
- `QAAP_PREVIEW_BASE_DOMAIN` — optional isolated preview domain, for example `preview.qaap.example`.
  Configure wildcard DNS/TLS (`*.preview.qaap.example`) to the Qaap backend. Each execution then
  opens on `https://<previewId>.preview.qaap.example/` using a host-only, per-preview capability;
  the GitHub/IDE session cookie is never shared with project code. Without it, Qaap uses the
  compatibility path `/qaap-preview/<previewId>/` on the application origin.
