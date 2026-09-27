# Qaap CI/CD invariants (critical — do not break)

Every rule below fixed a workflow that was red, sometimes for weeks. Each entry says what must stay true, why, what you will see if it breaks, and where it lives. Before changing any of these places, read the entry. If a CI job goes red with one of the listed symptoms, check the matching invariant first.

History: #112, #113 (Sep 25, 2026), #121, #122, #124, #125 (Sep 26, 2026). All workflows were green on master after #125.

## Tenant spawn / terminals (Linux)

### 1. The portable rlimit fallback must exec the real command

- **Rule:** in `packages/qaap-cloud-workspace/src/node/qaap-tenant-spawn-service.ts` (`applyResourceLimits`), the fallback script is `ulimit -v "$1" && ulimit -t "$2" && shift 2 && exec "$@"`. `$0` is the `qaap-resource-limited` label, `$1`/`$2` are the limits, `$3…` is the command. Shift exactly **2**.
- **Why:** on Linux without `systemd-run` (every GitHub runner, dev hosts), each tenant spawn goes through this fallback, including every Theia terminal shell (`wrapShellForTenant`) and every dev-server/preview command. With `shift 3` the executable was dropped: `exec` ran with no arguments (or with `-l`) and the process exited as soon as it spawned.
- **Symptoms if broken:** terminals open but never get output; the xterm `.xterm-helper-textarea` stays **0px wide** (the `xterm.css` default; `_syncTextArea` only sizes it after output/cursor movement), so Playwright's `fill`/`TheiaTerminal.write()` times out as "element is not visible"; the tab title stays "Terminal N"; the backend logs `terminal "<id>" does not exist` and `Couldn't resize terminal X, because it doesn't exist`; preview bootstrap stays in `starting`. Everything passes on Windows. This is **not** an xterm/WebGL problem; do not patch page objects or add waits.
- **Guard:** the Linux-only spec `rlimit fallback execs the wrapped executable itself, not its first argument` in `qaap-tenant-spawn-service.spec.ts` runs the real wrapper. Keep it.
- Production is unaffected: in production host mode this path throws and requires `systemd-run` or Docker.

## Upstream Playwright job (`.github/workflows/playwright.yml`)

### 2. Run the upstream suite through the Qaap config

