# Local evaluation follow-up — 2026-09-05

## Product contract

The owner explicitly confirmed that reloading a tab must preserve its selected IDE or ADE/Agents surface. The reload finding from the original evaluation is withdrawn. AGENTS.md and CLAUDE.md document this requirement; a fresh tab without a stored choice still defaults to Work Hub.

## Changes

- Terminal backend states stop transcript processing indicators even if an old tool trace remains unfinished.
- Each agent message records its completion time. Both initial rendering and incremental updates resolve duration from that message's user turn. Late trace updates preserve the completion timestamp.
- The live token estimate uses current-turn output instead of reusing conversation-wide provider usage. Its peak resets for each turn.
- Conversation index writes are serialized, including recovery after an unsuccessful write.
- Sidebar subscriptions observe conversation changes so new sessions can appear without reloading.
- Tasks carry their resolved agent identity; non-shell agents do not expose internal prompts as shell commands in the team view.
- Commit is the primary review action. Commit & Push remains an explicit menu choice. Missing configured checks are labelled “No automated checks configured”; this does not claim agent-run tests are CI checks.
- Transcript bottom spacing no longer subtracts the action-strip height. CLI update notices dismiss after eight seconds, except while hovered, focused or updating.

## Validation

- Full `npm run compile` and `npm run build:browser` passed.
- 109 targeted tests passed: persistence, message wire deltas, turn state/timing, team identity, live status, commit actions and sidebar behavior.
- Targeted ESLint and `git diff --check` passed. Upstream drift check: zero new deviations.
- Real browser interaction on a separate localhost:3107 development instance: Codex ran `node --test price.test.js`, reporting two passing tests without editing files. A subsequent turn retained the first turn's 16-second duration; its new live estimate started at zero.
- Cancellation stopped live processing; the restored transcript showed “Stopped after 25s” and “Turn cancelled.”
- Sessions appeared without F5. Startup can still show an empty sidebar briefly while project data loads.
- IDE remained selected after F5; Agents also remained selected when reloaded from Agents.
- Final response was visible above the composer at 1440×900 and 390×844. No JavaScript errors were reported. No EPERM persistence failure appeared in the final instance's log during this short check.

Local evidence is under `test-results/human-evaluation/`, including `fixed-desktop-final.png`, `fixed-mobile-final.png` and `server-fixed.log`. Test/build logs are under `test-results/qaap-evaluation-*`.

## Limits and remaining work

Historical turns without completion timestamps retain fallback estimates; their exact old durations cannot be reconstructed. The update-toast timeout has been implemented but was not visually re-triggered in the final run. The reported transient “GitLab User” identity was not reproduced; this development session consistently showed “Dev User”. A comprehensive Spanish translation review remains separate work.

This is a local usability verification, not production certification. Linux isolation, real OAuth, multiuser load and backup restoration still require deployment-environment verification. No VPS deployment, repository commit or push was performed.
