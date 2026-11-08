# Qaap SQLite persistence

Qaap's Node-owned persistent stores use the embedded SQLite runtime provided by
`node:sqlite`. The database is configured with WAL journaling,
`synchronous=FULL`, foreign keys, and transactional writes. This keeps the
existing store contracts while avoiding a full JSON-file rewrite for each
mutation.

## Scope

The migration covers the persistent Node stores under `packages/qaap-*`:

| Domain | SQLite location (default) | Legacy source read on first use |
| --- | --- | --- |
| Agent conversations | `~/.qaap/agent-conversations/index.sqlite` | `index.json` |
| Billing accounts | `~/.qaap/billing-accounts.sqlite` | `billing-accounts.json` |
| Cloud workspaces | `~/.qaap/cloud-workspaces.sqlite` | `cloud-workspaces.json` |
| Preview shares | `~/.qaap/preview-shares.sqlite` | `preview-shares.json` |
| Push subscriptions | `~/.qaap/push-subscriptions.sqlite` | `push-subscriptions.json` |
| Research goals | `~/.qaap/research-goals.sqlite` | `research-goals.json` |
| Research ledger | `<repo>/.qaap/experiments.sqlite` | `experiments.jsonl` |
| Terminal sessions | `~/.qaap/terminal-sessions.sqlite` | `terminal-sessions.json` |
| Work Hub routines | `~/.qaap/work-hub-routines.sqlite` | `work-hub-routines.json` |
| Workflow runs | `~/.qaap/workflow-runs/index.sqlite` | `index.json` |
| GitHub sessions | `~/.qaap/auth/sessions.sqlite` | `sessions.json` and `.bak` |
| Project sessions | `~/.qaap/project-sessions.sqlite` | `project-sessions.json` |

The former Parallel runs store (`~/.qaap/parallel-runs/`) was removed with the Run variants feature; existing files there are no longer read.

The exact location of stores that already support a `QAAP_*_STORE_PATH`
override remains unchanged. `QAAP_SQLITE_STORE_PATH` can point all Qaap SQLite
stores at one database; namespaces keep their data separate, including
per-repository research ledgers.

## Migration and recovery

On first access, a store imports its legacy JSON/JSONL source into SQLite and
records the migration in the `qaap_migration` table. The legacy file is never
deleted or modified, so rollback and manual recovery remain possible. A
malformed legacy source does not hide valid SQLite data; it is skipped and can
be repaired and retried later.

The SQLite database and its WAL/SHM companions are created with private
permissions (`0700` for the parent directory and `0600` for database files).
Backups must include the complete containing directory. For a consistent live
backup, stop the backend or use a filesystem snapshot; copying only the main
`.sqlite` file while it is active can omit committed WAL frames.

## Agent conversations: one row per conversation

Earlier builds kept every conversation in one aggregate row
(`agent-conversations` / `conversations`) and rewrote all of it on each persist.
With a large store that blocked the event loop for seconds (Stop and Send waited
behind it) and approaches V8's string limit (~536 MB). The conversation store
now uses the namespace `agent-conversations.v2` in the same `index.sqlite`:

- `conv:<id>`: one row per conversation; a persist writes only the rows that
  changed (tracked by `set`/`delete`, confirmed by a hash of the serialized row).
- `meta:worktreeOrdinalHighWater`: the worktree ordinal high-water mark.
- `meta:legacyObserved`: `{ updatedAt, bytes, hashes }` of the legacy row at the
  last sync (see below).

**Import.** On the first start the legacy row is read in chunks and copied into
v2 in one transaction together with the `qaap_migration` mark; a crash leaves
the previous state and the next start repeats it. If the volume lacks about
twice the store size free it changes nothing; the WAL is truncated after an
import. Until the import and load succeed, writes are off and creates are
refused, and a failed restore is reported by the `conversationStorage` health
check (conversations stay unavailable until the cause is fixed and the backend
restarts).

**The legacy row is never written** by this code; it stays as it was at the
import, for rollback.

