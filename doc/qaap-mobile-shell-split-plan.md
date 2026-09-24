# Splitting `qaap-mobile-shell`

Status: **done (2026-09-24)**. Owner decision: split the package into
`qaap-work-hub`, `qaap-transcript`, `qaap-composer`, `qaap-diff-review` and `qaap-agents-ui`,
leaving in `qaap-mobile-shell` only real mobile mechanics (gestures, touch scroll, keyboard,
narrow-viewport layout).

## Outcome

Layers (imports only point down; `scripts/qaap-package-graph-check.js` enforces it):

| Package | Files (incl. specs) | Role |
|---|---|---|
| `qaap-mobile-shell` | 21 | mobile mechanics (was `qaap-mobile-mechanics` during the split) |
| `qaap-shared-core` | 342 | DTOs, clients, stream parsers, project services, GitHub/dev-preview/client-error backend |
| `qaap-diff-review` | 35 | diff review, PR panel, git-review backend endpoint |
| `qaap-agents-ui` | 20 | agent picker, sign-in dialogs, CLI update notice |
| `qaap-transcript` | 241 | transcript rendering, execution timeline, markdown worker |
| `qaap-composer` | 125 | sticky composer, sheets, attachments, MCP plugin icons |
| `qaap-work-hub` | 247 | Work Hub UI, shell controllers and the frontend composition root |

Before splitting, a dead-code pass removed ~40k lines unreachable from the entry points
(the pre-split `mobile-workbench.css`, 21 re-export shims into `qaap-transcript-overlay`,
~150 unused exports and ~95 unused class members, and the tests that only covered them).
Test totals were preserved step by step: 2579 passing + 6 pending across the seven packages
(plus 73 specs moved to `qaap-transcript-overlay`, which owns the code they test).

Deviations from the steps below:

- S3 was done by inverting the remaining type-only cycles with structural contracts
  (`qaap-transcript-host-contracts.ts`, `qaap-composer-host-contracts.ts`, `ChatSessionActivityApi`)
  instead of splitting DTO modules; the assignment itself came from `split-settle.js`
  (cluster-aware, resolves every upward value edge by moving the cheaper side) plus
  `split-overrides.csv`.
- DI bindings stay in the Work Hub composition root, except the mechanics module
  (`qaap-mobile-shell-frontend-module`) and the backend modules of shared-core and
  diff-review. Stylesheets live in their packages but are all imported from the root module so the
  cascade order is unchanged.
- `QaapMobileAppTesterContribution` (AI App Tester) stays in the Work Hub, not in mechanics.
- `qaap-cloud-workspace` keeps its declared dependency on the Work Hub package (it no longer imports
  from it) so its frontend contributions still start after the Work Hub's.
- The Playwright mobile suite was not run locally (no browsers installed); CI runs it, and the
  app was checked by hand at desktop and 375px widths after S2, S4, S7 and S9.

## Where we start

`packages/qaap-mobile-shell/src` holds 1,014 files (~220k LOC) and is the whole product frontend,
not a "mobile shell". A file-level import graph (5,369 edges) with every file classified into its
target package gives:

| Target | Files | LOC |
|---|---|---|
| qaap-mobile-shell (mechanics only) | 30 | 8,020 |
| qaap-shared-core (DTOs, clients, shared services) | 227 | 36,791 |
| qaap-diff-review | 48 | 9,416 |
| qaap-agents-ui | 32 | 7,670 |
| qaap-composer | 114 | 29,674 |
| qaap-transcript | 332 | 71,625 |
| qaap-work-hub (incl. the composition root) | 231 | 57,987 |

Every pair of target areas imports each other in both directions today, so a naive split creates
package cycles everywhere. The causes:

1. The composition root (`mobile-one-column-shell-contribution*`, shell controllers/bootstrap)
   imports every area. It belongs to `qaap-work-hub` (the top of the DAG), not to mechanics.
2. ~15-20 entangled DTO modules (`qaap-agent-conversation-client`, `transcript-turn-status`,
   `trace-model`, `agent-stream-metrics`, `qaiq-stream`, `composer-git-action-display`,
   `composer-skill-display`, `sticky-composer-approval-policy/mode`, `agents-hub-landing`,
   `scm-changes-icon`, git-review types, the type part of `mobile-projects-types`, ...) must move
   into `qaap-shared-core`, or be inverted behind DI symbols.
3. 354 import sites in other packages (342 in `qaap-cloud-workspace`) target
   `@theia/qaap-mobile-shell/lib/...`, all shared-core or a few work-hub files; none target
   mechanics.

There is no package-level cycle with other qaap packages today: `qaap-mobile-shell` depends on
adapters, ai-openrouter, element-inspector, persistence, qaap-shell and transcript-overlay;
cloud-workspace, ai-config and qaap-product depend on it, never the reverse.

