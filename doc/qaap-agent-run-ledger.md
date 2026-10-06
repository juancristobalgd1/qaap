# Qaap agent-run ledger

Durable record of agent runs (tasks), client command receipts and outbox effects in the tenant
SQLite database. Behind `QAAP_AGENT_LEDGER` (`on`, `1` or `true`); **off by default**. With the flag
off the task runner keeps rewriting `~/.qaap/agent-tasks/index.json` exactly as before.

Code: `packages/qaap-cloud-workspace/src/node/qaap-agent-run-ledger.ts` (store) and
`qaap-agent-task-runner-ledger.ts` (runner glue). Plan: phase 1, PR 1.1 (T3 Code orchestrator V2
patterns, without Effect).

## Location

Same rules as every Qaap SQLite store (`doc/qaap-sqlite-persistence.md`): the database is
`QAAP_SQLITE_STORE_PATH` when set (per-tenant backends: `/home/theia/.qaap/tenant.sqlite`), else
`~/.qaap/agent-tasks/index.sqlite`. It shares the process-wide connection (WAL,
`synchronous=FULL`, foreign keys on). Tenant backends receive `QAAP_AGENT_LEDGER=on` only when the
control plane has it on; the flag is applied when a tenant backend is created, so flipping it needs
a recreated backend (a deploy with a new image does that).

## Schema

The connection-wide `PRAGMA user_version` belongs to `@theia/qaap-persistence`, so the ledger
records its own versioned steps in `qaap_migration` (`agent-run-ledger/schema/v<n>`). Steps are
`CREATE … IF NOT EXISTS`; append, never edit.

- `qaap_agent_runs` — one row per run: `run_id` PK, `owner`, `conversation_id`, `parent_run_id`,
  `agent_id`, `model_id`, `cwd`, `state` (CHECK `queued|starting|running|succeeded|failed|cancelled|interrupted`),
  `queue_position`, `queue_held`, `native_session_id`, `resume_count`, `request_json` (only while
  queued), `task_json` (full task DTO, so the ledger replaces `index.json` losslessly; the exact task
  state such as `completed_with_warnings` lives there), timestamps, `last_error_class`, `reset_at`.
- `qaap_agent_command_receipts` — PK `(owner, command_id)`: the same client request id from two
  owners is two commands. References `(run_id, owner)` (deferred FK, cascade on run delete).
- `qaap_agent_outbox` — `effect_id` PK, `status` CHECK `pending|running|succeeded|failed|cancelled`,
  indexes `(status, available_at)` and `(run_id, status)`. References `(run_id, owner)`. Stores intent
  only (`kind`, payload), never env or argv (invariant I2). Nothing consumes it yet (PR 1.2).

## API

`commit({ receipt, runUpserts, runDeletes, effects, cancelEffectsFor })` is synchronous and runs in
one transaction. The receipt goes first with `INSERT OR IGNORE`; if it already existed the stored
result is returned (`duplicate: true`) and nothing else is written. Any failing step (CHECK, an
effect for a missing run, a run owned by someone else, a receipt whose run never lands) rolls back
the whole commit. Effects use `INSERT OR IGNORE`, so deterministic effect ids are idempotent.

## Owner isolation (I1)

Owners are stored as `trim().toLowerCase()` (no owner, i.e. local mode, is `_`). Every read takes an
owner; `listRunsForRecovery()` is the only cross-owner read and is used by the backend's own startup
restore. An upsert of an existing `run_id` with another owner fails, receipts and effects can only
point at the same owner's run, and a restored task snapshot whose owner does not match its row is
ignored.

## Runner integration (flag on)

- Startup: `index.json` is imported once into an empty ledger (BOM/CRLF tolerated) together with
  receipts for tasks that carry a `clientRequestId`; the file is never modified or deleted. A
  malformed file fails closed, as today (`recoveryState = 'failed'`, 503) and the import is retried
  on the next start. Tasks are then rebuilt through the same `restorePersistedIndex` policy
  (`running` → `interrupted`, queued without a valid request → `interrupted`).
- `create()`: the run row and the `clientRequestId` receipt commit together before the task becomes
  visible. A retry with the same `clientRequestId` (also after a restart) returns the same task. The
  in-memory 512-entry cache is not used.
- `persist()`: writes only the rows whose snapshot changed and deletes removed tasks, in one
  transaction. Write failures keep the existing gate (`storageWriteFailed`, admission paused).

## Rollback

Turn the flag off and restart: the runner reads `index.json` again. Tasks created while the flag
was on exist only in the ledger.
Turning it back on later does not re-import `index.json` (the import is recorded once), so tasks
created while it was off (including queued ones) are not in the ledger. Switch the flag with an
empty queue (after a deploy drain), in either direction.
