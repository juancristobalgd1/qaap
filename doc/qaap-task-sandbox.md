# Per-task ephemeral sandbox (roadmap H2.2)

Status: **on in production since Oct 17 2026** (broker mode, see "Production rollout"). Behind
`QAAP_TASK_SANDBOX=1` (default off) in two modes: **direct** (v1, the backend
drives a Docker daemon it can reach) and **broker** (production, `QAAP_BACKEND_PER_TENANT=1`: the
control plane creates sandboxes for tenant backends that have no Docker socket). Code:
`packages/qaap-cloud-workspace/src/node/qaap-task-sandbox*.ts`, `qaap-devcontainer-config.ts`.
End-to-end checks: `node scripts/qaap-task-sandbox-e2e.mjs` (direct mode, needs
`npm run build:browser` and Docker) and `node scripts/qaap-task-sandbox-broker-e2e.mjs` (broker
mode, needs the compiled `@theia/qaap-cloud-workspace` and Docker).

## Goal

From the roadmap: two agent tasks on the same repository run at the same time with no file or
port conflicts, each sandbox starts in 30 s or less, and the sandbox is destroyed or archived
when the task ends. If the repo has a devcontainer, use it; otherwise use the base image.

What existed before this change:

- **Files:** every thread gets its own git worktree, and changes merge back through an
  integration worktree (#247, #253).
- **Preview ports:** each thread's preview gets its own allocated port (#254). This only helps
  when the app honors `PORT`.
- **Tenants:** each tenant gets its own container (C1-full / H2.1).

What was missing: two tasks of one tenant shared one PID namespace and one network namespace.
One task could see and kill the other's dev servers. Two apps with a hardcoded `:5173` collided.

## Decision: a per-task container (option a)

Each task whose cwd is a git worktree runs in its own container on the Docker daemon. That gives
it its own PID and network namespaces, and its filesystem holds only that worktree.

We rejected option (b), per-task process namespaces (`unshare`/`bwrap`) inside the tenant
container, for these reasons:

- **Production blocks it.** Production is Ubuntu 24.04, kernel 6.8, with
  `kernel.apparmor_restrict_unprivileged_userns=1` (checked on the VPS on Oct 16 2026).
  Tenant containers run with `CapDrop ALL`, `no-new-privileges` and Docker's default seccomp
  profile. That profile denies `unshare(CLONE_NEWUSER|NEWPID|NEWNET)` without `CAP_SYS_ADMIN`.
  Making (b) work would mean loosening the hardening we just audited (a custom seccomp profile
  and an AppArmor userns exception).
- **No egress.** A fresh network namespace has no route out, and the agent must reach its LLM
  API. That would also need `slirp4netns`/`pasta`, which is not in the image.
- **Devcontainers.** A devcontainer is an image. Option (a) uses it directly; option (b) cannot.
- **Testability.** Option (a) can be tested on macOS with Docker Desktop. Option (b) only works
  on Linux.

A second opinion (deep-reasoner) agreed and asked for the adjustments below. All of them are in v1
except the in-sandbox exec server and the toolchain volume, which come with the production broker.

## How it works

**Lifecycle**

1. `QaapAgentTaskRunner` spawns the agent. Just before that,
   `acquireTaskSandbox(task)` → `QaapTaskSandboxService.acquire()` resolves the worktree root
   (`git rev-parse --show-toplevel`) and starts its container, or joins it if it already runs.
   One worktree has one container, so tasks on one worktree share it. Containers are named
   `qaap-task-<sha(root)>` and carry the labels `com.qaap.task-sandbox*` plus the namespace.
2. All processes for that worktree go through `QaapTenantSpawnService.spawn()` /
   `spawnArgvPrepared()`: the agent CLI, preview dev servers and workflow `npm` scripts. These
   calls already are the only spawn seam. When a live sandbox owns the cwd, they become
   `docker exec -i … <sandbox> /tmp/.qaap-exec/run <execId> <cmd>`.
3. `finishTask()` → `release(taskId)`. When the last task is released, the sandbox ends after
   `QAAP_TASK_SANDBOX_LINGER_MS` (default 10 min). The linger lets a follow-up turn, and the
   thread's preview, reuse it.
   - The default ending is `docker rm -f`.
   - With `QAAP_TASK_SANDBOX_ON_END=archive`, the container is stopped and renamed
     `…-archived-<ts>` for inspection.
   - The worktree and its `qaap/worktree/*` branch are never touched. They keep their existing
     apply, delete and GC lifecycle.
4. On boot, `reapOrphans()` removes the sandboxes this backend left behind after a crash or
   restart. "This backend" is the `com.qaap.task-sandbox.owner` label: `QAAP_TASK_SANDBOX_OWNER`,
   else the host name.
   - Another backend's live sandboxes on the same daemon are never touched. Several backends on
     one host and daemon need distinct owners.
   - Archives of any owner are reaped once older than `QAAP_TASK_SANDBOX_ARCHIVE_TTL_MS` (default
     24 h). The age counts from the archive time in the name, not from container creation.
   - A graceful shutdown awaits the removal of live sandboxes, with an 8 s cap. A hard exit
     cannot wait, so the next boot's reaper covers it.

**Races handled.**
- A task released while its sandbox is still starting (cancelled during `docker run` or
  `postCreateCommand`) is never registered, and the sandbox ends as after a last release.
- An `acquire()` that arrives while the same worktree's sandbox is being removed waits for the
  removal and starts a fresh container. It never adopts the dying one.

**Container contract.** It uses the same hardening as tenant workers:

- `--init`, `--cap-drop ALL`, `no-new-privileges`
- pids, memory and CPU limits (`QAAP_TASK_SANDBOX_PIDS|MEMORY|CPUS`)
- `--read-only` for the base image
- a tmpfs `/tmp`, and a private tmpfs `HOME=/tmp/qaap-home` owned by the task uid
- `--user` set to the tenant uid. `remoteUser` is ignored: files the sandbox writes must stay
  mergeable and deletable by the backend.
- network `QAAP_TASK_SANDBOX_NETWORK` (default `bridge`)

**Mounts**

- **The worktree**, read-write, at its own absolute path, so cwd and paths need no translation.
- **The repository's git common dir**, read-write. Commits from inside the sandbox need it.
- **Read-only overlays** on `<common>/config`, `hooks/`, `info/`, the worktree's `.git` link and
  its `commondir`/`gitdir`/`config.worktree`. The backend later runs git over this metadata
  outside the sandbox (commit, merge-back in the integration worktree). A writable
  `core.hooksPath`, `core.fsmonitor`, filter or `gitdir:` redirect would let the sandbox run code
  there. The backend's git also keeps `-c core.hooksPath=/dev/null`.
- **Agent credential directories**, read-write because tokens refresh: `~/.claude`,
  `~/.claude.json`, `~/.codex`, `~/.gemini`, `~/.copilot`, `~/.qaiq`, `~/.config/qaiq` and
  `~/.config/opencode`, mounted under the sandbox `HOME` (`QAAP_TASK_SANDBOX_HOME_DIRS`). They
  are skipped when `HOME` contains the worktree. Code the repo runs (postinstall, dev server)
  can read them, exactly as today.
- **An optional toolchain directory** (`QAAP_TASK_SANDBOX_TOOLCHAIN`), read-only at
  `/opt/qaap-agent`, first on `PATH`. It is for images that do not ship the agent CLIs.

**Secrets.**
- The task's variables and the devcontainer `remoteEnv` reach a task only at exec time and only
  by name (`-e NAME`; the docker CLI copies the value from its own env). They never appear in an
  argv, in the container's persisted config or in `docker inspect`. When a name is in both, the
  task's value wins.
- The devcontainer `containerEnv` is also passed to `docker run` by name, so it stays off the
  argv and `ps`. By its nature it persists in the container config (`docker inspect`): it is
  declared in the repository, so it must not hold secrets.
- Host-only variables (`PATH`, `HOME`, `DOCKER_*`, `QAAP_TENANT_BACKEND_SECRET`, …) are never
  forwarded.

**Kill semantics.** Killing a `docker exec` client does not kill the process inside the
container. Every exec therefore runs under `setsid -w` and records its pgid in
`/tmp/.qaap-exec/<execId>.pid`. When the client dies by a signal (task cancel, dev-server
restart), a second exec sends `TERM` and then `KILL` to that group. Without this, a restarted
dev server would still hold its hardcoded port.

**Preview routing.** No port is published. The service runs a loopback forwarder on the backend
(`forwardPort(sandbox, containerPort, hostPort)`). For each connection it runs
`docker exec -i <sandbox> /tmp/.qaap-exec/bridge <port>`, which uses node, or bash `/dev/tcp`
when node is missing, to connect to the sandbox's own loopback. This is the
`QaapDevPreviewUpstreamTunnel` idea at sandbox granularity. It works whatever address the dev
server bound (Vite's `localhost` included) and for any port.

- **Automatic case:** a dev server spawned into a sandbox with `QAAP_PREVIEW_PORT`=P (set by the
  preview supervisor) gets `127.0.0.1:P` on the backend forwarded to P inside the sandbox. The
  existing preview proxy keeps targeting `127.0.0.1:P` unchanged.
  - `PORT` alone is never forwarded. Every spawn inherits it from the backend, and in the
    production image it is the IDE port.
- **Hardcoded port case:** for an app that ignores `PORT`, preview port detection retargets the
  expected port to the port the app bound (see "Preview" under broker mode; the same watcher runs
  in direct mode through `docker exec cat /proc/net/tcp`).
- **Cost (direct mode):** each TCP connection runs its own `docker exec` (~100–300 ms to open;
  HTTP keep-alive and HMR websockets amortize it). Broker mode opens a plain TCP connection to the
  sandbox's exec server instead. Replacing the direct-mode exec with one long-lived relay per
  sandbox is a known follow-up.

## Devcontainer handling

`QaapDevcontainerResolver` reads `.devcontainer/devcontainer.json` or `.devcontainer.json`
(JSONC).

**Honored:**

- `image`
- `build.{dockerfile,context,args,target}` (and the legacy `dockerFile`). Paths must stay inside
  the repo.
- `containerEnv` (non-secret, set at create time)
- `remoteEnv` (set on every exec)
- `forwardPorts` (preview hints)
- `postCreateCommand` (string, argv array, or an object run in parallel)

**Ignored with a warning:**

- **Never honored, by design:** `initializeCommand` (it runs on the host), `runArgs`,
  `privileged`, `capAdd`, `securityOpt`, `init`.
- **Not supported yet:** `features` (they need the devcontainers CLI),
  `dockerComposeFile`/`service`, `mounts`, `workspaceMount`/`workspaceFolder` (identical-path
  binds make them unnecessary), `remoteUser`/`containerUser`, and the other lifecycle hooks.

**Images:**

- A Dockerfile build is tagged `qaap-devcontainer:<sha16>` over the config, the Dockerfile, the
  build args and the target, so unchanged definitions reuse one image.
- On a cache miss the build starts in the background and that task runs on the base image, which
  keeps it inside the startup budget. Later tasks get the devcontainer image.
- Devcontainer images run without `--read-only` so `postCreateCommand` can install packages. They
  keep every other hardening flag.
- `postCreateCommand` runs once per worktree. A marker in the worktree's private git dir records
  it. It has a 10 min timeout and is reported as `postCreateMs`, outside the startup budget.
- The agent CLI must exist in the devcontainer image, or come from `QAAP_TASK_SANDBOX_TOOLCHAIN`.
  Node-based CLIs need a glibc image with node ≥ 20.

## Startup budget (≤ 30 s)

| Step | Cost |
|---|---|
| `git rev-parse` ×3 | ~10 ms |
| `docker run -d` from a local image + readiness probe (`test -x /tmp/.qaap-exec/run`) | measured on Oct 16 2026 (macOS, Docker Desktop 29.1, `node:22-bookworm-slim`): **0.8 s** for one sandbox alone, **1.6 s** each when two start in parallel through the backend (e2e) |
| Devcontainer image already built, or pulled (`image`) | same as above once present. A first pull of a large image is network-bound. |
| Devcontainer Dockerfile cache miss | 0: background build, base image now |
| `postCreateCommand` | outside the budget, reported separately |

`acquire()` fails if the container is not ready within 30 s. That fails the task with the
container's last log lines; it never silently runs unsandboxed. Each start is logged as
`[qaap-task-sandbox] started <name> … in <ms> ms`.

## Threat model

This is **same-tenant conflict and blast-radius isolation**, not a security boundary between
tasks of one tenant.

- **What a task can't do:** it cannot see or signal another task's processes, bind its ports,
  or read another worktree's files.
- **What a task still shares (accepted limitation):** the repository's git common dir is mounted
  read-write: `objects/`, `refs/`, `packed-refs` and `logs/`. Commits made in the sandbox must be
  visible to the backend's merge-back.
  - Consequence: a task can delete or rewrite other threads' branch refs, or run
    `git gc --prune=now` and drop objects no ref reaches. That can lose another thread's
    committed-but-unmerged work, or the main checkout's.
  - Making only the task's own ref writable is not feasible with bind mounts. Git updates a ref
    by writing `<ref>.lock` and renaming it over the ref, and a rename onto a bind-mounted file
    fails, so commits would break.
  - Real separation needs a per-task `git clone --shared` (alternates, objects read-only),
    fetched back by the backend on merge. That is a follow-up, and it is required before
    sandboxes isolate untrusted tasks from each other.
- **Tenant isolation is unchanged.** It is still C1-full: a tenant's own uid and its own
  container.

## Production: broker mode

In production (`QAAP_BACKEND_PER_TENANT=1`) agents spawn in a per-tenant backend container that has
**no** Docker socket: giving it one, even through a filtered proxy, would let a tenant create
privileged containers. The control plane therefore creates the sandboxes, through a narrow broker.
`QaapTaskSandboxService.mode()` is `broker` whenever `QAAP_TENANT_BACKEND_MODE=1`; the control
plane passes `QAAP_TASK_SANDBOX=1` to tenant backends only when the flag is on there (turning it
off recreates them, deferred while a turn runs, like any stale backend).

**1. The link (control plane ↔ tenant backend).** A tenant backend cannot reach the control plane:
it sits on an internal bridge, and the host loopback guard (see `doc/qaap-ci-invariants.md`) rejects
every control-plane port on purpose. The channel runs the other way. `QaapTaskSandboxBroker`
(control plane) opens a long-lived `GET {runtime}/task-sandbox/link` to every tenant backend it
routes to, through the same ingress relay as the busy probe, and reconnects every 2 s when it drops.
A refused or unreachable link is retried with exponential backoff per tenant (2 s doubling up to
60 s), logged once per state change. The tenant backend (`QaapTaskSandboxBrokerClient`) writes
signed requests down that NDJSON stream;
the broker answers with `POST {runtime}/task-sandbox/reply`. Authentication uses the tenant-scoped
`QAAP_TENANT_BACKEND_SECRET` (HMAC-SHA256, `qaap-task-sandbox-broker-protocol.ts`):

- the link and every reply carry a probe over the tenant login and a timestamp (60 s window),
- every request carries its own signature over the tenant login, id, time, op and a hash of its
  arguments; the broker verifies it with the secret of the tenant whose link carried it and
  rejects replays by id.

**2. The broker's three operations**, each scoped to the linked tenant:

- `create { root, devcontainer: { image?, containerEnv? }, homeLinks }`. `root` is the worktree as
  the tenant backend sees it and must lie strictly inside that tenant's own repos, worktrees or
  parallel tree, be normalized, and exist as a real directory (not a symlink) for the control
  plane. The broker picks everything else: the tenant backend's Docker node and image
  (`QaapDockerOrchestrator.taskSandboxPlacement`), uid `1001:1001` (the tenant backend's agent
  uid), `--init`, `CapDrop ALL`, `no-new-privileges`, pids/memory/CPU limits, read-only rootfs on
  the base image, tmpfs `/tmp` and `HOME`, the tenant's internal network plus its direct-egress
  network or egress-proxy env, and no published port.
- `destroy { name, mode }` and `list`: only containers labelled `com.qaap.task-sandbox.broker` and
  `com.qaap.tenant-login=<tenant>`.
- At most `QAAP_TASK_SANDBOX_MAX_PER_TENANT` (default 8) sandboxes per tenant, counting every
  state but archives. Creates and destroys of one tenant are serialized, so concurrent creates
  cannot overshoot the cap. At most `QAAP_TASK_SANDBOX_MAX_ARCHIVES_PER_TENANT` (default 3)
  archives are kept (the oldest go first), and archives older than
  `QAAP_TASK_SANDBOX_ARCHIVE_TTL_MS` are removed.
- When a tenant's backend stops being routed for 60 s, the broker removes its sandboxes (their
  linger timers died with that backend). Docker is the source of truth for this: on start and every
  minute the broker lists the broker sandboxes of its namespace on every node, so sandboxes of a
  tenant whose backend vanished while the control plane was down are reaped too. A restarted tenant
  backend reaps the sandboxes it no longer knows (`list`).

**Mounts in broker mode** are the tenant's four **fixed** roots, with Docker mount sources
translated by the orchestrator (`QAAP_DOCKER_REMOTE_*`) and destinations at the paths the tenant
backend sees, so cwd and git `gitdir:` paths need no translation:
`/workspace/repos/users/<login>`, `/tmp/qaap-worktrees/<login>`, `/tmp/qaap-parallel/<login>` and the
tenant storage `/home/theia/.qaap`. The broker never binds a tenant-chosen sub-path: the tenant
could swap it for a symlink between validation and the daemon's mount, and a rootless daemon would
then mount any host path its uid can open (its own Docker socket included). Consequences, consistent
with the threat model below:

- a sandbox sees all of its tenant's trees, not only its worktree (the tenant backend already does);
- the read-only git metadata overlays of direct mode are not applied: in production, agent code
  already runs as the tenant in the tenant backend, and the backend's own git keeps
  `-c core.hooksPath=/dev/null`;
- agent sign-in state reaches the sandbox through `homeLinks`: the tenant backend's volatile HOME
  links (`QaapTenantPersistentHome`) are recreated inside the sandbox's tmpfs HOME, pointing into the
  mounted tenant storage. Link targets must be inside `/home/theia/.qaap`.

**Devcontainers in broker mode.** The tenant backend reads `devcontainer.json` (the control plane
never reads tenant files) and sends only `image` and `containerEnv`; the broker validates the image
reference and drops reserved variables (`HOME`, `PATH`, `QAAP_*`, proxies, `NODE_OPTIONS`, `LD_*`).
An image that is not present yet runs that task on the base image, and is pulled in the background
only if it matches a prefix in `QAAP_TASK_SANDBOX_PULL_ALLOWLIST` (comma separated, as the reference
is written, e.g. `mcr.microsoft.com/devcontainers/`). The default is empty: never pull, only use
images already on the node. Pulls fill the shared node's disk, so they are also capped per tenant:
`QAAP_TASK_SANDBOX_PULLS_PER_TENANT` concurrent (default 1) and `QAAP_TASK_SANDBOX_PULLS_PER_DAY`
(default 5).
Dockerfile builds are **not** run in broker mode (a tenant Dockerfile would execute on the shared
daemon); those repos use the base image. `remoteEnv` and `postCreateCommand` are applied by the
tenant backend through the exec server.

**3. Exec server and toolchain volume.** Every broker sandbox runs
`/opt/qaap-agent/current/bin/node /opt/qaap-agent/current/lib/qaap-task-sandbox-exec-server.js` as
its entrypoint. `/opt/qaap-agent` is a read-only Docker volume
`qaap-agent-toolchain-<sha(image id, server)>`, populated once per image and server version by a
one-shot container of the tenant image (no network, no capabilities) that copies its `node` and the
compiled exec server, then renames the result into place. The exec server listens on
`:7391` on the tenant network (reached by container name) and accepts only requests carrying the
random per-sandbox token. The token is never in the container's Env: an environment variable stays
readable in `/proc/<pid>/environ` of the server and of the init process by every command running as
the same uid, and in `docker inspect`. The container is created with stdin open once; the broker
attaches, starts it, writes the token as one line and closes stdin, and the server refuses to start
without it. The broker keeps tokens in memory only: after a control-plane restart, a `create` for a
sandbox whose token it no longer knows recreates that sandbox (a live tenant backend keeps using
the sandboxes it already holds, and a restarted one reaps them).
If the sandbox image cannot run the toolchain's node (musl or no glibc), the exec server never
becomes ready and the broker recreates the sandbox on the base image.

Operations (`qaap-task-sandbox-exec-protocol.ts`): `exec` (binary frames for stdin, stdout,
stderr, signals, resize, exit), `connect` (raw pipe to a sandbox loopback port), `ports`
(listening TCP ports from `/proc/net/tcp{,6}`) and `ping`.

**4. Local exec client.** The tenant spawn seam (`QaapTenantSpawnService.spawn()` /
`spawnArgvPrepared()` → `launchProcess`) starts `node qaap-task-sandbox-exec-client-main.js <file>`
instead of the command. The request file (0600, in a backend-private 0700 directory) holds the
endpoint, the token and the command's exact environment; the client reads and deletes it at once,
so no secret is on an argv or in the client's environment. stdio streams directly between the
tenant backend and the sandbox: it never transits the control plane. The client exits with the
remote exit code, or dies by the remote signal. A signal to the client is forwarded to the remote
process group; when the client dies (even by SIGKILL) the server sees the socket close and sends
TERM, then KILL after 2 s, to the whole remote tree.

**Terminals.** `wrapShellForTenant()` routes a terminal whose cwd belongs to a live sandbox into it:
broker mode runs the shell under a pseudo-terminal in the sandbox (`script`, util-linux) and
forwards window-size changes (`stty` on the inner pty); direct mode uses `docker exec -i[t]` under
the same kill trap as other execs.

**Preview.** Each forwarded host port opens a `connect` (broker) or `docker exec … bridge` (direct)
per connection. Preview port detection: when a process starts in a sandbox with
`QAAP_PREVIEW_PORT`=Q (or a terminal command contains `QAAP_PREVIEW_PORT=Q`), the backend's
`127.0.0.1:Q` is forwarded to Q in the sandbox and a port watcher (`QAAP_TASK_SANDBOX_PORT_WATCH_MS`,
default 1 s) reads the sandbox's listening ports. If Q never binds but a new port P does (the app
ignores PORT, e.g. a hardcoded `:5173`), the forwarder on Q is retargeted to P (ports already
listening when the sandbox started, and Docker's embedded DNS on `127.0.0.11`, never count), so the preview proxy,
which keeps targeting Q, reaches the right task even when two sandboxes bind the same P. While a
terminal is open, other new ports are forwarded 1:1 when that host port is free.

**Verified end to end** (`scripts/qaap-task-sandbox-broker-e2e.mjs`, Oct 17 2026, macOS, Docker
Desktop 29.1, `node:22-bookworm-slim`): the tenant backend container has no Docker socket, drops
all capabilities, has a read-only rootfs and sits on an internal network; the broker runs on the host
with real Docker. Two sandboxes start in parallel in 0.8–1.8 s once the images are local (4.7 s
on the very first run, which also populated the toolchain volume); both bind the hardcoded port 4545 (each as PID 15 of its own namespace) and each preview
port reaches its own app; a sandbox sees only its own server, runs as uid 1001 with no capabilities,
no Docker socket, no exec token (in its env or in any `/proc/*/environ`) and no backend secret, and gets the agent sign-in state; a terminal
gets a remote pty; killing a dev server's client frees its port; both sandboxes are removed when
the tasks end. Not covered locally: a rootless daemon and the real ingress relay (the e2e publishes
the tenant backend's port directly), and multiple Docker nodes.

**Verified on the VPS's rootless daemon** (Oct 17 2026, build `4f49493f1`, Ubuntu 24.04, rootless
Docker, the production tenant image `ghcr.io/juancristobalgd1/qaap:4f49493f1…` for both the tenant
backend and the sandboxes): all 14 checks pass. Two sandboxes start in parallel in 4.4 s and 5.3 s
(5.5 s for both), cold: each run uses a fresh namespace, so this includes populating the toolchain
volume from the 9 GB tenant image. Recipe (as root, because the tenant host-loopback guard rejects the
rootless uid's own connections to `127.0.0.1`, where the e2e publishes the tenant backend):

```bash
docker cp qaap-theia-1:/app /home/ubuntu/qaap-e2e/app && docker cp qaap-theia-1:/usr/local/bin/node /home/ubuntu/qaap-e2e/node
cd /home/ubuntu/qaap-e2e && DOCKER_HOST=unix:///run/user/1000/docker.sock PATH=$PWD:$PATH ./node app/scripts/qaap-task-sandbox-broker-e2e.mjs --image <tenant image>
```

The e2e still stubs the orchestrator (no `QAAP_DOCKER_REMOTE_*` translation) and publishes the
tenant backend directly; those two are covered by the production rollout below.

**Exec server address (fixed Oct 17 2026).** In production a sandbox and its tenant backend sit on
two networks: the tenant's internal bridge (ICC on) and its direct-egress bridge, which runs with
`com.docker.network.bridge.enable_icc=false`. The broker used to return the container name as the
exec server host. Docker DNS answered with the egress address, so every connection timed out
(`connect ETIMEDOUT 172.25.0.3:7391`, exit 126). The post-deploy agent smoke failed on every deploy
after the flag went on. The broker now returns the sandbox's IP on the internal network
(`execServerHost`, read with `inspect` after start). It falls back to the name only when there is no
egress network. The e2e now attaches an `enable_icc=false` egress network too. On the VPS it fails
without the fix and passes with it: 14/14, two sandboxes in parallel in 2.8 s.

**Before the flag goes on in production:** run the broker e2e on the VPS (rootless daemon,
`QAAP_DOCKER_REMOTE_*` translation, egress proxy), and decide whether the tenant image should ship
the agent CLIs a devcontainer image lacks (today they must come from the image or from the tenant's
CLI prefix in its storage).

## Production rollout (VPS)

The control plane reads `QAAP_TASK_SANDBOX` (and the broker limits in the table below) from
`/opt/qaap/.env`, passed through the `theia` service's `environment` in `docker-compose.yml`.

- **Enable:** `QAAP_TASK_SANDBOX=1` in `/opt/qaap/.env`, then `docker compose up -d theia`. Tenant
  backends are recreated with the flag when they are next routed (deferred while a turn runs).
- **Roll back:** `QAAP_TASK_SANDBOX=0` (or remove the line), then `docker compose up -d theia`.
  Tenant backends are recreated without it, and the broker reaps the sandboxes of tenants it no
  longer routes. To check for leftovers, run
  `docker ps -a --filter label=com.qaap.task-sandbox.broker=true` on the rootless daemon.

**Production result (Oct 17 2026, build `11182b16b`, after #287).** The deploy's post-deploy agent
smoke (run 39024182157) passed. Its turn (task `3f6f6af1…`, `qaiq` on `jcristgd/OpenDots`) ran in
broker sandbox `qaap-task-6e835751c058`:

- Startup: 8.0 s, cold. This was the first sandbox on the new image, so it includes populating the
  toolchain volume.
- The turn completed in 33 s with the expected reply.
- The sandbox was gone 10 min after the turn ended (default linger).

The three deploys before #287 failed this smoke: the exec server was unreachable over the egress
bridge (see "Exec server address" above). Not yet verified in production: two parallel tasks from
the Work Hub UI with both previews.

## Flags

| Variable | Default | Meaning |
|---|---|---|
| `QAAP_TASK_SANDBOX` | off | Enable per-task sandboxes (direct mode; on a per-tenant control plane, the broker and its tenant backends) |
| `QAAP_TASK_SANDBOX_IMAGE` | `QAAP_TENANT_DOCKER_IMAGE` / `QAAP_THEIA_IMAGE` | Base image |
| `QAAP_TASK_SANDBOX_LINGER_MS` | 600000 | Keep the sandbox after the last task (0 = end immediately) |
| `QAAP_TASK_SANDBOX_ON_END` | `destroy` | `archive` = stop + rename instead of remove |
| `QAAP_TASK_SANDBOX_ARCHIVE_TTL_MS` | 86400000 | Archives older than this are reaped at boot |
| `QAAP_TASK_SANDBOX_OWNER` | host name | Owner label; the boot reaper only removes this owner's sandboxes |
| `QAAP_TASK_SANDBOX_NETWORK` | `bridge` | Docker network for sandboxes |
| `QAAP_TASK_SANDBOX_MEMORY` / `_CPUS` / `_PIDS` | `4g` / `2` / `1024` | Limits |
| `QAAP_TASK_SANDBOX_HOME_DIRS` | agent credential dirs | Comma list under `$HOME` mounted rw |
| `QAAP_TASK_SANDBOX_TOOLCHAIN` | unset | Host dir mounted ro at `/opt/qaap-agent` (its `bin/` first on PATH) |
| `QAAP_TASK_SANDBOX_MAX_PER_TENANT` | 8 | Broker mode: sandboxes per tenant (every state but archives) |
| `QAAP_TASK_SANDBOX_MAX_ARCHIVES_PER_TENANT` | 3 | Broker mode: archives kept per tenant |
| `QAAP_TASK_SANDBOX_PULL_ALLOWLIST` | empty (never pull) | Broker mode: image reference prefixes that may be pulled |
| `QAAP_TASK_SANDBOX_PULLS_PER_TENANT` / `_PULLS_PER_DAY` | 1 / 5 | Broker mode: concurrent and daily pulls per tenant |
| `QAAP_TASK_SANDBOX_PORT_WATCH_MS` | 1000 | Preview port detection interval |
