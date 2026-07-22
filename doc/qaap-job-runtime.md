# Qaap job runtime

`QaapJobRuntime` executes durable workspace jobs without involving a coding agent. It supports
isolated `command` jobs and typed, registered `function` jobs. Orchestration and persisted state do
not depend on an agent protocol, so future container or remote executors can use the same scheduler.

## API

The authenticated API is rooted at `/qaap/api/jobs`:

- `POST /qaap/api/jobs` creates a job.
- `GET /qaap/api/jobs` lists the caller's jobs.
- `GET /qaap/api/jobs/functions` lists registered typed functions and their JSON schemas.
- `POST /qaap/api/jobs/graphs` validates and creates a complete DAG atomically.
- `GET /qaap/api/jobs/graphs` lists the caller's graphs.
- `GET /qaap/api/jobs/graphs/:id` returns a graph and its current jobs.
- `GET /qaap/api/jobs/:id` returns a job and its bounded log.
- `POST /qaap/api/jobs/:id/cancel` cancels queued or running work.

Example request:

```json
{
  "title": "Compile workspace",
  "kind": "command",
  "command": "npm run compile",
  "cwd": "/workspace/repos/users/alice/org/project",
  "resourceClass": "cpu",
  "workspaceAccess": "read",
  "dependsOn": [],
  "timeoutMs": 900000,
  "idempotencyKey": "compile:commit-sha"
}
```

A typed function job uses the same scheduler without starting a shell:

```json
{
  "kind": "function",
  "functionId": "qaap.workspace.package-manifest",
  "input": { "includeDependencies": true },
  "cwd": "/workspace/repos/users/alice/org/project",
  "retryPolicy": {
    "maxAttempts": 3,
    "initialBackoffMs": 1000,
    "multiplier": 2,
    "maxBackoffMs": 30000
  }
}
```

Function definitions declare their input/output schemas, resource class and workspace access mode.
Inputs are validated before admission, structured results are persisted, cancellation is delivered
through `AbortSignal`, and retry policies are bounded to ten attempts.

`Idempotency-Key` may be supplied as an HTTP header instead of the JSON field. Replaying the same
owner, key and normalized request returns the original job. Reusing the key for different work is a
`409 Conflict`.

Built-in functions currently include:

- `qaap.workspace.package-manifest`, for structured `package.json` metadata.
- `qaap.workspace.read-json`, for a complete bounded JSON file or one RFC 6901 JSON Pointer value.

## Durable graph loops

`QaapJobLoopEngine` repeats a complete job graph until a deterministic condition matches. It is
independent of coding agents: every round is submitted to the same job scheduler, so graph
dependencies, retries, quotas, workspace leases and tenant isolation still apply.

The authenticated loop API is rooted at `/qaap/api/job-loops`:

- `POST /qaap/api/job-loops` creates and starts a bounded loop.
- `GET /qaap/api/job-loops` lists the caller's loops.
- `GET /qaap/api/job-loops/metrics` returns owner-scoped aggregate loop, round and job counters.
- `GET /qaap/api/job-loops/events` streams owner-scoped durable events with Server-Sent Events.
- `GET /qaap/api/job-loops/:id` returns durable state and round history.
- `GET /qaap/api/job-loops/:id/rounds/:iteration` returns that round's graph and public job state.
- `POST /qaap/api/job-loops/:id/cancel` cancels the loop and unfinished jobs in its current graph.

Example: run an improvement command, read its metric without an agent, and stop when the score is
at least 90:

```json
{
  "title": "Raise quality score",
  "graph": {
    "nodes": [
      {
        "key": "improve",
        "request": {
          "command": "npm run improve-quality",
          "cwd": "/workspace/repos/users/alice/org/project",
          "resourceClass": "cpu",
          "workspaceAccess": "write"
        }
      },
      {
        "key": "measure",
        "dependsOn": ["improve"],
        "request": {
          "kind": "function",
          "functionId": "qaap.workspace.read-json",
          "input": { "path": "metrics.json", "pointer": "/quality/score" },
          "cwd": "/workspace/repos/users/alice/org/project"
        }
      }
    ]
  },
  "until": {
    "nodeKey": "measure",
    "source": "result",
    "pointer": "/value",
    "operator": "greater_or_equal",
    "expected": 90
  },
  "maxIterations": 10,
  "maxDurationMs": 3600000,
  "idempotencyKey": "quality-loop:commit-sha"
}
```

Conditions can inspect a node's structured `result` or its public `job` fields. Supported operators
are `equals`, `not_equals`, the four numeric comparisons, `truthy`, and `falsy`. A missing pointer
never matches, including `falsy`, which prevents absent measurements from accidentally completing a
loop.

