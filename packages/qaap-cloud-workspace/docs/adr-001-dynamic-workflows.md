# ADR-001: Dynamic Workflows (agent meta-harness)

**Status:** Accepted (decision 2 revised 2026-07-24 after auditing the job runtime)
**Date:** 2026-07-24
**Package:** `@theia/qaap-cloud-workspace`

## Context

Qaap already has several agent orchestration patterns implemented as separate runners:

- Prompt harness (`qaap-agent-default-workflow`)
- Team delegation (`qaap-task` + mailbox)
- Parallel runs (worktree fan-out)
- Research loop (propose → run → measure, with resume)
- Adversarial review (`@@QAAP:VERDICT@@`)
- Task-kind model routing

Separately, **Job Graphs / Job Loops** orchestrate durable `command` / `function` jobs (not coding-agent turns).

Product goal: a **Dynamic Workflow** layer that generalizes harnesses, loops, routing, and graphs for coding agents (qaiq, claude, codex, …) so new patterns compose without a new store each time.

## What the job runtime already provides

Audited before deciding — every row is implemented today, not planned:

| Capability | Where |
|---|---|
| Durable DAG with `dependsOn` | `QaapCreateJobGraphRequest`, `QaapJob.state` (`waiting` → `dependency_failed`) |
| Bounded retries with durable backoff | `QaapJobRetryPolicy`, state `retry_wait`, `nextAttemptAt` |
| Timeouts, cancellation, idempotency | `timeoutMs`, `cancelled`, `idempotencyKey` |
| Crash safety and restart recovery | state `interrupted`; `qaap-job-loop-engine` reconciles and restores running loops |
| Bounded loops with budgets | `maxIterations`, `maxDurationMs`, `maxJobs`, `QaapJobLoopTerminationReason` |
| Loop exit predicates | `until` + RFC 6901 JSON Pointer over a node result |
| Data flow between rounds | `QaapJobLoopInputBinding` |
| Concurrency and write safety | `resourceClass` lanes, `workspaceAccess: 'read' \| 'write'` leases |
| Typed extensible steps | `QaapJobFunctionDefinition` (`normalizeInput` + `execute` with `AbortSignal`, `emitOutput`) |

Building a second durable executor next to this would duplicate the hardest, most failure-prone half of the system.

## Gap analysis

What the agent meta-harness needs and the job runtime does **not** have:

1. **Conditional edges.** A job graph runs every node whose dependencies succeeded. There is no `when: verdict:fail → fix` branching.
2. **`join` `any` / `n`.** `dependsOn` is an implicit `wait: 'all'`.
3. **An agent turn as a node kind.** Job kinds are `command | function`; agent turns live in `QaapAgentTaskRunner`.
4. **Human gates.** No state that parks a run awaiting a person.

These four gaps — not durability — are the actual work.

## Decision

1. **Introduce an Agent Workflow IR** (`qaap-workflow-ir`) whose nodes are agent turns, routers, joins, judges, human gates, and deterministic steps — not a second Theia-AI chat orchestrator.
2. **(Revised) The workflow layer is a planner over the job runtime, not a new engine.** It decides *which node runs next* from the outcome of the node that just finished; durability, retries, budgets, leases, and restart recovery come from `QaapJob` / `QaapJobLoop`. The original decision — wrapping `QaapAgentTaskRunner` in a fresh engine — was taken before the audit above and would have re-implemented all of it.
3. **Job Graphs remain the runtime.** An agent turn becomes a durable step by way of a job (see open question below), not by growing a parallel scheduler.
4. **Machine-parseable sentinels** (`@@QAAP:…@@`) are the routing contract between agent nodes (reuse blocked / verdict patterns).
5. **Phase 1 ships pure IR + validation + the Implement→Review template** with a dry-run stepper. No UI change. No migration of `QaapAgentTaskRunner` yet.

## Resolved: how an agent turn becomes a durable step

**Decision: agent turns stay in `QaapAgentTaskRunner`; the workflow layer dispatches to both runtimes and reconciles their terminal events.**

Wrapping a turn in a `function` job was rejected because the runner already provides the same guarantees, and stacking them deadlocks:

- Durability: versioned index at `~/.qaap/agent-tasks/index.json` persists queued create requests; `restoreFromDisk()` re-marks lost processes as `interrupted`.
- Concurrency: a global cap (`QAAP_MAX_CONCURRENT_AGENTS`, default 4) **and** a per-user cap (default 2) with FIFO waiting.
- Liveness: idle-task watchdog and queued-approval grace timeouts.

