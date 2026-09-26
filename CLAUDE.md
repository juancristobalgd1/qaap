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

**Critical — surface persists across reload:** F5 in the same tab keeps the active surface (IDE or Work Hub) via `sessionStorage` only; a fresh tab defaults to Work Hub; never `localStorage`, URL or layout restore. Canonical rule: `.cursor/rules/work-hub-reload-default.mdc`.

**Critical CI/CD invariants:** every workflow is green on master since #125 (Sep 26, 2026). Before touching tenant spawning (`qaap-tenant-spawn-service.ts`), terminals, preview bootstrap, `examples/playwright` or `.github/workflows`, read `doc/qaap-ci-invariants.md`. Linux-only terminal failures with a 0px xterm textarea mean the spawn wrapper dropped the shell, not an xterm bug. See `.cursor/rules/ci-invariants.mdc`.

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

**Qaap persistence:** Node-owned persistent `qaap-*-store.ts` implementations use `@theia/qaap-persistence` and the built-in `node:sqlite` runtime with WAL and `synchronous=FULL`. Legacy JSON/JSONL files are imported once and retained for rollback; see `doc/qaap-sqlite-persistence.md`. This runtime sets the repo's Node.js minimum (see Technical Requirements).

## Architecture

**Monorepo Structure:**
- Lerna-managed monorepo with ~96 packages in `packages/` (19 of them `qaap-*`)
- `/packages/` - Runtime packages (core + extensions)
- `/dev-packages/` - Development tooling (application-manager, cli, eslint-plugin, ext-scripts)
- `/examples/` - Sample applications (browser, electron, browser-only, playwright)
- `/configs/` - Shared config files (tsconfig, eslint, mocha, nyc)

**Qaap product layer (`@theia/qaap-*`, fork-specific):**
- Example apps should depend on **`@theia/qaap-product`** once; it pulls `qaap-element-inspector`, `qaap-work-hub`, and `qaap-product-theme` and exposes a minimal frontend module so the extension collector loads them transitively.
- **`@theia/mini-browser`** still lists **`@theia/qaap-element-inspector`** directly (DI and imports from that package).
- **Work Hub package layers (September 2026 split of the old `qaap-mobile-shell` monolith):** `qaap-mobile-shell` (mobile mechanics only: gestures, touch scroll, keyboard, bottom bar, narrow layout) < `qaap-shared-core` (DTOs, clients, project services, GitHub/dev-preview backends) < `qaap-diff-review` < `qaap-agents-ui` < `qaap-transcript` < `qaap-composer` < `qaap-work-hub` (Work Hub UI + the frontend composition root that binds everything and imports all product stylesheets in cascade order). Imports only point down this list; `node scripts/qaap-package-graph-check.js` enforces no cycles, no undeclared `@theia/qaap-*` imports and no relative import escaping a package. When a lower layer needs a higher UI, type the host field with a structural contract (`qaap-transcript-host-contracts.ts`, `qaap-composer-host-contracts.ts`) instead of importing the class. Mapping and tooling: `scripts/qaap-refactor/split-*.js`, `doc/qaap-mobile-shell-split-plan.md`.
- Narrow mobile viewport breakpoint for TypeScript: **`MOBILE_NARROW_VIEWPORT_MEDIA_QUERY`** and **`matchesMobileNarrowViewport()`** in `packages/core/src/browser/shell/mobile-layout-state.ts` (keep CSS using the same `767px` breakpoint in sync). Narrow-viewport rules for menus / side panel / dialogs live in **`@theia/qaap-product-theme`** (`qaap-menus-narrow-viewport.css`, `qaap-sidepanel-narrow-viewport.css`, `qaap-dialog-narrow-viewport.css`); apps without that package will not get those overrides.
- **Mobile touch scroll (critical):** nested lists inside flex overlays must use `min-height: 0` + native overflow and be listed in `qaap-mobile-touch-scroll.css` and `MOBILE_VERTICAL_SCROLL_SELECTOR` (`mobile-vertical-touch-scroll.ts`). See `.cursor/rules/mobile-touch-accessibility.mdc`.

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

## Upstream-Drift Policy

**The rule:** all new Qaap product code lives under `packages/qaap-*`. Do not modify files inside upstream Theia packages (`packages/<anything not starting with qaap->`). Drift is enforced in CI by `scripts/qaap-drift-check.js`: every file that differs from the reviewed Theia revision pinned in `scripts/qaap-upstream-base.txt` must be either inside `packages/qaap-*`, matched by a regex in the `ALLOWED` list (with a comment explaining why), or listed in `scripts/qaap-drift-baseline.txt` (historical drift, currently limited to `examples/*` and `dev-packages/cli`; CI fails only on NEW drift outside both lists. Trim stale entries after each extraction: regenerate the file from the report output, keeping only paths that still differ).

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

### Workflow per extraction

1. Read the diff: `git diff upstream/master -- <file>`.
2. Decide: real product code → extract (next step); fork lag → revert with `git checkout upstream/master -- <file>` and skip to step 4.
3. If extracting: create or edit a `packages/qaap-*` package, add the rebind in its frontend module, then revert the upstream file (`git checkout upstream/master -- <file>`).
4. Drop the matching regex from `ALLOWED` in `scripts/qaap-drift-check.js`.
5. Verify in this order: `npm run compile`, `node scripts/qaap-drift-check.js`, `npm run build:browser`, and (for UI behaviour) `npm run start:browser` plus exercising the affected flow at the relevant viewport.
6. Commit per extraction so a regression can be bisected.

### Tracking upstream

The extraction campaign's end state was reached in July 2026: everything outside `packages/qaap-*` is byte-identical to upstream, a commented `ALLOWED` seam, or a recorded baseline entry. To adopt a newer Theia: `git fetch upstream`, repoint `refs/heads/upstream/master` to the new tip, then fast-forward every file the fork never diverged from (blob-identity criterion: HEAD blob == old-upstream blob → pure upstream-side drift) in one mechanical commit, and bring product-seam files forward with a 3-way `git merge-file` (fork / old upstream / new upstream). Advance `scripts/qaap-upstream-base.txt` to the new SHA only as part of that deliberate triage, and re-run `node scripts/qaap-drift-check.js`.

The full campaign log — per-package extraction checklists, waves 1–4, the AI waves and server-tools adoption, formalized product policies (e.g. single-root AI functions, PR-review redesign, agent model-alias pinning), Codex session ids and superseded plans — lives in [`doc/qaap-drift-history.md`](doc/qaap-drift-history.md). Read it before re-adopting any `ai-*` file.

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

- Node.js ≥22.13.0 (`engines` in root `package.json`) — the first release where `node:sqlite` works without `--experimental-sqlite`; `.nvmrc` pins 22, CI tests 22.x and 24.x, Node 24 recommended
- TypeScript ~5.9.3 with strict settings (target ES2022, module CommonJS)
- React 18.3.1 for UI components (pinned via root `overrides` against core's `^18.3.1 || ^19.0.0` peer range)
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