Every request has hard iteration and duration limits. Admission also verifies `nodes × iterations`
against the job budget, and each owner has an independent active-loop cap. Loop state is written
atomically to `~/.qaap/job-loops/index.json`. Graph-round idempotency lets reconciliation recover the
exact in-flight round after a backend restart without duplicating its jobs.

### Live control plane and previous-round bindings

Choose **Open IDE**, then open **Job Loops** from the command palette to inspect owner-scoped
metrics, loop progress, every round's graph and dependency state, or cancel an active loop. The
panel keeps one SSE connection, batches refreshes during event bursts and reconnects through the
browser's native `EventSource` behavior. The event endpoint sends a complete initial snapshot and
accepts `Last-Event-ID`, allowing a reconnection to replay the bounded durable event history without
exposing inputs, results or logs.

A function node may copy structured data from the preceding round into an existing field in its
next input. This makes feedback loops independent of an agent while preserving typed function
validation. For example, from round 2 onward this copies the preceding `measure` result into
`improve`'s `previousScore` input:

```json
{
  "key": "improve",
  "request": {
    "kind": "function",
    "functionId": "qaap.example.improve",
    "input": { "previousScore": 0 },
    "cwd": "/workspace/repos/users/alice/org/project"
  },
  "bindings": [
    {
      "from": {
        "nodeKey": "measure",
        "source": "result",
        "pointer": "/value"
      },
      "targetPointer": "/previousScore"
    }
  ]
}
```

Bindings use RFC 6901 JSON Pointers and are limited to 32 per node. They are accepted only for
typed function inputs, never interpolated into shell commands, and the target must already exist in
the template input. Missing source data stops the loop with `binding_missing` instead of scheduling
work with incomplete input. The function's registered schema validates the fully materialized input
before the next graph is admitted.

### Visual builder, templates, and automation

The **Job Loops** panel includes a keyboard-accessible graph builder. It creates command or typed
function nodes, dependency edges, previous-round bindings, stop conditions, and hard iteration/time
budgets. The browser performs a preflight check for duplicate keys, missing edges, cycles, invalid
JSON Pointers and budget overflow; the backend remains authoritative and repeats the same validation
before admitting any work. Drafts remain in widget memory and are never persisted in browser
`localStorage`.

The panel has separate **Runs** and **Templates and automation** views. A validated graph can be
saved directly from the builder, reopened for editing, executed with a fresh idempotency key, exported
or imported as JSON, and deleted with revision protection. The automation view creates and edits
interval, cron and webhook triggers, supports enable/disable and manual fire, and displays a newly
created webhook secret exactly once in transient widget state. The command palette also exposes
**Manage Job Loop Automation**.

Reusable private definitions are stored under `/qaap/api/job-loop-templates`:

- `GET /qaap/api/job-loop-templates` lists only the caller's templates.
- `POST /qaap/api/job-loop-templates` validates and creates a template.
- `GET` and `PATCH /qaap/api/job-loop-templates/:id` read or update it. Updates require its current
  `revision`, preventing silent concurrent overwrites.
- `DELETE /qaap/api/job-loop-templates/:id` requires the current `revision`. A template referenced
  by a trigger cannot be deleted until that trigger is removed.
- `GET /qaap/api/job-loop-templates/:id/export` returns a portable versioned document without owner,
  id, revision or lifecycle metadata; tenant-root paths are made relative when possible.
- `POST /qaap/api/job-loop-templates/import` imports that document under the authenticated owner.
- `POST /qaap/api/job-loop-templates/:id/run` revalidates every workspace path and starts the stored
  definition. `Idempotency-Key` provides retry-safe execution.

Templates are limited to 100 per owner, with bounded names, descriptions and serialized definitions.
They are written atomically to `~/.qaap/job-loop-templates/index.json` with directory mode `0700` and
file mode `0600`. Every create, update, import, manual run and automated run resolves the workspace
against its owner; a portable or legacy path never becomes an authorization bypass.

Durable schedules and signed webhooks are rooted at `/qaap/api/job-loop-triggers`:

- `GET` and `POST /qaap/api/job-loop-triggers` list or create owner-scoped triggers.
- `PATCH` and `DELETE /qaap/api/job-loop-triggers/:id` update or remove them. Trigger kind is
  immutable because webhook secrets are disclosed only once.
- `POST /qaap/api/job-loop-triggers/:id/fire` runs an owned trigger immediately.
- `POST /qaap/api/job-loop-triggers/:id/webhook` is the only public trigger route. It requires the
  one-time secret in `X-Qaap-Webhook-Secret`; an optional `X-Qaap-Webhook-Delivery-Id` makes delivery
  retries durable and idempotent. The request body cannot override the template, owner or workspace.

