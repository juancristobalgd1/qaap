# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ AI Agent Quick Reference

**Never run `.ts` source files directly** with `npx tsx`, `ts-node`, or `node` in this repo. Packages import each other's compiled `lib/` output — running source will fail with module-not-found errors. Always compile first.

| Goal | Command |
|---|---|
| Compile TypeScript | `npm run compile` |
| Build + bundle UI (required for UI testing) | `npm run build:browser` |
| Start app | `npm run start:browser` |
| Run all tests | `npm run test` |
| Test one package | `npx lerna run test --scope @theia/package-name` |
| Compile one package | `npx lerna run compile --scope @theia/package-name` |
| Run a single compiled test file | `npx mocha ./packages/core/lib/browser/some-file.spec.js` |
| Check upstream drift | `node scripts/qaap-drift-check.js` |

**Verify sequence after any code change:**
1. `npm run compile` — TypeScript errors
2. `node scripts/qaap-drift-check.js` — drift policy
3. `npm run build:browser` — only if UI changes need testing in browser
4. Tras cambios de UI/producto: reiniciar preview y devolver URL al usuario — ver `.cursor/rules/post-task-build-preview.mdc`.

**Critical Qaap product contract (owner-confirmed 2026-09-05):** Preserve the active IDE or ADE/Agents/Work Hub surface across reload/F5 in the same tab using `sessionStorage`. Keeping IDE active on reload is intentional. Only a new tab without a stored surface defaults to Work Hub. Do not use `localStorage`, URL state or restored layout as the surface selector. See `.cursor/rules/work-hub-reload-default.mdc`.

## Development Commands

