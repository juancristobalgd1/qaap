# Agent browser findings

Date: 2026-10-04
Branch: `fo/agent-browser`

## Current state

- Read `doc/qaap-ci-invariants.md` before inspecting implementation. Keep the tenant network and
  host-loopback guards unchanged: browser egress must continue to use the tenant network policy.
- The runtime `Dockerfile` already installs Debian Chromium and the backend uses
  `QAAP_HEADLESS_CHROMIUM=/usr/bin/chromium`. `@theia/qaap-cloud-workspace` depends on
  `playwright-core`. The image now pins `@playwright/mcp@0.0.83`, checks the CLI and Chromium during
  image build, and the image smoke check asserts both are present.
- Agent subprocesses are spawned through `QaapTenantSpawnService`. In tenant-backend mode their
  `HOME` is `/tmp/qaap-home`; cache/data paths can be redirected to the tenant's `.qaap` mount.
  That makes config persistence a separate concern from browser cache persistence and needs to be
  resolved before claiming the MCP registration survives tenant restarts.
- `qaap-adapters` already owns mini-browser and embedded agent-preview chrome. The preview host
  exposes URL/navigation methods, but there is no current MCP-to-preview navigation or screenshot
  event path.
- No package currently provisions a default browser MCP server for agent subprocesses. The browser
  integrations must preserve the tenant network boundary (including the host loopback guard and
  private-range blocks).

## Implementation and user verification

Status: the pinned image dependency and its source-level smoke spec are committed. QAIQ/OpenClaude
now admits only the dedicated `mcp__qaap_browser__*` namespace; unrelated MCP tools and Theia tools
remain blocked. Agent launch now idempotently registers `qaap_browser` for Claude Code, Codex,
OpenCode, OpenClaude, Gemini CLI, Antigravity, Copilot CLI, Cursor, Hermes, and QAIQ. The config
bootstrap writes to the process HOME. In tenant backend mode, Qaap links `.claude.json` and each
harness config directory (including `.claude`, `.codex`, `.gemini`, `.copilot`, `.cursor`, `.hermes`
and `.config`) from `/tmp/qaap-home` into
`/home/theia/.qaap/.qaap-agent-storage/home`, so newly registered MCP config is stored on the
tenant's persistent mount. A fresh-container persistence check is still pending. Browser-to-preview
live updates, tenant-image build, and runtime verification remain pending.

Validation so far:

- Image-source test: 1 passing.
- QAIQ policy Mocha spec: 5 passing.
- Browser MCP config spec: 2 passing. It validates config registration, preservation of unrelated
  Claude MCP entries, and idempotency.
- `npm run compile --workspace @theia/qaap-cloud-workspace` failed because workspace build outputs
  are missing (first relevant errors include `@theia/qaap-shared-core` and `@theia/qaap-adapters`).
  Compiling `@theia/qaap-adapters` separately also failed because upstream Theia and
  `qaap-element-inspector` outputs are absent.
- Full `npm test --workspace @theia/qaap-cloud-workspace` stopped before collecting specs because
  `@theia/qaap-shared-core/lib/common/qaap-preview-identity` is missing. 0 full-package specs ran.
- Full `@theia/qaap-cloud-workspace` compile did not complete: referenced Theia/Qaap package outputs
  are missing in this checkout (the first reported dependency failure was
  `@theia/core/shared/@theia/application-package/lib/environment`).
- Full `@theia/qaap-cloud-workspace` spec run could not load the suite because
  `@theia/qaap-adapters/lib/browser/qaap-preview-widget-uri` has no compiled output. No full-package
  passing count is claimed.
- A fresh root `npm run compile` attempt under Node 22.13.1 also stopped before Qaap packages:
  `@theia/filesystem` could not resolve
  `@theia/core/shared/@theia/application-package/lib/environment`. This environment initially had
  no Node/npm; Node 22.13.1 was unpacked under `/tmp` for verification. The full workspace spec suite
  was not run.
- `node --test scripts/qaap-agent-browser-image.test.mjs`: 1 passing.
- `node scripts/qaap-drift-check.js`: passed after adding this user-requested findings log to the
  documented drift baseline.

When implementation is complete, verify from a fresh tenant for each supported harness:

1. Start an agent and ask it to open a public page and read a visible heading. Confirm no browser
   approval prompt appears and the request succeeds.
2. Ask it to open a page served by that tenant on `localhost`. Confirm it can reach the preview.
3. Confirm the active URL or live page appears in the integrated browser in Work Hub at 375x812 and
   in IDE mode. Navigate independently in each mode and confirm one mode does not change the other.
4. Reload the tenant and start another run. Confirm the harness still has the browser tool.
5. Confirm the public internet works while tenant attempts to reach private ranges, the VPS host
   (`10.0.2.2`, including ports 4873/14873), Docker bridges, and SMTP remain blocked.
6. Compare Work Hub and harness-selector load time with the pre-change baseline.

Do not report these checks as passing until they have been run against a built tenant image.

## Verification update (2026-10-05)

The branch was rebased onto the fetched `origin/master` (`0150f4b2`). Verification on this
checkout:

- `npx tsc -b --pretty false` in `packages/qaap-cloud-workspace`: passed.
- `npx tsc -b --pretty false` in `packages/qaap-shared-core`: passed.
- Configured full `qaap-shared-core` Mocha suite: **1,508 passing, 2 pending**.
- Full `qaap-cloud-workspace` Mocha suite: **1,797 passing, 2 pending, 1 failing**. The failure is
  `qaap-headless-visual-capture.spec.js`; Playwright Chromium cannot start because the workspace
  image lacks `libatk-1.0.so.0` (and related system libraries). `apt-get update` is unavailable to
  this unprivileged workspace user.
- Focused browser configuration, tenant bootstrap, approval, read-only, QAIQ tool policy, and
  QAIQ auto-response specs: **102 passing**.
- The fresh-tenant smoke, browser-to-preview visibility, Work Hub/IDE independence, and load-time
  comparison remain unverified. A8 is still open; do not open a PR or claim the complete goal until
  the integrated-browser path is implemented and the required runtime checks pass.

## References checked

- [Playwright MCP README](https://github.com/microsoft/playwright-mcp) documents headless mode and
  `--executable-path`.
- [OpenCode MCP configuration](https://opencode.ai/v2/docs/mcp-servers) documents local stdio MCP
  entries and automatic server connection.
- [Hermes MCP documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md)
  documents its `~/.hermes/config.yaml` server registry.
- [Gemini CLI MCP documentation](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md)
  documents `mcpServers` in `settings.json`.