## Naming strategy

Mechanics is the bottom layer (57 inbound import lines, 3 outbound outside the composition root),
so it is extracted first under a temporary name, `@theia/qaap-mobile-mechanics`. Everything else
is extracted bottom-up, and one final commit swaps the names (monolith remainder →
`qaap-work-hub`, mechanics → `qaap-mobile-shell`).

- Renaming the monolith first would rewrite the 354 external sites twice.
- Re-export shims in `qaap-mobile-shell/lib` would make mechanics depend on shared-core in the
  end state (a cycle) and hide the churn.

With the temp name, each external site is rewritten once, directly to its final package; only
the ~60 mechanics import sites change twice.

## Steps (one bisectable commit each)

- **S0** Land in-flight work touching `qaap-cloud-workspace` / `qaap-mobile-shell`; freeze both
  packages until the split is done.
- **S1 Tooling** (`scripts/qaap-refactor/`): `split-mapping.csv`; `split-move.js --pkg <name>`
  (`git mv` mapped files, rewrite imports with the TypeScript compiler API: relative inside a
  package, `@theia/<pkg>/lib/...` across packages, also `require`/dynamic `import()` and
  spec paths into `src/`; update `package.json` dependencies and the `@ts-nocheck` baseline; fail
  on unresolved imports); `qaap-package-graph-check.js` (no relative import escapes a package,
  no cycles, no undeclared `@theia/qaap-*` edges).
- **S2 Mechanics → `packages/qaap-mobile-mechanics`** (22 files + `mobile-snackbar.ts` +
  `qaap-mobile-touch-scroll.css`). Own frontend module binding `MobileEditorGestureContribution`,
  `LongPressContextMenuContribution`, `MobileTouchScrollContribution`,
  `QaapMobileAppTesterContribution` and app preferences; copy `test-support/ensure-jsdom.js`;
  wire into the monolith and `qaap-product`; `npm install` for `compute-references`; update the
  paths in `.cursor/rules/mobile-touch-accessibility.mdc` and CLAUDE.md.
- **S3a..n Close the shared-core boundary inside the monolith**: reclassify/split the DTO modules
  above (or invert with DI symbols) until shared-core imports only shared-core, mechanics or
  outside packages (today: 28 edges to transcript, 23 to work-hub, 12 to composer, 6 to
  agents-ui, 1 to diff-review). No file moves, so every commit is trivially green.
- **S4 Extract `qaap-shared-core`** (~245 files): the backend module (GitHub, dev-preview,
  git-review, client-error endpoints), shared frontend bindings, `resources/` and icon-sync
  scripts; rewrite ~330 external sites in cloud-workspace and ai-config.
- **S5-S8 Extract diff-review, agents-ui, transcript, composer**, each preceded by cut commits
  until it has zero edges into the remainder (today: diff-review→work-hub 8; agents-ui→work-hub
  21 / →transcript 18; transcript→composer 45 / →work-hub 137; composer→work-hub 83). Each package
  imports its own `style/*.css`. Transcript: repoint `qaap-transcript-markdown-worker.js` in
  `examples/{browser,electron}/webpack.config.js`.
- **S9 Name swap**: `packages/qaap-mobile-shell` → `packages/qaap-work-hub`
  (`@theia/qaap-work-hub`), `packages/qaap-mobile-mechanics` → `packages/qaap-mobile-shell`;
  rewrite remaining work-hub and mechanics import sites; update qaap-product, CLAUDE.md,
  `.cursor/rules`, workflow path filters and docs.

## Verification per step

`npm run compile`; `qaap-package-graph-check.js`; `npm run lint` (also diff warning counts:
`import/no-extraneous-dependencies`, `@theia/no-src-import` and `@theia/runtime-import-check` are
only warnings in the ratchet); `node scripts/qaap-ts-nocheck-ratchet.js` (baseline paths move in
the same commit); `node scripts/qaap-drift-check.js`; tests of every touched package, comparing
total test counts so no spec silently drops out of a glob (packages with browser specs need
`--require ./test-support/ensure-jsdom.js`). At S2, S4, S7 and S9 also `npm run build:browser`,
start the app, check the narrow viewport (touch scroll, Work Hub reload default) and run the
qaap mobile Playwright suite: DI binding errors only show up at startup.

## Effort and risks

~11 days: S1 1d, S2 0.5d, S3 2-3d (the real work), S4 1d, S5-S6 0.5d each, S7 2d, S8 1.5d, S9 1d.
Risks: composer/transcript/agents-ui may not cut cleanly (fallback: merge them into one package
rather than roll back); module-level side effects (CSS imports, jsdom setup order) move with
files; missing DI bindings only appear at startup. Each step is one commit, so `git revert`
suffices.
