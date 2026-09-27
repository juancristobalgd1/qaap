# Agent goal loop ("Until done")

Rebuild of the goal-loop feature from closed PR #21 (`feat/agent-task-limits-and-queue`) on the
post-split architecture. PR #21 is reference for intent/UX only; none of its files are ported.

## Behaviour

The user enables **Until done** in the Work Hub composer and sends a prompt. The draft text is both
the goal and the first prompt. The backend then loops:

```
executing ──turn settled──▶ verifying ──all green──▶ evaluating ──done──▶ completed
    ▲              │ failed turn      │ checks fail          │ gaps
    └──────────────┴──────────────────┴──────────────────────┘  (next iteration, with feedback)
any phase ──budget exhausted──▶ blocked        any phase ──stop/cancel──▶ cancelled
```

- **Start guard:** requires a goal, auto-approve (manual approval → the toggle is disabled with a
  tooltip; the backend also rejects), no streaming turn, not in plan mode, no active loop.
- **Verify:** reuses the existing npm-script verifier (`node/qaap-agent-verification.ts`), not a new
  runner. When the turn's task already carries a verification verdict (the task runner verifies
  edited turns, with its own fix turns) that verdict is used as-is; otherwise the same
  `typecheck/build/test/lint` scripts run through `QaapAgentTaskRunner.runGenericCommand`. No
  scripts found → verify is skipped and the evaluator decides alone.
