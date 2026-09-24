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

### Pool de Docker remoto

Para repartir tenants entre varias máquinas, el mismo `QaapDockerOrchestrator` acepta un pool de
daemons. La asignación usa rendezvous hashing por login, por lo que añadir un nodo mueve sólo los
tenants cuyo nodo ganador cambia; `docker exec`, `stop`, `destroy` y el reaper usan el nodo correcto.
Los endpoints remotos requieren TLS verificado y certificados de cliente (`ca.pem`, `cert.pem` y
`key.pem`):

```bash
export QAAP_CLOUD_MODE=docker
export QAAP_DOCKER_NODES='[
  {"id":"worker-a","dockerHost":"tcp://docker-a.internal:2376","advertiseHost":"10.0.0.11","publishHostIp":"10.0.0.11","certPath":"/etc/qaap/docker/worker-a","tlsVerify":true},
  {"id":"worker-b","dockerHost":"tcp://docker-b.internal:2376","advertiseHost":"10.0.0.12","publishHostIp":"10.0.0.12","certPath":"/etc/qaap/docker/worker-b","tlsVerify":true}
]'
```

`advertiseHost` es la dirección que el control plane usa para alcanzar el backend Theia publicado
en el nodo. `publishHostIp` debe ser una interfaz privada protegida por firewall, nunca una dirección
pública sin restricciones. En modo `QAAP_BACKEND_PER_TENANT=1`, `publishHostIp` es obligatorio para
un nodo TCP remoto; configura también `advertiseHost` explícitamente cuando difiera del host del
endpoint Docker.

Todos los nodos deben ver el almacenamiento persistente de cada tenant con las mismas rutas
canónicas (NFS/Ceph suele ser lo más sencillo). Si el prefijo remoto difiere del del control plane,
se pueden definir `QAAP_DOCKER_REMOTE_REPOS_ROOT`, `QAAP_DOCKER_REMOTE_WORKTREES_ROOT`,
`QAAP_DOCKER_REMOTE_PARALLEL_ROOT` y `QAAP_DOCKER_REMOTE_TENANT_CONFIG_ROOT`. Estas variables sólo
traducen la ruta del bind mount; no sincronizan datos ni sustituyen un volumen compartido.

El arranque hospedado rechaza cualquier nodo TCP sin TLS verificado, certificado de cliente o
daemon rootless. Para un despliegue Kubernetes, esta API queda como seam de sustitución: el futuro
adaptador debe conservar el mismo aislamiento por tenant y el contrato de almacenamiento compartido.

## Tenant runtime reaper (FinOps)

The reaper treats the worker and the per-tenant Theia backend as one ephemeral runtime. It is
enabled by default when Docker mode is active (set `QAAP_TENANT_REAPER_ENABLED=false` to disable).
It records activity in the tenant-scoped SQLite state, stops idle containers to release RAM, and
destroys them after a retention window without deleting the persistent tenant workspace. A request
to the worker or backend recreates/starts the runtime through the existing single-flight ensure path.

```bash
export QAAP_TENANT_REAPER_ENABLED=true
export QAAP_TENANT_IDLE_TIMEOUT_MS=1800000       # 30 minutes
export QAAP_TENANT_DESTROY_AFTER_MS=86400000     # 24 hours after stop
export QAAP_TENANT_REAPER_INTERVAL_MS=300000     # 5 minutes
```

The control-plane endpoints are:

- `POST /qaap/api/cloud/runtime/activity` — authenticated activity heartbeat.
- `GET /qaap/api/cloud/runtime/status` — current tenant lifecycle state.
- `POST /qaap/api/cloud/runtime/wake` — explicitly wake the tenant runtime.
- `GET /qaap/api/cloud/runtime/metrics` — process-local reaper and cold-start counters.

Only containers carrying Qaap management labels are eligible. Unknown containers and tenant bind
mounts are never removed. `stop` is used instead of Docker `pause` because the FinOps goal is to
release memory, not only CPU.

## Observabilidad y auditoría estructurada

El backend emite un objeto JSON por línea para cada evento de auditoría mediante Winston. Los
eventos `session.started`, `agent.command.started`, `agent.command.finished`,
`agent.tool.command` y `quota.consumption` incluyen tenant, ids de sesión/tarea, resultado,
duración y hash SHA-256 de la orden. Las órdenes de herramientas se registran redactadas para no
persistir tokens o contraseñas; los prompts no se almacenan como texto completo.

```bash
export QAAP_AUDIT_LOG_ENABLED=true       # false desactiva la emisión
export QAAP_AUDIT_LOG_LEVEL=info         # info, warn o error
export QAAP_AUDIT_LOG_PATH=/var/log/qaap/audit.jsonl  # opcional; consola sigue activa
```

Si el proceso se ejecuta con un SDK de OpenTelemetry, las entradas heredan `traceId` y `spanId`
del contexto activo y los débitos de cuota crean spans `qaap.quota.hosted_debit` y
`qaap.quota.runtime_debit`. Esto permite reenviar la consola JSON a un colector central sin
acoplar el paquete a un proveedor concreto.

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

Timeouts del router y de la preparación de repositorios (todos en milisegundos, opcionales):

- `QAAP_TENANT_ENSURE_TIMEOUT_MS` — espera máxima para arrancar/validar el contenedor o backend de un
  tenant (por defecto `180000`).
- `QAAP_TENANT_BACKEND_READY_TIMEOUT_MS` — espera al health del backend recién arrancado (por defecto `30000`).
- `QAAP_TENANT_PROXY_IDLE_TIMEOUT_MS` — presupuesto por petición HTTP proxificada: arranque en frío más
  espera de cabeceras; al agotarse responde `504` y cierra la petición al backend (por defecto `180000`).
  El navegador espera 210 s en abrir/clonar/crear repositorio, por encima de este valor.
- `QAAP_TENANT_PROXY_WS_CONNECT_TIMEOUT_MS` — límite sólo del handshake WebSocket hacia el backend
  (por defecto `15000`); la conexión establecida no tiene límite.
- `QAAP_GITHUB_API_TIMEOUT_MS` — límite por llamada a la API REST / OAuth de GitHub, cabeceras y cuerpo
  incluidos (por defecto `30000`).

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
