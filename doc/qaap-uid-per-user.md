# Qaap multi-tenant CODE isolation — `QAAP_AGENT_UID_PER_USER` (SEC-1)

This is the runbook for turning on per-tenant OS-uid isolation on the VPS and proving it works.
**Read it fully before flipping the flag** — enabling it rewrites on-disk ownership, and turning it
back off leaves files owned by high uids.

## What the flag does

**Since July 2026 the flag defaults to ON in `docker-compose.yml`** (`QAAP_AGENT_UID_PER_USER: ${...:-1}`),
and the backend is fail-closed: in a production runtime it REFUSES to spawn an agent under a shared
uid unless the operator explicitly sets `QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION=true` (acceptable
only on a single-user box). With the flag off, every tenant's background agent runs under the SHARED
uid `1001`. Secrets are isolated (the agent can't read root-owned `/root/.qaap` or `/root/.theia`),
but every tenant's CODE lives as sibling paths owned by the same uid `1001`, so a prompt-injected
agent could read/write another tenant's repository.

With `QAAP_AGENT_UID_PER_USER=1`, at each agent spawn the backend (running as **root**):

1. **Assigns a stable uid** to the GitHub login from a persisted registry (range `20000–59999`,
   gid mirrors uid), keyed by the same `safeUserIdSegment(login)` used for the on-disk path.
   Persisted `0600` at `/workspace/.qaap/uid-registry.json` (survives rebuilds via the workspace
   volume; override with `QAAP_TENANT_UID_REGISTRY_PATH`).
2. **Writes an `/etc/passwd` + `/etc/group` record** for that uid (idempotent). Without it a
   "homeless" uid breaks `getpwuid`/`os.userInfo()` and `git commit` ("unable to look up current
   user in the passwd file"). These records are ephemeral (reset on container recreate) and rebuilt
   lazily from the registry on the next spawn.
3. **Provisions a private HOME** `/home/qaap-tenants/{segment}` (`QAAP_TENANT_HOME_ROOT`), chowned to
   the tenant uid and `chmod 0700`, seeded once from the shared agent's `~/.claude` if present. The
   shared `/home/qaap-agent` is owned by `1001` and would be neither writable nor private under a
   tenant uid.
4. **Locks the tenant's tree**: `chown` + `chmod 0700` on the per-user repos root
   `{reposRoot}/users/{segment}` and the per-conversation worktree root
   `{tmpdir}/qaap-worktrees/{segment}`, plus `chown -R` the specific repo/worktree cwd.
5. **Hardens the parents** `{reposRoot}/users` and the worktrees root to `0711` root-owned so a
   tenant can traverse to its own `0700` subdir but can't list sibling logins.

All of this is a **no-op when the flag is off or the backend isn't root**, so the shared-uid
deployment is byte-identical. It applies to all three spawn paths (main task, self-verification,
one-shot/composer).

## Prerequisites

- The backend must run as **root** in the container (it does in the shipped image). If not root,
  the flag silently degrades to no isolation (a warning is logged) — verify with
  `docker compose exec theia id` → `uid=0(root)`.
- `--no-cluster` single process (the shipped `CMD` uses it). uid assignment relies on it; a clustered
  backend would need an `O_EXCL` lock that is not implemented.

## Enable

1. Use **two disposable GitHub accounts** for the test, not real user data (see rollback caveat).
2. Nothing to set: the compose default is `QAAP_AGENT_UID_PER_USER=1`. Just make sure the VPS `.env`
   does not override it to empty/`0`. (Leave `QAAP_AGENT_UID=1001` set — it's the fallback for any
   cwd outside a tenant tree, so nothing ever runs as root.)
3. Redeploy: `docker compose up -d --build` (or restart the `theia` service if the image is current).
4. Sign in as tenant **A**, open one of A's repos, and run a `@qaiq` task (e.g. "list the files
   here"). Repeat as tenant **B** in a different browser/session with B's own repo.

## Verify isolation (the only test that matters)

After A and B have each run a task, from the host prove that A's uid cannot read B's repo:

```bash
# See the distinct owners:
docker compose exec theia sh -c 'ls -lan /workspace/repos/users'
docker compose exec theia sh -c 'cat /workspace/.qaap/uid-registry.json'   # login → uid map

# Pick B's uid from the map, then try to read B's tree AS that uid vs A's uid.
# A private (0700) tree is unreadable by any other uid:
docker compose exec theia sh -c 'UID_A=$(sed -n "s/.*\"alice\": *\([0-9]*\).*/\1/p" /workspace/.qaap/uid-registry.json); \
  find /workspace/repos/users/bob -maxdepth 2 -type f | head -1 | \
  xargs -I{} setpriv --reuid $UID_A --regid $UID_A --clear-groups cat {} \
  && echo "LEAK: A read B" || echo "OK: permission denied"'
```

Expected: **`OK: permission denied`** (and the reverse A↔B). Also confirm each tenant's own agent can
still WRITE its repo (the task's Accept/Commit works) and that `git commit` inside a task succeeds.

> `setpriv` ships with util-linux (present in the Debian-based image). If absent, `runuser -u
> qaap-t-bob -- cat {file}` works too, because the passwd record exists.

## Rollback (write this down BEFORE enabling)

Turning the flag off makes the agent run as `1001` again, but files enabled-mode left behind are
owned by `20000+` and `0700`, so `1001` can no longer read them. To fully revert:

```bash
# 1. Remove the flag from .env (or set QAAP_AGENT_UID_PER_USER= empty), then:
# 2. Give ownership back to the shared agent uid and re-open the trees:
docker compose exec theia sh -c '
  chown -R 1001:1001 /workspace/repos/users /tmp/qaap-worktrees 2>/dev/null;
  chmod 0755 /workspace/repos/users;
  find /workspace/repos/users -maxdepth 1 -mindepth 1 -type d -exec chmod 0755 {} +
'
# 3. Restart: docker compose up -d
```

The leftover `/etc/passwd`/`/etc/group` records and `/home/qaap-tenants/*` are harmless; they vanish
on the next container recreate. The uid registry is kept (so re-enabling reuses the same uids).

## Known limitations / follow-ups

- **Supplementary groups (DONE, July 2026):** Node's `child_process.spawn({uid,gid})` does not call
  `setgroups`, so a Node-level drop retains root's supplementary groups (incl. gid 0). The spawn
  paths now wrap the command in `setpriv --reuid U --regid G --clear-groups -- /bin/sh -c <cmd>`
  whenever a uid drop applies and `setpriv` exists (util-linux, present in the image). If `setpriv`
  is missing (e.g. local macOS dev) the code falls back to the old Node `{uid,gid}` drop — files are
  `0700` with a private gid, so there is still no cross-tenant read via groups on that path.
- **Parent enumeration:** the `/etc/passwd` records use `qaap-t-{login}` usernames; a tenant that can
  read `/etc/passwd` learns other logins (names only, no code access). Acceptable.
- **Single process:** uid assignment is safe only under `--no-cluster` (documented in
  `qaap-tenant-uid-registry.ts`).
