# Qaap Security

## Reporting a vulnerability

Please **do not** open a public issue, PR, or discussion for a suspected
vulnerability. Report it privately to the maintainer via a GitHub
[security advisory](https://github.com/juancristobalgd1/qaap/security/advisories/new)
so it can be triaged and fixed before disclosure. Include a concise
description, reproduction steps, and impact.

## Deployment security model (self-hosting)

Qaap runs a hosted agent (a CLI) that executes shell commands and edits files in
per-user workspaces. Understand the isolation model before exposing it publicly:

- **Single-user is safe by default.** One person on their own box: the defaults
  are fine. **Inviting a second user onto the same instance is not a current
  product milestone.** Do not treat this tree as multi-tenant-ready until you
  explicitly flip that and run the VPS verification below.
- **Multi-user requires hardening.** In a shared container one tenant's agent
  could read other tenants' secrets and code on the shared filesystem. Before
  inviting other users you **must**:
  - Keep the non-root agent drop enabled. The shipped image sets
    `QAAP_AGENT_UID=1001` (a provisioned `qaap-agent` user) **by default**, so the
    agent cannot read other tenants' secrets/tokens under the root-owned `/root`
    tree. As a backstop, the backend **refuses to spawn the agent as root in a
    production runtime** (`NODE_ENV=production` or a non-local `QAAP_CLOUD_MODE`)
    unless the drop is applied — override only via
    `QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION=true` if you fully understand the risk.
    See [doc/qaap-vps-deployment.md](doc/qaap-vps-deployment.md) for the
    verification steps.
  - Keep per-tenant CODE isolation enabled. `QAAP_AGENT_UID_PER_USER` defaults to
    **on** in `docker-compose.yml`: each GitHub login gets its own OS uid, its
    repos/worktrees are locked to `0700`, and the agent (wrapped in
    `setpriv --clear-groups`) runs under that uid — so one tenant's agent cannot
    read or write another tenant's code. The backend **refuses to spawn an agent
    under a shared uid in a production runtime**; a single-user box can opt out
    with `QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION=true`. See
    [doc/qaap-uid-per-user.md](doc/qaap-uid-per-user.md) for verification and
    rollback.
  - Serve over **HTTPS** and never set `QAAP_SKIP_AUTH` in production (it is
    refused in a production runtime, but do not rely on that alone).
  - Provide **your own** GitHub OAuth app credentials and VAPID keys — never
    reuse the placeholders in `*.env.example`, and never commit real secrets.
- **Full per-tenant isolation** (a container or OS user per tenant, so tenants
  cannot read each other's *code* either) is on the roadmap and recommended for
  any larger public deployment.

### Known residual: git-over-tenant-repo run as root — GATE THE MULTI-TENANT FLIP

Every process that runs *tenant-controlled program code* — the agent, preview
dev server, terminal, and deploy build — drops to the tenant uid via
`setpriv --clear-groups`. The git checkpoint/restore in the conversation store
also drops (it runs checkout/add over the tenant repo). **But several git
operations that touch tenant repos still run as the backend uid (root in prod).**
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
- **`qaap-github-oauth-endpoint.ts` (clone/fetch/pull) — CLOSED.** Hooks are
  disabled (`-c core.hooksPath=/dev/null`). Clone/fetch are safe (a fresh clone's
  `.git/config` is git-generated, not tenant-controlled; fetch downloads objects
  with no checkout). The one dangerous op was **`git pull --ff-only`** on an
  existing repo — its ff checkout ran a tenant-defined clean/smudge **filter**
  (from the repo's own `.git/config`) as root. The repo-`open` flow no longer
  checks out as root: it does `fetch --all --prune` only (refs + objects, no
  checkout), and the working tree fast-forwards on the tenant's NEXT git operation
  (agent / terminal), which runs under the tenant uid and is safe. Tradeoff: an
  opened repo is not auto-fast-forwarded to the remote tip until the tenant's next
  git op — a deliberate exchange of an auto-pull convenience for eliminating the
  root-checkout RCE (avoids relocating `QaapTenantSpawnService` across the
  `qaap-cloud-workspace` → `qaap-mobile-shell` dep cycle).

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
> snapshot). If two GitHub logins already exist, the gate *reports* multi-tenant isolation;
> a failed check is a **WARN**, not a deploy blocker — extra unused logins must not stop a
> single-user public boot. Inviting a second **real** user still requires a green
> `scripts/qaap-verify-multitenant.sh`.
> Configure encrypted offsite copies via `/opt/qaap/.env.backup` — local tars do not survive disk loss.
> A production runtime without GitHub OAuth now **exits on
> startup** unless `QAAP_ALLOW_UNCONFIGURED_OAUTH_IN_PRODUCTION` is set.

## Dependency audit notes

`npm audit --omit=dev` reports **zero production vulnerabilities**. The
unmaintained `decompress@4.2.1` package (GHSA-mp2f-45pm-3cg9, hardlink/symlink
path traversal during archive extraction) has been removed from runtime
dependencies. Plugin, VSIX, CLI, and remote-native extraction now use
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
intentionally required (local desktop/dev).

The unfiltered audit still reports development-tool advisories; they are not
included in the production dependency graph. Re-run both audit modes after
dependency changes.

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
