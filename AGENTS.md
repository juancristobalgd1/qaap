# AGENTS.md

General development commands, architecture, and the upstream-drift policy live in
[`CLAUDE.md`](./CLAUDE.md). Read it first — it is the canonical reference for build/compile/test
commands and the Qaap product contract. This file only adds Cursor Cloud specific notes.

## Cursor Cloud specific instructions

This is **Qaap**, an agentic cloud IDE built as a fork of Eclipse Theia. It is a single Node/Express
process that serves the bundled webpack frontend, the backend, and the WebSocket/JSON-RPC channel
over **one HTTP port** (`3000` in dev). System libs (`libx11-dev`, `libxkbfile-dev`,
`libsecret-1-dev`) and Node ≥22 are already present; the startup update script runs `npm install`
(its `postinstall` runs `theia-patch`, `compute-references`, and `lerna run afterInstall`).

### Bringing the app up from a fresh VM
`npm install` only installs deps. To run the app you must also compile, download plugins, and bundle
the frontend, in this order (commands documented in `CLAUDE.md`):

1. `npm run compile`
2. `npm run download:plugins -- --rate-limit 5 --ignore-errors`
3. `npm run build:browser`
4. `npm run start:browser` (serves on `http://localhost:3000`)

- **Ordering gotcha:** `download:plugins` and most `theia` CLI commands require the compiled
  `dev-packages/cli/lib`, so they fail with `Cannot find module '../lib/theia'` if run before
  `npm run compile`. Always compile first.
- **`build:browser` is mandatory before UI shows up.** `npm run compile` alone does not bundle the
  frontend; the running server serves the prebuilt webpack bundle, so re-run `npm run build:browser`
  (or use `npm run watch:browser`) after frontend changes.

### Auth / secrets
Local dev needs **no secrets**. `examples/browser/.env` ships with `QAAP_SKIP_AUTH=true` (skips the
GitHub login gate) plus dev OAuth/VAPID values. AI provider keys are only needed for live agent/chat
flows.

### Reaching the classic file-editing IDE (non-obvious)
The app boots into the **Work Hub** agent surface by default, not the classic editor. To exercise
core file editing:

- Open a workspace folder first (e.g. via "Open folder on this device", or load
  `http://localhost:3000/#<absolute-folder-path>`). A good sample folder is
  `examples/playwright/src/tests/resources/sample-files1`.
- The **"Open IDE"** account-menu item only appears in the mobile/narrow one-column layout
  (viewport ≤767px or coarse pointer) with a workspace open.
- Escape hatch used by the e2e tests to force the classic IDE: set sessionStorage
  `qaap.mobileProjects.preferDesktopIde = '1'` and reload, then open the Explorer (`Ctrl+Shift+E`).

### Background agents
AI agent CLIs (`qaiq`, `codex`, `claude`, `aider`, …) are auto-detected on `PATH`; none are installed
by default (startup logs `[qaap-agent-tasks] detected agents: (none …)`). Agentic flows therefore
need an agent CLI plus provider API keys; the IDE and editor work fine without them.

### Tests
`npm run test:theia` / scoped `npx lerna run test --scope @theia/<pkg>` run Mocha+NYC. As of this
setup, `@theia/qaap-mobile-shell` had 3 pre-existing failures unrelated to environment setup (a
monaco-editor-core `.css` ESM-loader error and two timing-sensitive transcript benchmark assertions);
the other ~1100 tests pass. The `@qaap-mobile` Playwright suite (`npm run test:playwright:qaap-mobile`)
exercises the Work Hub → classic IDE "Open IDE" escape hatch end-to-end.
