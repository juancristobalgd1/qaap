# Qaap Security

## Estado de la implementación (2026-09-16)

La ruta completa de backend por tenant está implementada detrás de un gate explícito:

- `QAAP_BACKEND_PER_TENANT=1` y un `QAAP_TENANT_BACKEND_MASTER_SECRET` de al menos 32 caracteres son obligatorios antes de aceptar `QAAP_BETA_ALLOWED_LOGINS`.
- El control-plane conserva health, OAuth y admisión; el tráfico autenticado del IDE se enruta al backend Theia dedicado del tenant mediante una aserción HMAC de corta duración.
- La prueba local de dos tenants verificó contenedores, puertos y redes distintos, autenticación cruzada denegada, token interno de WebSocket y ausencia de cookies del tenant en el control-plane.
- El worker y el backend usan usuario no privilegiado, rootfs de sólo lectura, `no-new-privileges`, `CapDrop=ALL`, límites de recursos, mounts allowlisted y red dedicada.
- La suite enfocada de aislamiento terminó con **140 passing**; la imagen Docker compiló **101 proyectos**; `npm audit` y `npm audit --omit=dev` reportaron **0 vulnerabilidades conocidas**; el drift gate reportó **0 drift nuevo**.

Esto es evidencia de código y entorno local. La apertura pública sigue condicionada a la aceptación en VPS Linux con Docker rootless, TLS/OAuth reales, dos cuentas invitadas, backups off-site y los scripts de launch readiness descritos más abajo.

## Reporting a vulnerability

