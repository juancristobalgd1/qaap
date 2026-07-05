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

## Fixed (landed, July 2026)
**The IDE view options (Preview / Terminal / Explorer / PR) had been duplicated INTO the
avatar menu by the WIP.** Resolution (per the user's reference screenshots): the views keep
their own dedicated **▷ view picker** (the `mobileViewPickerBtn` dropdown in the tab-bar
row, which already existed and works), and the avatar menu is back to the standard account
menu (IDE/Agents switch + Command Palette + Work Hub overview + Settings + Sign Out).

Fix: `qaap-workbench-top-bar-widgets.ts` `buildAccountMenuEntries()` no longer prepends the
IDE-header view entries — it just returns `buildQaapAccountMenuEntries(signedIn)`. The
IDE/Agents switch is still added separately by the caller (`onAccountClick` → `viewToggle`).

Note: the WIP helper chain `buildIdeHeaderViewMenuEntries()` / `activateIdeAvatarView()` /
`activate{Preview,Explorer}FromAvatar()` / `focusOrBootstrapPreview()` is now dead code (no
caller) but left in place — it keeps the `QaapMiniBrowserOpenHandler` / `QaapProjectBootstrapService`
injections used, so removing it would mean touching the DI-fragile factory. Optional cleanup
in a separate, bisectable step. (`activateTerminalFromAvatar()` is still live — used by the
top-bar terminal button `onTerminalClick`.)

Why a full revert was NOT the right move: reverting the top-bar files to the pre-WIP commit
`11fc06b19` compiles but throws a runtime DI error (`Could not start contribution …
'resolved'` — an async-dep contribution); the surgical `buildAccountMenuEntries()` edit
avoids that entirely.

Rollback safety: tag `qaap-master-1.71-pre173` → the last fully-working 1.71 master.