- **Rule:** the test step runs `npx playwright test --config=./configs/playwright.qaap-upstream-ci.config.ts` (not the upstream `ui-tests-ci` script / `playwright.ci.config.ts`).
- **Why:** the Qaap config excludes `@qaap-mobile` specs (see 4) and starts the backend through `configs/qaap-upstream-ci-theia-start.js`.
- **Symptom if broken:** the job hits the 60-minute timeout and ends `cancelled` without reporting (this was the state on every run before #121).

### 3. Required env for the upstream suite

- **Rule:** the test step exports `QAAP_SKIP_AUTH: 'true'`, `QAAP_CLOUD_MODE: local`, `QAAP_PLAYWRIGHT_SURFACE: ide`.
- **Why:** without auth skip the backend rejects file-system RPCs ("Not signed in") and the login gate covers the workbench. Without `QAAP_PLAYWRIGHT_SURFACE=ide`, a new tab starts in the Work Hub, which hides the classic IDE the upstream suite drives. `examples/playwright/src/theia-app-loader.ts` turns that variable into the per-tab `sessionStorage` key `qaap.mobileProjects.preferDesktopIde` (same contract as `markPreferDesktopIde()`), and installs `QaapMenuBar`.
- **Symptom if broken:** mass 30 s timeouts × 3 retries on menus, explorer and file dialogs.

### 4. `@qaap-mobile` specs never run in the upstream job

- **Rule:** keep `/@qaap-mobile/` in `grepInvert` of `playwright.qaap-upstream-ci.config.ts`.
- **Why:** they need the fixtures, mock agent, env and longer timeouts that only `qaap-mobile-playwright.yml` provides; each one burns up to 5 min × 3 attempts elsewhere.

### 5. Qaap chrome adapters instead of editing upstream page objects

- **Rule:** do not edit upstream specs/page objects in `examples/playwright/src` (drift). Bridge Qaap chrome in Qaap-only files: `examples/playwright/src/qaap-menu-bar.ts` (menus through the top-bar "Open menu" button, since `#theia:menubar` is hidden), `configs/qaap-upstream-ci-theia-start.js` (seeds the upstream `welcomePage` startup editor; Qaap defaults to `none`).
- **Product fix to keep:** `QaapSideTabBar.renderTabs()` (`packages/qaap-shell/src/browser/qaap-tab-bars.ts`) must give the visible activity-strip tabs their real id (`shell-tab-<id>`), not the `-hidden` measurement id. Otherwise `#shell-tab-explorer-view-container` does not exist and tab lookups (context menu, drag and drop) fail.
- **Remaining exclusions are deliberate product behaviour** (Qaap expands the Explorer on startup): `Toggle Explorer View` and `open sample.txt via file menu`. Do not add new `grepInvert` entries to hide a failure; find the cause. The terminal I/O specs were excluded once for that reason and turned out to be invariant 1.

## Mobile Playwright (`qaap-mobile-playwright.yml`) and preview recovery

### 6. Vite strict-port conflicts must be recognised

- **Rule:** `PORT_IN_USE_REGEX` in `packages/qaap-shared-core/src/browser/qaap-project-bootstrap-dev-errors.ts` (single definition) matches `Port 5173 is already in use`, not only `EADDRINUSE`.
- **Why:** Vite with `--strictPort` prints only that line; without the match, automatic port recovery never runs.

### 7. A blank terminal tail must not replace the real error

- **Rule:** `readTerminalTail` skips trailing blank xterm rows and returns `''` for an all-blank buffer.
- **Why:** after a fast exit the last rows are blank viewport rows; a string of newlines is truthy and overwrote the exit diagnostic and port-conflict input (run-failed with an empty error).

### 8. Spec expectations that match current product behaviour

- `qaap-transcript-preview-flow`: the one-column Work Hub opens Preview in the execution-surface drawer (`data-surface="preview"`) and keeps the inline conversation on `data-active-surface="messages"`. The spec requires the proxied iframe inside an active Preview surface, inline or drawer. Do not loosen it further.
- `qaap-recovery-preview-resilience`: identity previews are `/qaap-preview/<id>/` and never contain the port; read the recovered port from `lastPort` on `window.__qaapBootstrap.getState()`.
- The workflow uploads `test-results/` on failure; keep it for diagnosis.

## Mock agent provider in CI

### 9. CI backends need the mock provider key

- **Rule:** `OPENROUTER_API_KEY: mock-rioja-e2e` in `qaap-mobile-playwright.yml`, `qaap-rioja-agent-e2e.yml` and `qaap-vps-deploy.yml`. The mock ignores the value.
- **Why:** since #103 the Ollama schema default (`http://localhost:11434`) no longer counts as a configured provider, so the runner refuses every QAIQ task ("QAIQ/OpenClaude needs an API key…") before spawning the mock.
- **Symptoms if broken:** agent turns never start; Rioja composer UI flow (P0) fails; **the VPS deploy gate blocks every deploy** (nothing was deployed Sep 24–25 for this reason).

## CI/CD (`Build and Test`, `Lint`)

### 10. Known traps

- `dev-packages/cli/src/theia.ts`: puppeteer ≥ 25 returns `executablePath()` as a Promise; keep `executablePath: await executablePath()` (otherwise the API tests launch `[object Promise]`).
- Lint stops at the first failing package, hiding later errors. Before declaring lint fixed, run `npx lerna run lint --no-bail`.
- Windows runners check out with CRLF: specs that compare file/CSS text must normalise line endings.
- Specs that depend on `QAAP_BETA_ALLOWED_LOGINS`, `NODE_ENV` or `QAAP_CLOUD_MODE` must set and restore them: Nx loads a developer `.env` into `lerna run`.
- Heavy jsdom suites: create one jsdom per suite, not per test (per-test setup hit the 2 s hook timeout on loaded machines).

## Process rules for agents

- A test that fails only on the Linux runner is a product signal until proven otherwise. Reproduce the backend path (e.g. run the produced argv with a POSIX `sh`) before excluding the test or touching upstream page objects.
- Never add a `grepInvert`/`testIgnore` entry without a comment stating the product reason, and never as a stopgap for an unexplained failure.
- master requires only the `qaap-guards` check (`.github/workflows/qaap-guards.yml`: drift check, package-graph check, `npm run compile`) once branch protection is enabled. Keep that workflow free of `paths-ignore` (a filtered-out required check never reports and blocks the PR) and keep the job name stable. Every other check is advisory: GitHub auto-merge would merge as soon as `qaap-guards` is green. To merge "when green", verify every check (including `Playwright @qaap-mobile`) and merge pinned to the verified head (`gh pr merge --match-head-commit <sha>`).
- The owner may merge a PR at any moment. Check `gh pr view <n> --json state` right before pushing to a PR branch; if it is merged, open a new PR from master.