Please **do not** open a public issue, PR, or discussion for a suspected
vulnerability. Report it privately to the maintainer via a GitHub
[security advisory](https://github.com/juancristobalgd1/qaap/security/advisories/new)
so it can be triaged and fixed before disclosure. Include a concise
description, reproduction steps, and impact.

## Deployment security model (self-hosting)

Qaap runs a hosted agent (a CLI) that executes shell commands and edits files in
per-user workspaces. Understand the isolation model before exposing it publicly:

- **Single-user is still the simplest deployment.** One person on their own box
  does not need the worker orchestration overhead.
- **Multi-user requires the Docker worker mode and its control-plane prerequisite.**
  The default compose configuration enables a dedicated worker container per
  tenant. Before inviting other users you **must**:
  - Keep `QAAP_CLOUD_MODE=docker` and
    `QAAP_TENANT_CONTAINER_ISOLATION=1`. The lifecycle is fail-closed: the
    backend will not execute tenant code until `ensure → inspect → exec` has
    validated the worker.
  - Set `QAAP_TENANT_DOCKER_IMAGE` (or `QAAP_THEIA_IMAGE`) to the exact image
    containing the agent CLIs. The worker is not allowed to fall back to a
    bare `node` image in a hosted deployment.
  - Use a rootless Docker socket through `DOCKER_HOST`. Qaap rejects the
    rootful `/var/run/docker.sock`, TCP Docker endpoints, Windows named pipes and
    an unwired supervisor in hosted mode; putting the Theia process in a non-root
    Unix account does not remove the Docker-root-equivalent risk of a writable
    rootful socket.
    Configure `QAAP_DOCKER_SOCKET_SOURCE` and `QAAP_DOCKER_SOCKET_TARGET` to the
    same rootless socket path in Compose (normally `/run/user/1000/docker.sock`).
  - Keep the non-root agent drop enabled. The shipped image sets
    `QAAP_AGENT_UID=1001` (a provisioned `qaap-agent` user) **by default**, so the
    agent cannot read other tenants' secrets/tokens under the root-owned `/root`
    tree. As a backstop, the backend **refuses to spawn the agent as root in a
    production runtime** (`NODE_ENV=production` or a non-local `QAAP_CLOUD_MODE`).
    The hosted admission gate rejects the host fallback entirely, so the legacy
    root/shared-uid compatibility overrides are not a public multi-tenant escape hatch.
    See [doc/qaap-vps-deployment.md](doc/qaap-vps-deployment.md) for the
    verification steps.
  - Keep per-tenant CODE isolation enabled. In `docker-compose.yml`,
    `QAAP_AGENT_UID_PER_USER` defaults to **on** for local compatibility, but
    hosted admission rejects the host fallback and requires the Docker worker.
  - Keep `QAAP_TENANT_NETWORK_MODE=isolated-bridge` (the default). Qaap creates
    one managed bridge per tenant with inter-container communication disabled.
    Use `none` only when an external egress proxy is deliberately configured;
    shared `bridge`, `host` and `container:<id>` modes are rejected.
  - Serve over **HTTPS** and never set `QAAP_SKIP_AUTH` in production (it is
    refused in a production runtime, but do not rely on that alone).
  - Provide **your own** GitHub OAuth app credentials and VAPID keys — never
    reuse the placeholders in `*.env.example`, and never commit real secrets.
  - **Tenant code-worker isolation** is implemented by the Docker worker mode.
    For a public beta, also enable the complete backend-per-tenant router with
    `QAAP_BACKEND_PER_TENANT=1` and a random
    `QAAP_TENANT_BACKEND_MASTER_SECRET` of at least 32 characters. The outer
    Theia process then keeps only OAuth/health/admission control-plane routes;
    authenticated IDE HTTP/RPC/WebSocket traffic is routed to that user's own
    non-root backend container. The control-plane still owns operator records,
    billing/admission state and operational logs by design; do not expose those
    stores as tenant data. Authenticated task output and sensitive-file snapshots
    are physically stored below `~/.qaap/agent-tasks/owners/{login}/`.
    With the flag disabled, Qaap remains the hardened private hybrid mode and
    must not be advertised as public third-party isolation.
    Browser-visible filesystem/RPC boundaries are owner-scoped, and tenant
    containers receive only a short-lived tenant-bound HMAC assertion plus the
    user's GitHub token—not the shared session store, Docker socket, OAuth
    client secret or host keystore.
  - Serve previews from an **isolated site** with `QAAP_PREVIEW_BASE_DOMAIN`
    (wildcard DNS/TLS for `*.<domain>` to this server). Without it, previewed
    apps run under the IDE origin (`/qaap-preview/<id>/…`) where their JavaScript
    can call the Qaap API with the user's session cookie. The domain must be a
    different registrable domain than `QAAP_OAUTH_PUBLIC_URL`: a sibling
    subdomain is same-site, so the `SameSite=Lax` session cookie is still sent and
    the preview can set cookies on the shared parent. The launch gate refuses to
    accept third parties in `QAAP_BETA_ALLOWED_LOGINS` otherwise (logins listed in
    `QAAP_OPERATOR_LOGINS` do not count; `QAAP_PREVIEW_ALLOW_SAME_SITE=1`
    only overrides the heuristic for multi-label public suffixes such as `co.uk`).
    Independently of the domain, the preview proxy never forwards Qaap cookies or
    `x-qaap-*` headers to the dev server and drops `Set-Cookie` for Qaap cookie names.
  - The frontend-facing `EnvVariablesServer` filters secret-like variables and
    Docker control-plane settings in hosted mode; new sensitive environment
    variables must retain the same deny-list coverage.
  - Hosted execution never rewrites a shared host-side Antigravity/Gemini
    `settings.json` to select a tenant's model. Model/config state must be
    applied inside the tenant worker HOME; otherwise the task is not allowed to
    create a cross-tenant global settings race.

- **A tenant worker and a tenant backend are separate boundaries.** The
  complete backend-per-tenant path now exists, but is deliberately opt-in and
  fail-closed: the compiled product reports `per-tenant`, while the launch gate
  additionally requires `QAAP_BACKEND_PER_TENANT=1` and the 32-character master
  secret before accepting `QAAP_BETA_ALLOWED_LOGINS`. Do not treat the worker
  flag alone as sufficient. When backend-per-tenant is disabled, the hardened
  worker mode remains private/single-user or internal validation only because
  the shared Theia control-plane retains process-global state.

### Git-over-tenant-repo: hosted worker boundary closed; local fallback remains private-only

Every process that runs *tenant-controlled program code* — the agent, preview
dev server, terminal, and deploy build — drops to the tenant uid via
`setpriv --clear-groups`. The git checkpoint/restore in the conversation store
also drops (it runs checkout/add over the tenant repo). In the hosted worker
    container mode these operations are delegated into the tenant worker. The worker mounts only
    that tenant's repository root plus its tenant-segmented conversation-worktree and parallel-run
    roots; host paths are translated to `/workspace`, `/workspace/.qaap-worktrees`, and
    `/workspace/.qaap-parallel` before Git receives them. **The
legacy host fallback is rejected during hosted startup and remains only a local/private
compatibility path. It must not be enabled for public multi-tenancy.
git executes tenant-controlled hooks (`.git/hooks/*`) and clean/smudge/merge
**filter drivers** (`.git/config`, tenant-writable) during checkout/merge/add,
so running them as root is a root-RCE vector, and they leave root-owned files.

Current state of these paths:

- **`qaap-conversation-worktree.ts` ("New Worktree" `git worktree add`) — CLOSED.**
  Runs under the tenant uid via `QaapTenantSpawnService.wrapGitForTenant`
  (parent provisioned with `provisionTenantDir` first), so filters/hooks run as
  the tenant and the worktree is tenant-owned.
- **`qaap-parallel-run-store.ts` (parallel-run) — CLOSED.** Its worktrees were
  outside the isolation model (`{tmpdir}/qaap-parallel/{lower-cased login}`);
  unified onto `resolveQaapParallelRoot()` + `safeUserIdSegment` and taught to
  `resolveTenantIsolationRoot`, so parallel agents spawn under the flip and the
  mutating git (`worktree add` / `merge` / `add` / `commit`) runs under the tenant
  uid (`mutatingGit`). The base repo is provisioned before finalize so the shared
  `.git` is tenant-owned when the commit/merge write to it.
- **`qaap-github-oauth-endpoint.ts` (clone/fetch) — CLOSED.** In hosted mode both
  operations run through the tenant-process DI seam and Docker worker; host paths are
  translated to `/workspace` before Git receives them. Hooks/config execution is
  additionally hardened with `core.hooksPath=/dev/null`, `core.fsmonitor=false` and
  a minimal environment. The local fallback is private-development compatibility only.
- **`qaap-git-review-endpoint.ts` and workflow verification — CLOSED.** Git review,
  workflow diffs and `npm run` verification use the worker in hosted mode; missing worker
  binding fails closed. This includes stdin-based hunk application and the output/timeout
  controls.
- **Research and worktree Git — CLOSED.** Research bookkeeping is prepared against the
  tenant worker before its loop starts; `wrapGitForTenant` translates explicit `-C` paths
  into the tenant mount. New Worktree and parallel-run mutations use that same seam.

> [!IMPORTANT]
> **The uid-per-user drop is not verified on a real box by these unit tests.** It
> is no-op in dev/CI (not root, no `setpriv`, flag off), so tests only exercise the
> argv-shaping and fail-closed logic — NOT the actual privilege drop, ownership, or
> `setpriv`/`getpwuid` behavior under Linux. Before opening to real multiple tenants
> you MUST run `scripts/qaap-verify-multitenant.sh <login-A> <login-B>` on the VPS
> (after the two test tenants exercise agent + New Worktree + a parallel run); a
> green PASSED is the gate.
>
> Before the first public boot, also run `scripts/qaap-verify-launch-readiness.sh`
> and `scripts/qaap-verify-auth-api-gate.sh` against the live origin (the launch probe now also
> requires `/legal/terms.html` and `/legal/privacy.html`). Every VPS
> deploy now runs `scripts/qaap-vps-launch-gate.sh` (nightly backup cron + uid-per-user
> verification). A failed check or fewer than two provisioned test tenants now
> **blocks the beta release**. Provision two disposable invited GitHub accounts
> and exercise agent + New Worktree + parallel runs before declaring the release ready.
> Tenant evidence depends on the mode: with backend-per-tenant (`QAAP_BACKEND_PER_TENANT=1`) the
> gate counts distinct tenants with a Qaap-managed `qaap-backend-*` container in the tenant Docker
> daemon and verifies two of them with `scripts/qaap-tenant-backend-isolation-check.js` (labels,
> non-root or rootless-mapped uid, no capabilities/privileges, read-only rootfs, only that tenant's
> mounts, no Docker socket or control-plane secrets, no shared storage/network/secret); otherwise it
> reads the host-mode uid registry and runs `qaap-verify-multitenant.sh`.
> Production admission requires `QAAP_BETA_ALLOWED_LOGINS` (comma-separated GitHub
> logins). Empty or malformed lists deny all users, including restored sessions.
> Set the operator's login before deployment. Restart the backend after changing
> the list so existing WebSocket connections are also closed; this admission list
> does not cancel background jobs that were already running.
> Configure encrypted offsite copies via `/opt/qaap/.env.backup` — local tars do not survive disk loss.
> A production runtime without GitHub OAuth now **exits on
> startup**. There is no production authentication bypass; `QAAP_SKIP_AUTH` is local-development-only.

## Dependency audit notes

`npm audit --omit=dev` and the unfiltered `npm audit` both report **zero known
vulnerabilities** for the committed lockfile. Runtime dependency pins include
the patched releases of DOMPurify, js-yaml, fast-uri, Hono, Multer, qs,
adm-zip, fflate, Mermaid, and the SCANOSS integration. SCANOSS is pinned to
`0.40.2`; its nested `stream-json` and `tar` dependencies are overridden to
patched releases, and the runtime API is covered by the package test.

The unmaintained `decompress@4.2.1` package (GHSA-mp2f-45pm-3cg9,
hardlink/symlink path traversal during archive extraction) has been removed from
runtime dependencies. Plugin, VSIX, CLI, and remote-native extraction now use
`@theia/qaap-archive`, which parses ZIP/TAR/TGZ data and validates every entry
path, link target, parent realpath, and file write (`O_NOFOLLOW`) before writing.
`packages/qaap-archive/src/node/safe-archive-extractor.spec.ts` covers traversal,
TGZ filtering, and escaping symlinks; `scripts/qaap-archive-security-check.js`
also checks the security seam during installation.

**Defense-in-depth (untrusted archives):** runtime `local-file:` installs
(drag/drop VSIX, Install from VSIX, drop-in `~/.theia/.../extensions/*.vsix`)
are blocked by default via `QaapPluginServerImpl` +
`QaapPluginDeployerSecurityParticipant` in `@theia/qaap-product`. Marketplace
(`vscode-extension:`) and build-time `download-plugins` now use the same
validated extractor. Set `QAAP_ALLOW_LOCAL_VSIX=1` only when sideloading is
intentionally required in local desktop/dev; hosted/production runtimes ignore
that override because plugins execute in the shared Theia control-plane process.

Both audit modes are currently clean. Re-run `npm audit --omit=dev` and
`npm audit` after every dependency change; a clean audit does not replace the
tenant-isolation and live two-tenant checks described above.

If you find a gap in this model, report it privately as above.

---

# Eclipse Theia Vulnerability Reporting Policy

If you think or suspect that you have discovered a new security vulnerability
in this project, please __do not__ disclose it on GitHub, e.g. in an issue, a
PR, or a discussion. Any such disclosure will be removed/deleted on sight, to
promote orderly disclosure, as per the Eclipse Foundation Security Policy (1).

Instead, please report any potential vulnerability to the Eclipse Foundation [Security Team](https://www.eclipse.org/security/). Make sure to provide a concise description of the issue, a CWE, and other supporting information.

(1) _Eclipse Foundation Vulnerability Reporting Policy_:
[https://www.eclipse.org/security/policy.php](https://www.eclipse.org/security/policy.php)
