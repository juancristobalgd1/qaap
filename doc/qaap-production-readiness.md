# Qaap production readiness

Release target: an invitation-only beta. A successful compile or deployment is not
evidence of tenant isolation, provider reliability, or recoverability.

## Release controls implemented

- The drift guard resolves a real commit, passes Git arguments without a shell,
  and exits 2 on invalid input or a failed diff, including report/baseline modes.
- The existing Gemini startup seams are explicitly documented in the allowlist.
  No upstream product code was changed for this release-control work.
- CI resolves the Qaap source once; the smoke gate and image build check out that
  same commit. Public verification scripts come from the published revision.
- Missing release configuration and missing/malformed public build identity fail
  the deployment workflow instead of silently passing.
- A mandatory `verify_image` job pulls the published candidate by digest into a
  disposable container before VPS deployment. It checks production health payloads,
  auth API denial, frontend HTML, the native terminal module, shell execution and
  basic two-uid filesystem boundaries. The `skip_gate` override cannot skip it.
  Its OAuth credentials are deliberately fake: this is not a real login test.
- QAIQ is fetched by its exact pinned commit and uses its frozen Bun lockfile.
  Other npm agent CLI defaults are exact versions in Dockerfile, Compose and the
  example environment. Existing operator `.env` overrides must be reviewed.

The newly pinned CLI versions were resolved from npm; they are candidates, not
evidence of compatibility. Build and exercise the Linux image before release.
QAIQ updates require changing its Dockerfile, Compose and example-env defaults.
The VPS source-build helper uses the Dockerfile pin unless QAIQ_COMMIT/QAIQ_REF
is explicitly supplied. CI always uses the checked-out Dockerfile pin.

## Remaining launch blockers

No VPS is currently provisioned (operator update). Live migration, OAuth,
multi-user isolation and recovery exercises below remain pending until a Linux
environment is available; the historical host address is not a current target.

1. Review the pending login/approval/agent changes and select a release commit.
2. Configure server-side invitations and verify two-account isolation on Linux,
   including HTTP, WebSocket, files, terminals, previews, worktrees and tasks.
3. Run the mandatory multi-user release gate. Missing tenants or failed isolation
   now block release; execute it against the real Linux instance.
4. Run OAuth and an actual provider through repository → task → diff → Git,
   including cancel, reconnect and server restart. The existing CI mock is not
   a replacement for this check.
5. Execute the new image verification job in Linux CI and resolve any runtime
   failures. Local tests validate orchestration with fake Docker, not a real image.
6. Restore an encrypted offsite backup into a clean instance and rehearse rollback.
   The new `qaap-backup-restore-check.sh` verifies extraction into an anonymous
   volume, hashes, protected state roots and numeric ownership on Linux. It does
   not boot the restored application or verify an offsite provider.
7. Verify spending limits and resource/concurrency limits under beta load.
8. Validate billing if enabled, mobile UX and operational alerts.

### Runtime durability migration prepared, VPS execution pending

Compose now also persists `/tmp/qaap-worktrees`, `/tmp/qaap-parallel` and
`/home/qaap-tenants`. Existing deployments must first run the verified snapshot-to-volume
migration in `doc/qaap-runtime-state-migration.md`; the updater blocks an unmigrated
container. Backups and restore rehearsals cover six roots. The actual migration and
restart/recovery exercise on the VPS remain release blockers.

## Remaining reproducibility limitations

The base Node images, apt repositories, package-manager installers and Grok's
remote install script still float. Exact agent versions alone do not make the
entire image reproducible. Pin or replace these inputs before claiming that.
The explicit workflow_dispatch emergency `skip_gate` override remains available;
it must not be used as evidence that a candidate passed validation.

Candidate image diagnostics are uploaded as `qaap-image-smoke`; the temporary
container and its anonymous volumes are removed after success or failure. A failed
candidate can remain in GHCR for diagnosis but cannot pass to the VPS deploy job.

## Local checks

