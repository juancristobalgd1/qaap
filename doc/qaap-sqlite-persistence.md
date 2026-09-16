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
| Parallel runs | `~/.qaap/parallel-runs/index.sqlite` | `index.json` |
| Preview shares | `~/.qaap/preview-shares.sqlite` | `preview-shares.json` |
| Push subscriptions | `~/.qaap/push-subscriptions.sqlite` | `push-subscriptions.json` |
| Research goals | `~/.qaap/research-goals.sqlite` | `research-goals.json` |
| Research ledger | `<repo>/.qaap/experiments.sqlite` | `experiments.jsonl` |
| Terminal sessions | `~/.qaap/terminal-sessions.sqlite` | `terminal-sessions.json` |
| Work Hub routines | `~/.qaap/work-hub-routines.sqlite` | `work-hub-routines.json` |
| Workflow runs | `~/.qaap/workflow-runs/index.sqlite` | `index.json` |
| GitHub sessions | `~/.qaap/auth/sessions.sqlite` | `sessions.json` and `.bak` |
| Project sessions | `~/.qaap/project-sessions.sqlite` | `project-sessions.json` |

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

## Runtime requirement

`node:sqlite` requires Node.js 22.5 or newer. Node.js 24 is recommended for
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