A `function` job wrapping a turn would hold a job lane and a workspace lease while the inner task waits in the runner's FIFO queue — starvation, and deadlock once agent fan-out fills both queues. So the planner dispatches deterministic nodes as jobs, agent turns as agent tasks, and reacts to terminal events from either, the way `reconcileLoopsContaining(jobId)` already reconciles loops.

## Consequences

- New agent patterns start as `WorkflowDef` templates + planner steps, not new `*Store` classes.
- UI (Hub `workflows`) observes runs; it does not own graph semantics.
- Backend slots resolve via capability/tier → agent catalog bindings (no hardcoded vendor names in IR edges).
- Research / parallel / review keep current behavior until each is recompiled onto the planner behind the same UX.
- Loop budgets and resume semantics are inherited from job loops rather than redefined in the IR.

## Non-goals (phase 1)

- Visual graph editor
- Natural-language → IR compiler
- Bidirectional peer mailbox
- Replacing Job Loops

## Known limits

Still open, so nobody mistakes the current files for a finished product:

- `router` nodes are declared types without semantics: `policyId` is never evaluated, because capability/tier → agent resolution needs the agent catalog, which the reducer deliberately does not import.
- Edge conditions are literal equality on a closed outcome enum; composite predicates (`verdict:pass` **and** `risk:low`) are not expressible.
- Loop budgets (`maxNodeRuns`, `maxVisitsPerNode`) bound cycles by dispatch count only — no token or wall-clock budget.
- The dispatcher drives runs through ports, but no adapter implements them against the real runtimes yet, and nothing subscribes `onDidChangeTask` / `onDidChangeJob` to it. Nothing is bound in the backend module, so no user-visible behaviour changes yet.
- `promptRef` is not resolved: an adapter needs a prompt-template registry before an agent turn can actually be spawned.

## Code

- `src/common/qaap-workflow-ir.ts` — types, validation, Review template, pure stepper
- `src/common/qaap-workflow-run.ts` — run state + pure reducer: frontier, joins (`all`/`any`/`n`), bindings, human gates, loop budget, stall detection
- `src/common/qaap-workflow-outcome.ts` — runtime state → edge outcome, including the `@@QAAP:VERDICT@@` sentinel
- `src/node/qaap-workflow-run-store.ts` — durable owner-scoped runs (atomic index at `~/.qaap/workflow-runs`), restart restore, duplicate-report suppression, dispatch map, `interrupt()`
- `src/node/qaap-workflow-dispatcher.ts` — starts nodes through ports, routes terminal events back, reconciles on boot
- `src/node/qaap-workflow-runtime-ports.ts` — adapters binding the ports to `QaapAgentTaskRunner` / `QaapJobRuntime`
- `src/node/qaap-workflow-job-functions.ts` — `risk-classify` / `git-diff` as typed job functions
- `src/node/qaap-workflow-service.ts` — event subscriptions, boot reconciliation, the `start` entry point
- `src/node/qaap-workflow-endpoint.ts` + `src/common/qaap-workflow-api.ts` — authenticated `/qaap/api/workflows` HTTP API
- `src/common/qaap-workflow-template-registry.ts` — server-side allowlist of runnable graphs
- `src/common/qaap-workflow-prompt-registry.ts` — allowlisted `promptRef` resolution
- `src/common/qaap-workflow-routing.ts` — capability + tier → installed backend, configurable via `QAAP_WORKFLOW_AGENT_ROUTES`
- matching `*.spec.ts` files

## Done since phase 1

- Ports wired to both runtimes; `promptRef` resolved through the prompt registry; terminal events subscribed; `reconcileOnBoot()` called from the service.
- HTTP API starts runs by template id (allowlist), guards cwd with the same ownership check as jobs, and continues human gates.
- Capability/tier routing resolves an unpinned turn onto an installed agent; a pinned `agentRef` still wins, and an unresolved ref falls back to the runner default. No vendor is named in the IR.

## Next

1. Client surface: a Work Hub trigger to start a run and observe its nodes. (Deferred while the mobile-shell merge is in flight.)
2. Recompile one existing runner (review is the smallest) onto the planner behind unchanged UX.
3. Give deterministic ops `verify` / `shell` a runtime (currently they fail loudly by design).