**Return from a rollback.** If an earlier build ran meanwhile, it rewrote the
legacy row. Each start compares the legacy row's `updated_at` and byte length
with `meta:legacyObserved` (not with a clock, so a writer whose clock is behind
is still noticed) and, when they differ, merges the conversations whose hash
changed since that sync (an earlier build rewrites the whole row): the later
`updatedAt` wins and messages only the other copy has are kept. A conversation
missing from v2 is taken when the legacy row did not hold it at the previous
sync (created during the rollback) or when it changed after the mark; otherwise
v2 had deleted it and it stays deleted. One missing from legacy stays in v2.

**Sweep and shutdown.** A periodic sweep (`QAAP_CONVERSATION_FULL_SWEEP_MS`,
default 10 min; `QAAP_CONVERSATION_SWEEP_MAX_CHARS` per run, default 64 MiB)
re-serializes conversations round-robin and writes those whose hash changed,
catching in-place mutations that bypassed `set` (logged as
`changed without set()`). On a clean stop the pending rows are written
synchronously within 3 s, newest first. A failed persist, sweep or shutdown
flush sets `writeFailed` on the health check until a write succeeds.

**Rolling back to a build without rows.** That build would show the
conversations as they were at the import. To give it the current state, stop
the backend and rebuild the legacy row from v2:

```bash
node scripts/qaap-conversations-v2-to-legacy.js ~/.qaap/agent-conversations/index.sqlite
node scripts/qaap-conversations-v2-to-legacy.js --yes ~/.qaap/agent-conversations/index.sqlite
```

Without `--yes` it only reports. It refuses (exit 4) while anything has the
database open, saves and checks a full copy (`index.sqlite.pre-rollback-<time>`)
before writing, and lists conversations only the legacy row holds; those are
dropped from the rebuilt row unless `--import-missing` is given (they stay in the
copy either way). Exit 3 means the store no longer fits an earlier build. The v2
rows and the mark are untouched, so going forward again merges as above.

The legacy row will be removed in a later release, at least 30 days after this
layout ships.

## Connection model

All `QaapSqliteStore` instances that point at the same database file share one
long-lived connection held by `QaapSqliteConnectionRegistry.shared`, whatever
their namespace. The connection is opened lazily. The PRAGMAs (WAL,
`synchronous=FULL`, foreign keys, busy timeout) and the schema migrations run
once when it opens, and prepared statements are cached per SQL string. Keeping
the connection open avoids the WAL checkpoint and file deletion that SQLite
performs every time the last connection to a WAL database closes. Durability is
unchanged: each commit is still fsynced (`synchronous=FULL`). Nested
`withTransaction` calls from any store on the same file use savepoints on the
shared connection. If the file is deleted or replaced while open (possible on
POSIX), the next operation notices and reopens a fresh database.

Connections close on process exit, or explicitly through `store.close()`,
`QaapSqliteConnectionRegistry.shared.close(path)`, `closeUnder(directory)`, or
`closeAll()`. The next operation reopens the connection transparently.

**Tests and cleanup code must close before deleting.** On Windows an open
SQLite file cannot be removed (`rmSync` fails with `EPERM`/`EBUSY`), so any spec
or code path that removes a store's database or its directory must first call
`QaapSqliteConnectionRegistry.shared.closeUnder(dir)` (or `store.close()`):

```ts
afterEach(() => {
    QaapSqliteConnectionRegistry.shared.closeUnder(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

## Runtime requirement

`node:sqlite` requires Node.js 22.13.0 or newer (22.5–22.12 only expose it behind
`--experimental-sqlite`, which Qaap does not pass). Node.js 24 is recommended for
development and deployment. Compile before executing compiled tests:

```bash
npm run compile
npm --workspace @theia/qaap-persistence test
node scripts/qaap-drift-check.js
```

The browser-only annotation store and in-memory thread store are intentionally
not backend SQLite stores. Task/job control-plane JSON files outside a
`qaap-*-store.ts` implementation remain governed by their existing recovery
documentation.