Runtime task-index write failures pause new tasks and queue promotion. Authenticated
`GET /qaap/api/agent-tasks/storage-health` reports only readiness, recovery state
and the last write-failure flag (HTTP 503 while degraded, no-store). After correcting
disk space/permissions, authenticated `POST /qaap/api/agent-tasks/storage-retry`
retries the in-memory snapshot without restarting; a successful save resumes the
queue. Startup recovery failures remain blocked and cannot be bypassed by retry.
Running processes are not killed. This is an observed-failure signal, not a disk
capacity probe or integration with the public launch-health endpoint.

Task creation returns HTTP 503 while startup recovery is pending or has failed.
An unreadable/corrupt index blocks new tasks, queue draining and subsequent index
writes so the original file remains available for recovery. Only a missing index
is treated as a first installation. Repair storage/restore the index and restart
to retry recovery. This guard addresses startup recovery; runtime write failures
are exposed separately through the authenticated storage-health endpoint above.

Atomic JSON writes now exclusively create the temporary file, apply permissions
and flush file contents before replacement. On non-Windows systems they also
flush the parent directory after rename. A failure before rename keeps the previous
file; a directory-flush failure is reported after replacement and does not roll it
back. Windows skips the directory flush. This adds disk I/O latency and still
requires Linux storage and load testing; it is not a simulated power-loss guarantee.

Atomic-store cleanup now checks that temporary filenames match the writer format
and that the owning PID is confirmed absent before removing them. Live writers,
permission failures and malformed filenames are preserved. This protects concurrent
processes sharing the same PID namespace; sharing these stores across containers
with different PID namespaces still requires external coordination.

Task recovery rejects unknown index versions and only resumes queued requests
with their own saved entry, a nonempty string prompt/command and an absolute
working directory matching the recorded task. Missing or malformed requests leave
the task interrupted instead of automatically executing it. Legacy array indexes
remain readable, but cannot reconstruct queued executable requests. This is local
recovery validation, not evidence that a real provider resumes after a restart.

Agent task admission now bounds the waiting queue with `QAAP_MAX_QUEUED_AGENTS`
(default 100) and `QAAP_MAX_QUEUED_AGENTS_PER_USER` (default 20). These are separate
from running-agent caps. When a request needs to wait and either limit is reached,
the runner rejects it before persistence or spawning; the task creation endpoint
returns HTTP 429 with a localized explanation. Owners are compared case-insensitively,
and anonymous local tasks share a bounded owner bucket. Existing queued tasks are
not discarded when limits are lowered. Cancellation or promotion frees queue space.
These count limits do not cap prompt bytes, completed history, or provider spending.

Beta admission is enforced during session creation and lookup (including restored
sessions). Production requires `QAAP_BETA_ALLOWED_LOGINS`; empty/invalid denies all.
The operator-approved two-account list is configured in the ignored local `.env`.
Copy that setting to the VPS environment before deploying; the template intentionally
remains empty. Restart after changing the list to close
existing sockets; separately cancel any already-running jobs when revoking access.
The public auth/config probe exposes only required/configured booleans, not names.
OAuth state expiration is now checked when the callback consumes the state.

Local verification for this admission change: the full 102-project compile passed;
54 compiled admission/auth/ownership/OAuth tests passed; targeted ESLint and drift
checks passed. Five shell gate scenarios passed using mocked Docker/HTTP responses.
The directory-link escape test uses a junction on Windows and a symlink on Linux.
These results do not certify Linux uid isolation or a live OAuth round trip.

```sh
npm run compile
node --test scripts/qaap-drift-check.test.js
node --test scripts/qaap-release-config-check.test.js
bash scripts/qaap-launch-gate.test.sh
bash scripts/qaap-image-smoke.test.sh
python3 scripts/qaap-backup-restore-check.test.py
bash scripts/qaap-vps-backup.test.sh
node scripts/qaap-drift-check.js
```

If the pinned upstream commit is unavailable, fetch the exact commit recorded in
`scripts/qaap-upstream-base.txt` from `https://github.com/eclipse-theia/theia.git`.
Do not rewrite the baseline to bypass missing Git history.
