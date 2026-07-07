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
- **Multi-user requires hardening.** By default the agent runs as **root** in a
  single shared container, so one tenant's agent could read other tenants'
  secrets and code on the shared filesystem. Before inviting other users you
  **must**:
  - Activate the non-root agent drop: set `QAAP_AGENT_UID=1001` (the image ships
    a `qaap-agent` user). This stops the agent from reading other tenants'
    secrets/tokens under `/root`. See
    [doc/qaap-vps-deployment.md](doc/qaap-vps-deployment.md) for the verification
    steps.
  - Serve over **HTTPS** and never set `QAAP_SKIP_AUTH` in production (it is
    refused in a production runtime, but do not rely on that alone).
  - Provide **your own** GitHub OAuth app credentials and VAPID keys — never
    reuse the placeholders in `*.env.example`, and never commit real secrets.
- **Full per-tenant isolation** (a container or OS user per tenant, so tenants
  cannot read each other's *code* either) is on the roadmap and recommended for
  any larger public deployment.

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
