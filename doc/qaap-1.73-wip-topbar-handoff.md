# Hand-off: unfinished top-bar / IDE-view WIP (Theia 1.73)

Context: `master` was upgraded to Theia 1.73 by content-syncing the pure 1.73 branch
`qaap/merge-1.73` and cherry-picking the security + latency work on top (no rollback
merge). Its tip commit `068a3d9f3` — *"WIP: top-bar/landing-state work in progress"* —
carries an **incomplete UX refactor** of the IDE top-bar. Two user-visible regressions
came from it; one is fixed, one is handed off here.

## Fixed (landed)
- **Work Hub avatar → IDE/Agents switch → "IDE" did not enter the IDE.** The Work Hub
  segmented switch ran `qaap.mobile.ideHeaderView.activate('editor')` (an *in-IDE* header
  view swap) instead of `qaap.mobile.openDesktopIde` (the Work-Hub→IDE surface transition).
  Fixed in `mobile-projects-sessions-sidebar-ui.ts` (viewToggle `onSelect` routes
  `editor` → `qaap.mobile.openDesktopIde`).

## Open — needs the WIP author (design intent + interactive testing)
**The IDE view options (Preview / Terminal / Explorer …) were moved from FIXED TABS
(left of the Welcome tab) INTO the avatar menu, incompletely.** Desired end-state per the
user: those views should be **fixed tabs again**, and the avatar menu should be the
standard account menu.

Where the WIP moved them (all in `packages/qaap-mobile-shell/src/browser/`):
- `qaap-workbench-top-bar-widgets.ts`: added `buildIdeHeaderViewMenuEntries()` +
  `activateIdeAvatarView()` + `activate{Preview,Terminal,Explorer}FromAvatar()`, and made
  `buildAccountMenuEntries()` prepend those view entries to the account menu. Constructor
  now injects `TerminalService` / `QaapMiniBrowserOpenHandler` / `QaapProjectBootstrapService`
  (via `qaap-workbench-top-bar-factory.ts`). Also removed the top-bar terminal-toggle button.
- `qaap-workbench-account-menu.ts`: added the `run?` callback field to menu entries.
- View source of truth: `mobile-shell-bottom-bar-controller.ts` `getMobileIdeHeaderViewButtons()`
  / `activateMobileIdeHeaderView()`.

Why an outside pass can't finish it safely: reverting the top-bar files to the pre-WIP
commit `11fc06b19` compiles but throws a runtime DI error (`Could not start contribution …
'resolved'` — an async-dep contribution); and the account menu's render/enable guards drop
most standard commandId entries in the IDE context (only Sign Out survives), so the base
menu alone shows a single option. Deciding tabs-vs-menu and completing/reverting the tab
rendering needs the design intent and live click-testing.

Rollback safety: tag `qaap-master-1.71-pre173` → the last fully-working 1.71 master.
