# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

This is a Lerna-managed Eclipse Theia monorepo fork for Qaap.

- Runtime packages live in `packages/`.
- Development tooling lives in `dev-packages/`.
- Example applications live in `examples/`.
- Shared configuration lives in `configs/`.
- Qaap product code should live under `packages/qaap-*`.

## Non-negotiable agent rules

- Do not run `.ts` source files directly with `npx tsx`, `ts-node`, or `node`. Packages import compiled `lib/` output from each other, so source execution commonly fails with missing compiled modules.
- Compile before running compiled tests or behavior checks.
- Avoid editing upstream Theia packages unless the task explicitly requires a documented seam. Prefer extracting Qaap behavior into `packages/qaap-*`.
- Keep the upstream-drift policy green. After changes that could affect drift, run `node scripts/qaap-drift-check.js`.
- Treat existing uncommitted changes as user-owned. Do not reset, overwrite, or revert unrelated work.
- User-facing strings must be localized with `nls.localize()` or `nls.localizeByDefault()`.

## Required environment

- Node.js `>=22` (`package.json` engines). Node 24 is the recommended default in project docs.
- npm workspaces with Lerna.
- Python 3 and native build tooling may be required by `node-gyp` dependencies.

## Common commands

| Goal | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Compile TypeScript | `npm run compile` |
| Build browser app bundle | `npm run build:browser` |
| Start browser app | `npm run start:browser` |
| Run lint | `npm run lint` |
| Run all tests | `npm run test` |
| Run Theia package tests | `npm run test:theia` |
| Run browser tests | `npm run test:browser` |
| Run Playwright tests | `npm run test:playwright` |
| Check Qaap upstream drift | `node scripts/qaap-drift-check.js` |
| Generate drift report | `npm run qaap:drift-report` |

Package-scoped commands:

```sh
npx lerna run compile --scope @theia/package-name
npx lerna run test --scope @theia/package-name
npx lerna run watch --scope @theia/package-name --include-filtered-dependencies --parallel
```

Run a single test file only after compilation, and point Mocha at compiled output:

```sh
npx mocha ./packages/core/lib/browser/some-file.spec.js
```

## Verification expectations

For most code changes:

1. `npm run compile`
2. `node scripts/qaap-drift-check.js`
3. Run targeted package tests when practical.

For browser/UI changes:

1. `npm run compile`
2. `npm run build:browser`
3. `npm run start:browser`
4. Exercise the affected flow manually or with Playwright.

`npm run compile` does not bundle frontend changes into the browser example. Use `npm run build:browser` before browser UI testing.

## Qaap product constraints

- Work Hub is the default surface on a fresh browser tab.
- Preserve the user's active surface (IDE or ADE/Agents/Work Hub) across reload/F5 in the same tab. This is intentional product behavior, confirmed by the owner on 2026-09-05; do not reset IDE to ADE on reload.
- Persist that explicit surface choice in `sessionStorage` for the current tab. A new tab without a stored choice defaults to Work Hub. Do not use `localStorage`, URL state or restored layout as the surface selector. See `.cursor/rules/work-hub-reload-default.mdc`.
- Example apps should depend on `@theia/qaap-product` once so the Qaap product extensions are pulled transitively.
- Keep mobile viewport behavior synchronized between TypeScript helpers and CSS breakpoints.
- For nested scrollable mobile overlays, ensure flex children use `min-height: 0` with native overflow where needed.

## Upstream-drift workflow

When touching a non-`qaap-*` package:

1. Inspect the upstream diff:

   ```sh
   git diff upstream/master -- path/to/file
   ```

2. Decide whether the difference is:
   - Qaap product behavior: extract it into `packages/qaap-*` where possible.
   - Fork lag: re-adopt upstream.
   - A documented seam: keep it allowlisted with a clear comment.

3. Re-run:

   ```sh
   npm run compile
   node scripts/qaap-drift-check.js
   ```

## Code style

- Use 4 spaces for indentation.
- Use single quotes for strings.
- Prefer `undefined` over `null`.
- Use PascalCase for types/enums and camelCase for functions, methods, properties, and variables.
- Use kebab-case filenames named after the primary exported type.
- Prefer arrow functions.
- Declare explicit return types.
- Prefer property injection over constructor injection in InversifyJS classes.
- Use `@postConstruct()` for initialization.
- Use `ContributionProvider` rather than `@multiInject`.
- Use `bindRootContributionProvider` in top-level modules unless contributions are intentionally child-container scoped.
- Use URI strings for cross-platform file paths rather than raw filesystem paths.

## Architecture reminders

- Platform folders have strict dependency boundaries:
  - `src/common/`: shared APIs.
  - `src/browser/`: browser and DOM frontend code.
  - `src/node/`: backend Node code.
  - `src/electron-browser/`: Electron renderer code.
  - `src/electron-main/`: Electron main process code.
- Theia extension entry points are declared in each package’s `package.json` under `theiaExtensions`.
- Services should generally be classes with DI bindings. Avoid exported free functions for behavior that may need overriding.

## Useful references

- `CLAUDE.md` contains additional repo-specific handoff notes and current drift history.
- `doc/Developing.md` covers build and development setup.
- `doc/Testing.md` covers test conventions.
- `doc/coding-guidelines.md` covers Theia style rules.
- `doc/Plugin-API.md` covers plugin API patterns.
