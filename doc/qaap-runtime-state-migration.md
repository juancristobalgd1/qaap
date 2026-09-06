# Persist runtime state before recreating a legacy Qaap container

New Compose mounts preserve the existing absolute paths:

| Named volume | Destination |
| --- | --- |
| `theia-worktrees` | `/tmp/qaap-worktrees` |
| `theia-parallel` | `/tmp/qaap-parallel` |
| `qaap-tenant-homes` | `/home/qaap-tenants` |

Git worktree pointers and stored conversation paths therefore remain unchanged.
The regular backup and restore rehearsal now require all six state roots. Old
three-root backups can be rehearsed with the explicit `--legacy-three-roots` option;
their report says `runtime_state_covered: false`.

## Inspect without changes

On the VPS, with Node.js and Docker available, from the repository:

```bash
node scripts/qaap-persist-runtime-state.mjs --plan
```

This reads Compose configuration and the existing container. Custom temporary/HOME
paths, ancestor mounts, nested mounts and unexpected existing mounts require a reviewed migration.
Do not add empty mounts to a legacy container using `docker compose up` first:
that can hide its existing files. The normal VPS update script now checks this.

## Apply during a maintenance window

Finish or cancel running tasks and stop preview processes first. Download the
candidate image and ensure disk space for a snapshot plus a full copy of the three
runtime roots before entering maintenance. The migration itself does not deploy.

```bash
node scripts/qaap-persist-runtime-state.mjs --apply
node scripts/qaap-persist-runtime-state.mjs --check
```

Apply refuses existing target volumes before stopping anything. It stops the old
container, commits a local recovery snapshot and creates project-scoped volumes
with source/snapshot labels. Helpers run only the copy script with networking off;
they do not start the snapshotted app. Data is copied without following symlinks,
then compared using SHA-256, link targets, numeric uid/gid and permission bits.
Hard links become independent copies with identical contents. Source files are
never removed. Special files (for example live Unix sockets) block copying.

**The source remains stopped after apply**, including on failure after the stop.
Restarting it would allow new writes that invalidate the prepared copies. On
success, run the normal reviewed image deployment immediately. Its `--check`
revalidates the prepared volumes against the snapshot before container replacement.
Once the new container mounts the expected volumes, later updates need no copy.

If interrupted or a copy fails, retain the old container, snapshot and partial
volumes. `--apply` will refuse to overwrite them. Inspect and reconcile partial
targets before retrying; `--check` only accepts all copies when they match. Do not
delete volumes or prune snapshots to bypass a failed check. Emergency restart of
the old container requires discarding/reconciling the stale prepared copies before
trying migration again; do not treat them as a fresh backup.

Snapshots can contain tenant credentials. Keep them local and do not publish them
to a registry. The updater no longer prunes unused images automatically; retain the
snapshot until the new release, six-root backup and recovery rehearsal are verified.
Only then arrange explicit cleanup of that specific snapshot.

## Verification still required on the VPS

Run a task in a worktree with each invited account, record uncommitted content,
recreate the application container and confirm files, Git worktree pointers and
private HOME data survive. Run `qaap-verify-multitenant.sh` for both accounts and
rehearse a new six-root backup. Unit tests and fake-Docker orchestration tests do
not replace this real Docker/Linux check.