**Essential commands:**
- `npm install` - Install dependencies (runs `theia-patch`, `compute-references`, and lerna `afterInstall` hooks)
- `npm run build:browser` - Builds all packages + bundles Browser example app (preferred during development)
- `npm run compile` - Compile TypeScript only (uses `tsc --build` with project references)
- `npm run lint` - Run ESLint across all packages
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run test` - Run all tests

**Important:** `npm run compile` only compiles TypeScript. Before UI testing, you must also run `npm run build:browser` to bundle the frontend via webpack — otherwise the running browser app won't include your latest changes.

**Application commands:**
- `npm run start:browser` - Start browser example at localhost:3000
- `npm run start:electron` - Start electron application
- `npm run watch` - Watch mode for development (browser + electron concurrently)

**Package-specific:**
- `npx lerna run compile --scope @theia/package-name` - Build specific package
- `npx lerna run test --scope @theia/package-name` - Test specific package
- `npx lerna run watch --scope @theia/package-name --include-filtered-dependencies --parallel` - Watch package with dependencies

**Running a single test file (after compile):**
- `npx mocha ./packages/core/lib/browser/some-file.spec.js`

**Test infrastructure:** Tests use Mocha + NYC (Istanbul) for coverage. Config at `configs/mocharc.yml` and `configs/nyc.json`. Each package's `npm test` runs via the `theiaext test` wrapper defined in `dev-packages/private-ext-scripts`, which executes `nyc mocha --config ../../configs/mocharc.yml "./lib/**/*.*spec.js"`.

## Architecture

**Monorepo Structure:**
- Lerna-managed monorepo with ~80 packages in `packages/`
- `/packages/` - Runtime packages (core + extensions)
- `/dev-packages/` - Development tooling (application-manager, cli, eslint-plugin, ext-scripts)
- `/examples/` - Sample applications (browser, electron, browser-only, playwright)
- `/configs/` - Shared config files (tsconfig, eslint, mocha, nyc)

**Qaap product layer (`@theia/qaap-*`, fork-specific):**
- Example apps should depend on **`@theia/qaap-product`** once; it pulls `qaap-element-inspector`, `qaap-mobile-shell`, and `qaap-product-theme` and exposes a minimal frontend module so the extension collector loads them transitively.
- **`@theia/mini-browser`** still lists **`@theia/qaap-element-inspector`** directly (DI and imports from that package).
- Narrow mobile viewport breakpoint for TypeScript: **`MOBILE_NARROW_VIEWPORT_MEDIA_QUERY`** and **`matchesMobileNarrowViewport()`** in `packages/core/src/browser/shell/mobile-layout-state.ts` (keep CSS using the same `767px` breakpoint in sync). Narrow-viewport rules for menus / side panel / dialogs live in **`@theia/qaap-product-theme`** (`qaap-menus-narrow-viewport.css`, `qaap-sidepanel-narrow-viewport.css`, `qaap-dialog-narrow-viewport.css`); apps without that package will not get those overrides.
- **Mobile touch scroll (critical):** nested lists inside flex overlays must use `min-height: 0` + native overflow and be listed in `qaap-mobile-touch-scroll.css` and `MOBILE_VERTICAL_SCROLL_SELECTOR` (`mobile-vertical-touch-scroll.ts`). See `.cursor/rules/mobile-touch-accessibility.mdc`.
- **Work Hub reload default (critical):** F5 in the same tab restores whichever surface the user had open — Work Hub or classic IDE — via `sessionStorage`. Work Hub is still the default on a fresh tab. `markPreferDesktopIde()` persists for the session; `qaap-login-gate.js` skips the Work Hub boot guard when IDE preference is set.

**Platform-specific code organization (per package):**
- `src/common/` - Shared JavaScript APIs (runs everywhere)
- `src/browser/` - Browser/DOM APIs (InversifyJS DI container for frontend)
- `src/node/` - Node.js APIs (InversifyJS DI container for backend)
- `src/electron-browser/` - Electron renderer process
- `src/electron-main/` - Electron main process

**Extension entry points** are declared in each package's `package.json` under `theiaExtensions`:

```json
"theiaExtensions": [{
  "frontend": "lib/browser/editor-frontend-module",
  "backend": "lib/node/editor-backend-module"
}]
```

**Extension System:**
- Dependency Injection via InversifyJS (property injection preferred over constructor injection)
- Contribution Points pattern for extensibility (CommandContribution, MenuContribution, KeybindingContribution, FrontendApplicationContribution, etc.)
- Three extension types: Theia extensions (build-time), VS Code extensions (runtime), Theia plugins (runtime)

## Upstream-Drift Policy and Migration Plan

**The rule:** all new Qaap product code lives under `packages/qaap-*`. Do not modify files inside upstream Theia packages (`packages/<anything not starting with qaap->`). Drift is enforced in CI by `scripts/qaap-drift-check.js`: every file that differs from `upstream/master` must be either inside `packages/qaap-*`, matched by a regex in the `ALLOWED` list (with a comment explaining why), or listed in `scripts/qaap-drift-baseline.txt` (~516 entries as of July 2026 — known drift pending extraction; CI fails only on NEW drift outside both lists. Trim stale entries after each extraction: regenerate the file from the report output, keeping only paths that still differ).

### Extraction patterns by change type

When a Qaap product behaviour requires changing a Theia file, use one of these patterns instead of editing the upstream file:

| Change type | Extraction pattern |
|---|---|
| Preference default | Add a new `PreferenceContribution` in a `qaap-*` package |
| Branding string | Rebind the `Symbol`-backed messages object, or use `FrontendApplicationConfigProvider.applicationName` |
| CSS rule | Add the rule to a `qaap-product-theme` stylesheet and import it from `qaap-product-theme-frontend-module.ts` |
| Service / widget behaviour | Subclass the upstream class in `qaap-*` and `rebind(UpstreamClass).to(QaapSubclass)` in the frontend module |
| Contribution (menu / keybinding / command) | Add a new `Contribution` in `qaap-*`; never edit the upstream one |
| "Fork lag" (upstream improved a file we haven't picked up) | `git checkout upstream/master -- <file>` and re-verify build; not really product code |

### Remaining upstream packages still touched (15 as of last audit)

Each entry should eventually be removed by extracting product behaviour into `packages/qaap-*` and reverting the upstream file. Listed in descending file count:

- **`core`** (2 files) — only `package.json` and `README.md` remain in the baseline, both coupled to the full 1.71→1.72 version merge. Everything else was re-adopted from upstream (July 2026 sweep) or is a documented seam in `ALLOWED` (`workbench-top-bar-factory`, `mobile-layout-state`, `decorations-service`, generated i18n catalogs).
- **`ai-ide`** (14 files) — model-alias configuration UI, command/prompt templates, and `workspace-functions.ts` (−291 lines: removed `TrustAwarePreferenceReader` and the external-path allowlist; reassess against the current upstream Theia AI release).
- **`plugin-ext`** (7 files) — plugin host, view registry, webview-resource-cache customizations. Sensitive area: extract via subclass + rebind one file at a time.
- **`mini-browser`** (7 files) — most already seamed for the Element Inspector and mobile open-handler; a few remain.
- **`workspace`** (4 files) — trust dialog and trust service customizations.
- **`monaco`** (3 files) — quick-input layout and frontend-module seams already documented.
- **`ai-code-completion`** (3 files) — agent and variable-contribution customizations.
- **`ai-chat`**, **`ai-chat-ui`**, **`ai-core`**, **`ai-terminal`** (2 files each) — subclass the relevant renderer / contribution and rebind in a `qaap-*` package.
- **`scm`** (1 file) — adds `collapseContainingPanel()` and single-click open for mobile; needs subclass of `ScmTreeWidget` + `ScmResourceComponent` together, then visual verification on a narrow viewport.
- **`plugin-ext-vscode`** (1 file) — fork lag (upstream's ESM loader hook removed in fork). Decide whether to re-adopt.
- **`ai-anthropic`** / **`ai-google`** (1 file each) — preference defaults; needs a schema-merge pattern or a higher-priority `PreferenceContribution`.

### Open extraction tasks (ordered by recommended priority)

Pick the next task off this list. Each is independent — extract one, verify, commit, and tick the box. The order goes from low-risk quick wins to multi-session efforts.

**Tier 1 — Quick wins (1 file, ~1 session each)**

- [x] **ai-anthropic preference defaults.** Extracted to `QaapAiModelDefaultsContribution` in `qaap-ai-config`; upstream reverted.
- [x] **ai-google preference defaults.** Same — extracted alongside Anthropic via `service.registerOverride()`.
- [x] **scm mobile single-click + auto-collapse.** Extracted to `QaapScmTreeWidget` / `QaapScmResourceComponent` in `qaap-mobile-shell`. `packages/scm/src/browser/scm-tree-widget.tsx` now keeps only protected/optional seam hooks for resource rendering and inline-action callbacks. Compile verified; still needs manual narrow-viewport SCM click-through when a repo with changes is available.
- [x] **plugin-ext-vscode ESM loader hook.** Re-adopted upstream — was pure fork lag (no fork commits had touched the file).

**Tier 2 — Medium (2–3 files, subclass + rebind)**

- [x] **ai-chat** (`chat-content-deserializer.{ts,spec.ts}`). Re-adopted upstream (fork lag — upstream added interrupted-tool-call handling and `createToolCallError`).
- [x] **ai-chat-ui** (`toolcall-part-renderer.tsx`, `generic-capabilities-tree.tsx`). Re-adopted upstream — fork's branding edits had regressed the configurable `applicationName` back to a hardcoded "Theia" string.
- [x] **ai-core** (`theia-variable-contribution.ts`). Re-adopted upstream (same branding regression as ai-chat-ui).
- [x] **ai-terminal**: `shell-execution-tool-renderer.tsx` re-adopted upstream (fork lag); `shell-execution-server-impl.ts` extracted to `QaapShellExecutionServerImpl` in `qaap-ai-config` (cwd resilience: basename fallback + ENOENT message rewrite).
- [x] **ai-code-completion** (`code-completion-agent.ts` + 2 specs). Re-adopted upstream (restores `reasoning='off'` for one-shot completion and `applicationName` branding).
- [-] **monaco** (`monaco-quick-input-{layout,service}.ts`, `monaco-frontend-module.ts`). **Accepted as permanent seam.** The factory `MonacoQuickInputLayout` is a textbook upstream-style DI seam consumed by `qaap-mobile-shell`; reverting and subclassing `MonacoQuickInputImplementation` would require duplicating `@postConstruct init()` (~30 lines copy-paste). Net result is worse coupling.

**Tier 3 — Larger surfaces (4–7 files)**

- [x] **workspace** (4 files: trust dialog/factory/service + frontend-module). The 4 upstream files stay allowlisted as documented seams; `getTrustDevelopmentHostLabel()` defaults to `applicationName` in the upstream dialog.
- [x] **mini-browser** (7 files). Verified — all 7 are justified: the `MiniBrowserOpenHook` seam is consumed by `QaapMiniBrowserOpenHookBridge` in `qaap-adapters`; the new `mini-browser-url-utils.{ts,spec.ts}`, `mini-browser-opener-options.ts`, `mini-browser-open-hook.ts` are co-located with the upstream files that consume them (moving them creates a back-dep anti-pattern).
- [x] **plugin-ext** (7 files). 5 re-adopted from upstream (fork-lag ESM plugin machinery + small null-check); `webview-resource-cache.ts` defensive cache upstream; `QaapPluginViewWelcomePolicy` in `qaap-product`; `plugin-view-registry.ts` left allowlisted (intentional product behavior — qaap is a cloud IDE so the "Open Folder" welcome view is omitted).

**Tier 4 — Multi-session projects**

- [x] **ai-ide** (12 files). Residual entries are documented seams:
    - 4 branding-regression files re-adopted from upstream (`ide-chat-welcome-message-provider.tsx`, `pr-review-prompt-template.ts`, `command-chat-agents.ts`, `command-prompt-template.ts`). Fork was hardcoding "Theia" / "Theia IDE" in places upstream already passes `applicationName` / `productName`.
    - Remaining (accepted as documented seams):
        - `language-model-renderer.tsx` + `model-aliases-configuration-widget.tsx` + matching CSS — implement the "free model" badge feature for NVIDIA NIM / OpenRouter. Tightly coupled to upstream widget render code; clean extraction would require duplicating ~250 lines.
        - `workspace-launch-provider.ts` — defensive `JSON.parse('')` guard in an inline `ToolProvider.getTool()` handler; subclassing requires duplicating ~30 lines of tool definition for a 1-line fix.
        - `package.json` + `tsconfig.json` — add direct deps on `qaap-ai-nvidia` / `qaap-ai-openrouter` that the free-badge feature needs.
    - Re-adopted from upstream:
        - `workspace-functions.{ts,spec.ts}`, `context-file-validation-service-impl.spec.ts`, and the `ALLOWED_EXTERNAL_PATHS_PREF` part of `common/workspace-preferences.ts`: restored `TrustAwarePreferenceReader`, external-path allowlist, path-traversal hardening, and upstream tests.
- [x] **core** (residuals after Tier 1–3 cleanups). Mostly already-allowlisted small seams **justified by qaap consumers** (e.g. `WorkbenchTopBarFactory` → `qaap-mobile-shell`, `ElectronMainApplication.resolveApplicationIconPath` → `qaap-product`). Real outstanding work:
    - [x] July 2026 sweep: 44 remaining core files in the drift baseline triaged and re-adopted from upstream in 5 bisectable batches — (1) the fork's partial ILogger→console style migration reverted (26 files, behavior-identical), (2) markdown-link-handler.ts + `MarkdownString.isCommandAllowed()` trust gate + hover-service link wiring, (3) preference-proxy `Symbol.toStringTag` fix + quick-view empty-label filter + jsdom act helper, (4) tab-bar-toolbar widget/args propagation (fixed a fork regression: `composite-menu-node` passed `args` as a nested array instead of spreading, so handlers received `[widget]` instead of `widget`; Codex-verified no qaap-shell dependency), (5) node logging wildcards + `unixKill` ESRCH suppression + core `shell-quoting`.
    - New documented seams in `ALLOWED`: `decorations-service.ts` (re-fire onDidChangeDecorations after lazy resolution; wrapper class not exported upstream — TODO upstream the fix) and `packages/core/i18n/` + `nls.metadata.json` (generated artifacts; diff derives from allowlisted seams).
    - Still in baseline (deferred to the full 1.71→1.72 `git merge upstream/master`): `packages/core/package.json` and `packages/core/README.md` — the version bump cascades through 87 package.json files and the README is regenerated from re-exports at that version.
    - `backend-application.{ts,-module.ts}` + `backend-application.spec.ts` re-adopted from upstream: restored graceful shutdown, `RootContainer`, async `onStop`, and upstream tests.
    - [x] yargs `v15 → v17` re-adopted across `core`, `dev-packages/{cli,application-manager,private-re-exports}`, and root; `logger-cli-contribution.spec.ts` and `theia.ts` parse calls aligned with upstream async API. Root adds `@types/yargs` for workspace hoisting.
    - [x] `application-shell.ts` top-bar visibility: extracted to `QaapApplicationShellWithToolbar` in `@theia/qaap-shell`; upstream file reverted.
    - [x] `select-component.{tsx,css}` mobile UX: extracted to `qaap-select-component-mobile.tsx` (prototype patch) + `qaap-select-component-overlay.css` in product theme; upstream files reverted.
- [x] **Non-AI infrastructure sweep (July 2026, wave 2):** debug, filesystem, preferences, terminal, task, scm(-extra), notebook, output, process — 77 baseline files triaged, ~64 re-adopted from upstream in 7 bisectable batches. Functional fixes recovered: task-server `onDidStartTaskProcess` never fired (dropped `task` arg), terminal buffer flush on process close, preferences storage dispose() chain, parcel-watcher ignorePatterns + ENOENT retry, terminal paste/copy commands (prefs existed but were orphaned), upstream debug-session DI refactor (incl. the plugin-ext factory adaptation). Remaining per-package baseline entries:
    - `package.json` ×9 — 1.71→1.72 lockstep bump, deferred to the version merge.
    - `filesystem/.../file-tree-decorator-adapter.ts` — resolved in wave 4: verified against Theia GitHub (upstream merged #17508 then self-reverted via #17555 for a perf feedback loop; the underlying bug #17507 is still open upstream). Kept deliberately and documented in `ALLOWED`.
    - `process/.../raw-process.spec.ts` — local env fix (filters Node's NO_COLOR/FORCE_COLOR warning from stderr asserts); revisit when CI/node env no longer emits it.
    - `filesystem/.../node-file-upload-service.ts` — now a documented `ALLOWED` seam: only the fork's path-traversal 403 hardening remains (TODO: upstream it or extract `QaapNodeFileUploadService`).
    - Repo hygiene: leftover refs from a stalled upstream sync (`refs/tmp-upstream-master` @ `d6f45631a`, newer than our `upstream/master`; also `qaap/sync-upstream`, `refs/remotes/__upstream__/master`) — finish or delete before the next drift pass.
- [x] **Wave 3 (July 2026):** vsx-registry, dev-container/remote/remote-wsl, and 14 misc packages (~69 files triaged). Adopted: upstream's unified Extensions view (ExtensionsSourceContribution + ExtensionCard/TypeBadge + refresh command — whole feature had never been merged; mobile CSS class names preserved), keymaps live key/chord capture in EditKeybindingDialog, monaco registerEditorContainer-on-start, workspace `getRootPrefixedPath()` (additive; its ai-* consumers are still pending sync), remote auto-shutdown service, docker-free style reversions everywhere. New `ALLOWED` seams: file-search spec `.worktrees` exclude (agent runtime creates real worktrees), and the fork's Buffer/ReadableStream extension of `RemoteConnection.copy()` (remote-types.ts + remote-wsl-connection.ts). Wave-4 dual analysis (deep-reasoner + Codex) established this is a **phantom seam**: no caller passes Buffer/stream, the SSH and docker impls are string-only, and the fork's old docker impl was non-functional. Preferred resolution when revisited: collapse both files back to upstream (kills 2 ALLOWED entries); if a real Buffer/stream consumer ever appears, Codex produced a ready temp-file+pipeline patch for RemoteDockerContainerConnection.copy() (Codex session 019f2c3e-c8a2-7542-a0e9-6fd6dd60196e).
- [x] **AI wave 1 (July 2026):** four-way triage of the ai-* constellation (~215 files) + mechanical adoption of everything unblocked (~54 paths, all package tests green). **Product policies formalized by the triage — do not "clean up" as drift:** (1) AI functions scoped to the primary workspace root (ai-ide workspace-functions/search/task providers + INVALID_SECONDARY validation) is a deliberate qaap policy vs upstream's multi-root investment; (2) the PR-review agent redesign (delegation to GitHub/Explore sub-agents + task integration, no Capability Model); (3) chat navigation back/forward replacing upstream's Home/overview UX (ai-chat-navigation-service + commands); (4) agent model aliases: fork registers default/code|universal|code-completion|summarize — upstream agent files say default/fast (unregistered here); after any re-adoption of ai-ide agent files, restore the fork identifiers.
    - [x] **Server-tools constellation ADOPTED (July 2026):** executed in 6 committed layers — (1) @anthropic-ai/sdk ^0.65→^0.93 bumped in ai-anthropic + qaap-ai-config + lockfile together; (2) ai-core server-tools/deferred-tools types + frontmatter + .agents/ CustomAgentsLocation; (3) ai-chat via git merge-file 3-way merges (base = old upstream snapshot) preserving the fork's tool-confirmation timeout; (4) providers + the anthropic seam rebased (3 hooks + 3 rewires, verified); (5) chat-ui server-tools UI + cluster B (pending-confirmation keybindings, input-needed notifications) + mermaid cluster (new npm dep `mermaid`), product chrome and execution timeline preserved through the merges; (6) plugin-ext lm-tool bridge. The 3-way merge-file technique (fork/old-upstream/new-upstream) is the proven recipe for product-seam files. Pending manual verification: pruning×server-tool message pairs in a live anthropic chat with web tools, rolling cache after server-tool injection, ServerToolsSection UI at both viewports, mermaid rendering in chat.
    - **Historical plan (superseded) — server-tools constellation (dual-analyzed, deep-reasoner + Codex):** upstream is at 1.73 (43 commits ahead); the constellation spans 4 upstream commits (deferred-tools prereq 1436e8681 → server-tools core 14d3751ed → deferred-as-server-tool f24bc8b12 → lm-tool f15c487a3). Not mechanically adoptable: chat-model.ts entangles 3 features, chat-input-widget.tsx is a product seam, chat-view-tree-widget.tsx is the execution timeline (NO_TOCAR). Requires: @anthropic-ai/sdk ^0.65→^0.93 bumped in ai-anthropic AND qaap-ai-config AND package-lock together; anthropic seam rebases cleanly (3 protected hooks + 3 call-site rewires, anchors verified present in the new version; pruning×server-tool-pairs needs manual verify). Codex produced a 35-file dependency-ordered list (session 019f2f2a-a3d7-7552-81a9-e4ee81b66ac7); deep-reasoner recommends the full 1.71→1.73 adoption as the vehicle. ai-registry (43 files): defer to that same project.
    - **Other ready-to-execute backlog from the triage:** ai-chat tool-confirmation persistence (lote D, ~5 files, self-contained, unblocks the big chat-ui pending-confirmation cluster); [DONE July 2026 — ai-core/ai-ide closed: remainder adopted (incl. .agents scope selector rebased onto the agent-config seam, user-interaction tool adapted to the async single-root scope); the permanent AI product surface is now a documented ALLOWED block (single-root policy, PR-review redesign, alias pinning, chat navigation, execution timeline, tool-confirmation timeout, fork-ahead ai-chat files). Baseline 143.] [DONE July 2026 — ai-registry adopted (whole package, version-locked to 1.71.0, wired into examples + compute-references; 124 tests) and all tails closed (style reversions, relocated specs, upstream coding-guidelines.md re-adopted — the console-over-ILogger rule was fork-only and is now obsolete; new ALLOWED seams: claude-code agent prompt, OpenAI provider-ecosystem prefs, shell-execution cwd seam, raw-process env fix, agent-trace doc). **Baseline is now 83 entries: purely the 1.71→1.73 version-lockstep set** (81 package.json + lerna.json + version-generated core README). The only remaining drift project is the version bump itself.] [DONE July 2026: ai-mcp OAuth fully adopted incl. server editor dialogs, electron loopback (new backendElectron entry in ai-mcp package.json), the 6 regression fixes, and the MCP configuration widget relocated from ai-ide into ai-mcp (orphan copy deleted, frontend-module seam hand-trimmed). ai-mcp 236 tests. Mermaid cluster also DONE in server-tools layer 5.] Remaining: welcome-screen session cards parity pass (fork's Card architecture is partly superior — feature-parity, not overwrite).
- [x] **Wave 4 (July 2026):** dev-container attach cluster fully re-adopted (upstream's rich attach + `--attach-container` CLI flow + docker progress dedup + extracted `RemoteDockerContainerConnection` with `execFile` — closed a shell-injection risk in the fork's template-string `exec`; the fork's inline Buffer/stream `copy()` was non-functional; deep-reasoner + Codex dual analysis). plugin-ext: 17 more files re-adopted incl. `files.watcherExclude` watcher bounding, DiagnosticCollection owner/name fix, and the notebook cell-output-webview double-attach guard. `file-tree-decorator-adapter.ts` documented as a deliberate product seam (see ALLOWED comment: upstream reverted #17508 for a perf feedback loop; we keep it for >250-changes decoration correctness — watch for upstream re-land).
    - Still open from wave 4 triage:
        - [x] **plugin-ext view-container `when` clause cluster** — audited and closed: the 146-line plugin-view-registry diff was all fork lag; upstream re-adopted (incl. plugin-protocol `when` fields, scanner-theia location aliases, and the upstream spec) and the QaapPluginViewWelcomePolicy seam re-applied as a minimal 5-line diff.
        - **`.github/workflows`** (3 files): fork CI decisions (Node 24 bump, peaceiris gh-pages deploy) probably ALLOWED candidates, but the removed Playwright/browser cache step needs a human yes/no first.
        - [x] **Upstream ref refreshed (July 4)**: `refs/heads/upstream/master` repointed from the June 22 snapshot (39d328622) to the July 3 tip (f24bc8b12) after `git fetch upstream`. Every file the fork had not diverged from was fast-forwarded to the new base in one mechanical commit (blob-identity criterion: HEAD blob == old-upstream blob → pure upstream-side drift). The ai-* constellation was deliberately excluded — upstream's new server-tool API spans ai-core/ai-chat/ai-google/ai-anthropic/plugin-ext lm-tool (plus an @anthropic-ai/sdk bump) and must be adopted as one unit in the dedicated AI pass. `.github/instructions` files still differ (upstream edited them after our copy) — triage with the .github workflows item.

### Workflow per extraction

1. Read the diff: `git diff upstream/master -- <file>`.
2. Decide: real product code → extract (next step); fork lag → revert with `git checkout upstream/master -- <file>` and skip to step 4.
3. If extracting: create or edit a `packages/qaap-*` package, add the rebind in its frontend module, then revert the upstream file (`git checkout upstream/master -- <file>`).
4. Drop the matching regex from `ALLOWED` in `scripts/qaap-drift-check.js`.
5. Verify in this order: `npm run compile`, `node scripts/qaap-drift-check.js`, `npm run build:browser`, and (for UI behaviour) `npm run start:browser` plus exercising the affected flow at the relevant viewport.
6. Commit per extraction so a regression can be bisected.

### End state — REACHED (July 2026)

The version bump 1.71.0→1.73.0 landed (110 manifests + lerna.json + regenerated core README; react pinned to 18.3.1 via root overrides against the dual-range peerDeps; uuid 11 nested in core). **The drift baseline holds exactly 1 entry** (collaboration's one-line yjs range, lockfile dedupe quirk — converges with any upstream bump). Everything else is either byte-identical to upstream or a commented ALLOWED seam. From here, tracking upstream = fetch, repoint `refs/heads/upstream/master`, re-run the drift pass, and use the blob-identity fast-forward + 3-way merge-file recipes recorded above.

### Original end-state definition

Zero entries in the per-package section of `ALLOWED`. Baseline empty. `git merge upstream/master` produces no conflicts inside `packages/<upstream>/...`. New Theia releases can be adopted with a single `git merge` and a green CI.

## Key Patterns

For more information also look at:
- @doc/coding-guidelines.md
- @doc/Testing.md
- @doc/Plugin-API.md (VS Code extension plugin API)
- @.prompts/project-info.prompttemplate (practical patterns for contributions, widgets, commands, preferences, plugin API, styling)

**Code Style:**
- 4 spaces indentation, single quotes, `undefined` over `null`
- PascalCase for types/enums, camelCase for functions/variables
- Arrow functions preferred, explicit return types required
- Property injection over constructor injection, `@postConstruct()` for initialization

**File Naming:**
- kebab-case for files (e.g., `document-provider.ts`)
- File name matches main exported type
- Platform folders follow strict dependency rules (browser cannot import node, etc.)

**Architecture Patterns:**
- Main-Ext pattern for plugin API (browser Main ↔ plugin host Ext, communicating via RPC)
- Services as classes with DI, avoid exported functions (functions can't be overridden)
- `ContributionProvider` instead of `@multiInject` for collecting multiple implementations
- Use `bindRootContributionProvider` (not `bindContributionProvider`) when binding contribution providers in top-level modules. `bindContributionProvider` retains a reference to whichever child container first resolves it, causing memory leaks. Only use `bindContributionProvider` when contributions are intentionally scoped to a child container (e.g. connection-scoped containers via `ConnectionContainerModule`).
- URI strings for cross-platform file paths, never raw paths
- Localize user-facing strings with `nls.localize()` or `nls.localizeByDefault()`

**Testing:**
- Unit tests: `*.spec.ts`
- UI tests: `*.ui-spec.ts`
- Slow tests: `*.slow-spec.ts`
- Test resources go in `test-resources/` directory

## Technical Requirements

- Node.js ≥20
- TypeScript ~5.9.3 with strict settings (target ES2023, module CommonJS)
- React 18.2.0 for UI components
- Monaco Editor for code editing

**Key Technologies:**
- Express.js for backend HTTP server
- InversifyJS for dependency injection
- Lerna for monorepo management
- Webpack for application bundling
- Lumino 2.x for widget system (tabs, panels, dock layout)

**Key Config Files:**
- `configs/base.tsconfig.json` - TypeScript base config (all packages extend this)
- `configs/base.eslintrc.json` - ESLint parser/base rules
- `configs/build.eslintrc.json` - ESLint build rules (packages extend this)
- `configs/mocharc.yml` - Mocha test runner config
- `configs/nyc.json` - Test coverage config



## Flujo de trabajo de orquestación  
Tú (Fable) eres el orquestador y el modelo más caro de la sesión: cada token que entra a tu contexto se factura a la tarifa más alta. Planifica, descompone, sintetiza — y mantén tu contexto ligero recibiendo conclusiones, no volcados.  

**Delega hacia abajo (por defecto):**  
- Lectura amplia y exploración (greps multi-archivo, entender un subsistema, localizar código) → Explore o fast-worker. No leas tú archivos enteros que un Sonnet puede resumir.  
- Trabajo mecánico (plantillas, pruebas, formateo, ediciones repetitivas) → fast-worker.  

**Escala hacia arriba (solo lo difícil):**  
- Razonamiento intensivo, arquitectura, depuración compleja → deep-reasoner (Opus).  
- Decisiones críticas o callejones sin salida → deep-reasoner con `model: "fable"` (patrón *advisor*: el asesor devuelve una decisión concisa; un ejecutor barato la implementa).  

**Reutiliza subagentes (caché por agente):** cada subagente mantiene su propia caché entre llamadas. Para iterar con el mismo deep-reasoner o Codex, continúa la conversación con `SendMessage` en lugar de lanzar un agente nuevo — respawnear re-paga todo el contexto que el agente ya tenía cacheado.  

Codex (/codex:rescue --background) es un ingeniero experto al nivel de deep-reasoner, desde una perspectiva diferente. Trátalo como un par, no como un revisor.  
Decisiones de alto riesgo: asigna la misma tarea a deep-reasoner (Opus o Fable según el riesgo) + Codex en paralelo, sintetiza lo mejor de ambos, sin mostrarle a ninguno la respuesta del otro.  
