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
  are fine.
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

## Dependency audit notes

`npm audit --omit=dev` still reports **one critical for `decompress@4.2.1`**
(GHSA-mp2f-45pm-3cg9, hardlink/symlink path traversal during archive
extraction). It is a **false positive**: the package is unmaintained with no
fixed release, so we neutralise the vulnerability in place with
`dev-packages/cli/patches/decompress+4.2.1.patch` (applied by `theia-patch` on
install), which refuses any link entry whose target escapes the extraction
directory. `npm audit` keys off the version string and cannot see the patch, so
the critical will persist in the report until upstream Theia drops `decompress`.
Do not "fix" it by aliasing to the ESM fork `@xhmikosr/decompress` — Theia
`require()`s it from CommonJS and the ESM default-export shape breaks every call
site. All other production HIGHs are resolved via lockfile bumps and the root
`overrides` block.

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