- **Evaluator:** one-shot agent CLI call via `runOneShotCommand` in read-only/plan mode, model from
  `resolveAgentModelForRequest` with `taskKind: 'review'` (user's own keys). Entry point:
  `QaapAgentTaskRunner.runReadOnlyOneShotPrompt` (read-only workspace flags + QAIQ plan mode), agent
  = the last turn's agent. Called only when verify
  is green. Input: goal, verify results, diff +/- counts, transcript excerpt (last 8 messages,
  ≤12k chars). Output contract, JSON only:
  `{"done": boolean, "confidence": "high"|"medium"|"low", "reasoning": string, "gaps": string[]}`.
  Unparseable output / call error → deterministic verdict from verify only: green checks →
  `completed` (low confidence); no checks → `blocked` (nothing can confirm the goal).
- **Feedback prompts:** `[Goal · turn failed]`, `[Goal · verify failed]` (failing check + log tail),
  `[Goal · gaps remain]` (evaluator reasoning + gaps).
- **Hook point:** `applyTaskOutcomeExtracted` (`store-activity2.ts`), where
  `maybeAutoContinueIncompleteTurn` runs today; an active loop takes precedence over auto-continue.
  Every terminal path reports to the runner through `notifyGoalLoopTurnSettled` (success,
  success-with-warnings, failed, cancelled, agent-blocked); a model-fallback retry of the same turn
  is not a settlement. Loop spawns also count against the existing `hasLoopSpawnBudget`: each loop
  turn is charged to the turn that triggered it (loop turns are their own budget roots, so this never
  caps the loop below `maxIterations`; it stops a turn whose automatic retries already spent it).
- **Other outcomes:** the agent asking the user a question (blocked signal) → `blocked`; the loop's
  turn cancelled (per-run stop) → `cancelled`.
- **User follow-ups:** only the newest turn drives the loop. A message the user sends mid-loop runs
  as a normal turn; the loop waits for it and judges its result (it does not count as an iteration).

## Budget defaults (`QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET`)

| Limit | Default | Notes |
|---|---|---|
| `maxIterations` | 8 | agent turns started by the loop |
| `maxDurationMs` | 2 h | wall clock from start |
| `maxEvaluatorCalls` | = `maxIterations` | enforced (was counted-only in #21) |
| `maxAgentRuntimeMs` | 60 min | "cost" = summed agent turn runtime (what billing debits) |

Exhaustion → `blocked` with a `stopReason`. Budgets are checked before each loop turn (iterations,
runtime, wall clock) and before each evaluator call (evaluator calls, wall clock). A 60 s sweep also
enforces the wall clock mid-turn (the running turn is not cancelled) and blocks a loop whose turn
vanished without an outcome (2 min grace). A backend restart during `verifying`/`evaluating` ends the
loop as `blocked` (that work is in-memory only).

## Protocol

- DTOs in `qaap-cloud-workspace/src/common/qaap-agent-goal-loop.ts`, mirrored in
  `qaap-shared-core/src/common/qaap-agent-conversation-client.ts` (shared-core cannot import
  cloud-workspace).
- `QaapAgentGoalLoopPhase = 'executing' | 'verifying' | 'evaluating' | 'completed' | 'blocked' | 'cancelled'`.
- `QaapAgentGoalLoopState { phase, goal, startedAt, updatedAt, iteration, anchorUserMessageId,
  budget, usage { evaluatorCalls, agentRuntimeMs }, lastVerify?, lastEvaluation?, stopReason? }`,
  persisted on the conversation (`goalLoop?`); summary gets `goalLoopPhase`, `goalLoopIteration`,
  `goalLoopMaxIterations`, `goalLoopStopReason`. Loop-posted user messages carry `goalLoopIteration`.
- `isGoalLoopActive(conv)` (common) is the suppression predicate (auto-continue today, per-turn push
  in phase 2).
- Routes under `/qaap/api/agent-conversations`: `GET /:id/goal-loop`, `POST /:id/goal-loop/start`
  (`{ goal, budget?, initialPrompt? }`), `POST /:id/goal-loop/cancel`. All answer
  `{ conversationId, goalLoop }`; errors are `{ error }` with 400 (no goal), 404, 409 (start guard).
- Start posts the first turn itself (`initialPrompt`, defaulting to `goal`), so the conversation must
  be idle: the client creates the conversation without `message` (or uses an idle one) and then calls
  `startGoalLoop`. A first turn that cannot start leaves the loop `blocked`.
- Event: `{ type: 'goal_loop', conversationId, cwd, goalLoop }` over the existing WS/SSE stream
  (`cwd` is needed for the per-owner event filter).
- Conversation cancel (composer stop) also cancels an active loop. `POST /goal-loop/cancel` stops only
  the loop; a turn already running finishes normally.
- Client helpers in shared-core: `startGoalLoop`, `cancelGoalLoop`, `fetchGoalLoopStatus`.

## Web Push

One push at `completed` / `blocked` (none at `cancelled`), tag `qaap-goal-loop-<conversationId>`,
route `conversation`. The per-turn completion push is suppressed while a loop is active.
Phase 1 exposes the hook: `QaapAgentGoalLoopRunner.onDidReachTerminalPhase` fires once per loop
(`completed`, `blocked` or `cancelled`, including a composer Stop) with `ownerLogin`, `cwd`, `title`
and the final state; phase 2 subscribes and filters out `cancelled`.

## UI placement

| Piece | Package |
|---|---|
| Until done toggle (disabled + tooltip under manual approval) | `qaap-composer` |
| Iteration N/M pill (reuses `qaap-sticky-composer-step-pill.ts`) | `qaap-composer` |
| Phase chip in transcript header (tooltip = stopReason) | `qaap-transcript` |
| Submit wiring (create without message, then `startGoalLoop` with the draft) | `qaap-work-hub` |

## Delivery

1. Protocol + runner + routes + specs (backend only).
2. Composer toggle, pills, Web Push.
3. Optional: "Retry until done" from the card menu.

Phase 1 lives in `qaap-cloud-workspace`: pure logic in `common/qaap-agent-goal-loop.ts`, the runner
in `node/qaap-agent-goal-loop-runner.ts` (bound as a `BackendApplicationContribution`), store wiring
(`setGoalLoop`, `notifyGoalLoopTurnSettled`, `cancelGoalLoopOnConversation`) and the routes in
`qaap-agent-conversation-endpoint.ts`.

Out of scope from #21: task queue/limits, GitHub evidence comments, VPS scripts.