Interval triggers accept 5 to 10,080 minutes. Cron triggers accept a valid five-field expression,
an IANA timezone and an optional one-shot flag. A minute scheduler derives fixed-length idempotency
keys from the trigger and schedule slot, serializes each trigger independently, and never overlaps a
trigger whose prior run is still being admitted. Webhook secrets are generated from 256 bits of
randomness, stored only as SHA-256 digests, and compared in constant time. The last 256 delivery ids
per trigger are persisted for duplicate suppression. Trigger state is atomic at
`~/.qaap/job-loop-triggers/index.json` with modes `0700`/`0600`.

Scheduled interval and cron slots use atomic filesystem claims keyed by `trigger id + canonical
slot`. Replicas sharing `QAAP_JOB_LOOP_TRIGGER_LEASE_DIR` therefore admit a slot only once. A claim
contains independent instance and lease UUIDs, is created with exclusive `O_EXCL` semantics, cannot
be removed by a different owner, survives process shutdown for its bounded TTL, and is reclaimed
only after expiry. Expired unique-slot claims are cleaned opportunistically. Manual and webhook
leases use unique event slots and are released after admission; deterministic engine idempotency is
still retained as defense in depth.

Warm replicas read templates and triggers through from their shared atomic indexes before scheduler
ticks, lookups and mutations, so a failover observes definitions created by another process. For
multi-replica operation, the template, trigger, lease, loop and job state directories must all reside
on the same POSIX-compatible shared volume. The slot lease prevents duplicate scheduler admission;
installations that allow simultaneous management writes through several replicas should use sticky
management routing or replace the JSON indexes with a transactional database-backed store. The
provided Docker Compose remains a single-backend deployment and needs no shared-volume setup.

## Graph and concurrency semantics

An individually created job may depend only on existing jobs owned by the same user. A job becomes
runnable only after all dependencies succeed, and becomes `dependency_failed` if any of them ends
unsuccessfully.

For atomic graph creation, each node has a local `key`, a `request`, and optional local keys in
`dependsOn`. Qaap validates every path, function input, edge and cycle before inserting any node.
Graph-level idempotency replays the complete original DAG and rejects key reuse with changed work.

The scheduler applies all of these constraints before starting a process:

1. Global concurrency cap.
2. Per-owner concurrency cap.
3. Resource-lane cap (`cpu`, `io`, `network`, `workspace`, or `deployment`).
4. A reader/writer lease for the canonical workspace path.

Read jobs can share a workspace. A write job is exclusive, and a queued writer blocks later readers
so it cannot starve. Among otherwise runnable jobs, owners with fewer active jobs are preferred.

## Durability and isolation

State, normalized requests and bounded logs are stored atomically in `~/.qaap/jobs/index.json`.
The directory is mode `0700` and the index is mode `0600`. Queued and dependency-waiting jobs resume
after a backend restart; a job that was running becomes `interrupted`, because its prior process
cannot be reattached safely.

Commands are launched through `QaapTenantSpawnService`, which enforces the same per-tenant uid and
workspace isolation as agent tasks. The environment is allowlisted rather than copied wholesale,
so backend credentials are not inherited by generic jobs.

Registered functions are trusted backend extensions and run in-process. Their cancellation is
cooperative. The function context provides `resolveWorkspacePath()`, which resolves real paths and
rejects traversal or symlink escapes before a function reads workspace files.

## Configuration

| Variable | Default |
| --- | ---: |
| `QAAP_JOB_MAX_CONCURRENT` | `8` |
| `QAAP_JOB_MAX_CONCURRENT_PER_USER` | `4` |
| `QAAP_JOB_LIMIT_CPU` | `2` |
| `QAAP_JOB_LIMIT_IO` | `8` |
| `QAAP_JOB_LIMIT_NETWORK` | `4` |
| `QAAP_JOB_LIMIT_WORKSPACE` | `4` |
| `QAAP_JOB_LIMIT_DEPLOYMENT` | `1` |
| `QAAP_JOB_MAX_TIMEOUT_MS` | `7200000` |
| `QAAP_JOB_MAX_LOG_CHARS` | `524288` |
| `QAAP_JOB_LOOP_MAX_JOBS` | `512` |
| `QAAP_JOB_LOOP_MAX_ACTIVE_PER_USER` | `4` |
| `QAAP_JOB_LOOP_TEMPLATE_STATE_DIR` | `~/.qaap/job-loop-templates` |
| `QAAP_JOB_LOOP_TRIGGER_STATE_DIR` | `~/.qaap/job-loop-triggers` |
| `QAAP_JOB_LOOP_TRIGGER_LEASE_DIR` | `<trigger-state-dir>/leases` |
| `QAAP_JOB_LOOP_TRIGGER_LEASE_TTL_MS` | `600000` |
