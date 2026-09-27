# Verification and recovery improvements — 2026-09-06

## Delivered behavior

- The Changes panel shows each configured check's command, exit code, completion time and captured output. A successful exit is distinct from a result that still matches the repository files.
- Shell tasks retain Git worktree fingerprints from before execution and completion. An authenticated, ownership-checked request compares them with the current tree. Changes during or after execution invalidate the result; unavailable fingerprints never produce a current/green guarantee.
- While the checks panel is mounted, freshness is rechecked every five seconds. Unchanged checks preserve expanded output and keyboard focus. Starting another agent turn invalidates the displayed result pending reconciliation.
- The browser stores task references per conversation, not logs or credentials. Reopening checks reconciles those references with the backend rather than rerunning them. Queued tasks are no longer treated as completed. A network failure after task creation keeps the task reference for reconciliation.
- Restart recovery marks orphan running tasks as interrupted with a completion timestamp. It does not report them as successful.
- Session history distinguishes loading/error states and can render authenticated conversation workspaces before the project catalog arrives. Empty sidebar renders now subscribe to future updates too.
- Changes includes staged/unstaged file counts. Development bootstrap uses the same `dev` / `Dev User` identity as the backend.
- Windows commands default to a connected process. Real testing reproduced detached `npm test` returning no captured output; connected execution correctly captured the test report. Unix process-group behavior is preserved.

The explicit IDE/ADE reload contract is unchanged.

## Interface follow-up (2026-09-06)

- Spanish overlay now covers verification evidence, interruption and QAIQ recovery copy, session sidebar and commit history, commit review / staging, the CLI update notice, auth errors, and preview controls.
- English defaults for Preview no longer use Spanish source copy. User-stopped preview still matches both `Preview stopped` and the older `Vista previa detenida` message.

## Commit readiness follow-up (2026-09-06)

- Changes and the sticky composer now share a conservative check-readiness gate. A green result only counts when every check passed against the current files.
- Commit is blocked while checks are loading or running. Missing, stale, or failing checks ask for confirmation before the commit proceeds.
- The Changes toolbar shows that readiness next to the staged/unstaged counts. After a successful commit, previous check evidence is marked unknown so it cannot keep backing later edits.

## Validation

- Full compilation passed; subsequent frontend/backend scoped compilation passed after the final adjustments. Browser build passed.
- 87 targeted tests passed, covering command output and nonzero exit capture, restart recovery, endpoint ownership, fingerprint invalidation, check-loading races, compact-panel refresh scheduling, history bootstrap, and update-notice interaction.
- Targeted ESLint and `git diff --check` passed. Upstream drift check reported zero new deviations.
- Real browser verification on localhost:3107: ran the fixture's `npm run test` from Changes; saw two passing tests and captured output; modified its README; observed “Files changed — run checks again”; reloaded and reopened the conversation, recovering the same completion timestamp and result without rerunning it.
- Final browser startup displayed the existing history and Dev User. No JavaScript errors were reported. The passive update notice also disappeared during the browser check.

Evidence and logs are in `test-results/qaap-trust-*` and `test-results/human-evaluation/`, including `trust-stale-final.png`. The fixture alone received a package.json test script and README freshness probes.

## Limits

Freshness covers the readable Git worktree, not ignored files, external services, environment variables or dependency changes outside that tree. It is sampled, not an atomic lock on edits. Agent-written claims in a chat are not promoted into verified checks: this evidence comes from commands run through the checks panel.

Restored task references are local to this browser and validated by the server; clearing browser storage removes those references. Backend task records remain independent. Server-interruption recovery has automated coverage; this round did not perform a Linux/VPS failure drill.

New interface messages use localization APIs. The 2026-09-06 follow-up added Spanish overlays for verification evidence, interruption recovery, session and commit history, commit review, the CLI update notice, auth/login errors, and preview controls. English defaults no longer carry leftover Spanish copy. A complete Spanish audit of every `qaap/*` string in the fork remains outside this scoped pass. Linux multiuser isolation, real OAuth, sustained load and backup restoration still require deployment-environment verification. No production deployment, commit or push was performed.
