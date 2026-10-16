# Per-task ephemeral sandbox (roadmap H2.2)

Status: v1 behind `QAAP_TASK_SANDBOX=1` (default off), direct mode only. Code:
`packages/qaap-cloud-workspace/src/node/qaap-task-sandbox.ts`, `qaap-devcontainer-config.ts`.
End-to-end check: `node scripts/qaap-task-sandbox-e2e.mjs` (needs `npm run build:browser` and Docker).

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
4. On boot, `reapOrphans()` removes sandboxes that a crashed or restarted backend left behind,
   plus archives older than `QAAP_TASK_SANDBOX_ARCHIVE_TTL_MS` (default 24 h). A clean shutdown
   ends live sandboxes.

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

**Secrets.** Variables reach a task only at exec time and only by name (`-e NAME`; the docker
CLI copies the value from its own env). They never appear in an argv, in the container's
persisted config or in `docker inspect`. Host-only variables (`PATH`, `HOME`, `DOCKER_*`,
`QAAP_TENANT_BACKEND_SECRET`, …) are never forwarded.

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

- **Automatic case:** a dev server spawned into a sandbox with `QAAP_PREVIEW_PORT`/`PORT`=P (the
  preview supervisor sets both) gets `127.0.0.1:P` on the backend forwarded to P inside the
  sandbox. The existing preview proxy keeps targeting `127.0.0.1:P` unchanged.
- **Hardcoded port case:** for an app that ignores `PORT`, `forwardPort(sandbox, 5173, 0)` maps
  its fixed port to a free host port. Wiring that into the preview port detection is a
  follow-up.

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
- **What a task still shares:** the repository's object store and refs, because commits must be
  visible for merge-back. It can therefore rewrite another worktree's branch ref. Stronger
  separation would need a `git clone --shared` per task, fetched on merge.
- **Tenant isolation is unchanged.** It is still C1-full: a tenant's own uid and its own
  container.

## Production: the remaining step (not in v1)

- **Where v1 works.** v1 needs the backend that spawns the agent to reach a Docker daemon. That
  holds in local development with Docker. It also holds on a control plane in
  `QAAP_CLOUD_MODE=docker`, but that mode currently keeps the tenant worker as the boundary:
  `taskSandboxFor()` is a no-op there.
- **Why production is not covered yet.** Production runs `QAAP_BACKEND_PER_TENANT=1`: agents
  spawn in a tenant backend container that has **no** Docker socket. Giving it one would let a
  tenant create privileged containers. A filtered socket proxy cannot prevent that either.
- **What the broker would be:**
  1. **Create/destroy/list RPC.** The control plane exposes a narrow RPC, authenticated with
     `QAAP_TENANT_BACKEND_SECRET`. It checks that the worktree path belongs to the tenant before
     it creates the sandbox on that tenant's internal network, reusing this module's run
     contract (mount source translation via the orchestrator).
  2. **Exec server in the sandbox.** Each sandbox runs a small exec server from a read-only
     `/opt/qaap-agent` toolchain volume (populated from the base image; glibc probe with
     base-image fallback), authenticated with a per-sandbox token.
  3. **Direct stdio.** The tenant backend's spawn seam launches a local node client that streams
     stdio to that exec server, so stdio never transits the control plane.
  4. **Preview.** Preview uses the same exec channel.
- **Before the flag goes on in production:**
  - this broker
  - routing terminals (`wrapShellForTenant`) into the sandbox
  - wiring `forwardPort` into the preview port detection for apps that ignore `PORT`

## Flags

| Variable | Default | Meaning |
|---|---|---|
| `QAAP_TASK_SANDBOX` | off | Enable per-task sandboxes (direct mode) |
| `QAAP_TASK_SANDBOX_IMAGE` | `QAAP_TENANT_DOCKER_IMAGE` / `QAAP_THEIA_IMAGE` | Base image |
| `QAAP_TASK_SANDBOX_LINGER_MS` | 600000 | Keep the sandbox after the last task (0 = end immediately) |
| `QAAP_TASK_SANDBOX_ON_END` | `destroy` | `archive` = stop + rename instead of remove |
| `QAAP_TASK_SANDBOX_ARCHIVE_TTL_MS` | 86400000 | Archives older than this are reaped at boot |
| `QAAP_TASK_SANDBOX_NETWORK` | `bridge` | Docker network for sandboxes |
| `QAAP_TASK_SANDBOX_MEMORY` / `_CPUS` / `_PIDS` | `2g` / `2` / `1024` | Limits |
| `QAAP_TASK_SANDBOX_HOME_DIRS` | agent credential dirs | Comma list under `$HOME` mounted rw |
| `QAAP_TASK_SANDBOX_TOOLCHAIN` | unset | Host dir mounted ro at `/opt/qaap-agent` (its `bin/` first on PATH) |
