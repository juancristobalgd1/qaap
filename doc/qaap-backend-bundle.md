# Running the backend from the esbuild bundle

Status (Oct 2026): **opt-in, not the default.** Main and tenant backends run
`node src-gen/backend/main.js` unless `QAAP_BACKEND_ENTRY=lib/backend/main.js`.

## Why

`src-gen/backend/main.js` loads ~2,800 files from `node_modules` at startup. Uncontended, module loading
is 4.4 s of the 8.7 s it takes a tenant backend to listen (11.4 s of 22.2 s on a contended host). The image
already ships the esbuild backend bundle: `examples/browser/esbuild.mjs` → `gen-esbuild.node.mjs`
(`compileESBuildNodeConfig` in `dev-packages/application-manager/src/generator/bundler-generator.ts`)
writes `lib/backend/main.js` (~18.9 MB) and its sibling entries during `npm run build:production`. The
browser example uses esbuild, not webpack: `esbuild.mjs` exists, so `BundlerGenerator.preferESBuild()`
is true.

## Launch sites

| Where | What starts | Entry |
|---|---|---|
| `Dockerfile` `CMD` | main (control-plane) backend, VPS `theia` service, image smoke | `QAAP_BACKEND_ENTRY` (allow-list in the shell `case`) |
| `docker-compose.yml` `theia.environment` | passes `QAAP_BACKEND_ENTRY` (empty by default) to the main backend | — |
| `qaap-docker-orchestrator.ts` `tenantBackendCommand()` | every tenant backend container (`WorkingDir /app/examples/browser`) | same env, read by the main backend; same allow-list |
| `qaap-docker-orchestrator.ts` `tenantBackendContainerMatches()` | reuse check compares the full `Cmd` | a backend started with another entry is stale |
| `scripts/qaap-image-smoke.sh` | CI image candidate, runs the image `CMD` | inherits the default |
| `theia start` (`npm run start:browser`; `playwright.yml` via `examples/playwright/configs/qaap-upstream-ci-theia-start.js`, `qaap-mobile-playwright.yml`, `qaap-rioja-agent-e2e.yml`) | dev and CI e2e backends | **already the bundle**: `ApplicationPackageManager.startBrowser` forks `lib/backend/main.js` when it exists, else `src-gen`. CI runs `npm run build:browser` first, so its Linux e2e suites (terminals, plugin host, agents) run the development-mode (unminified) bundle |
| `devfile.yaml`, `.vscode/launch.json` | upstream developer tooling | unchanged |

Only the two literal values are accepted, `src-gen/backend/main.js` (default, also for an empty value)
and `lib/backend/main.js`. Anything else is refused: the Dockerfile `CMD` exits 64, and the orchestrator
throws before it creates a tenant container. Changing the value makes every idle tenant backend stale.
The orchestrator recreates it on the next request. If an agent turn is running, recreation is deferred
like an image change (`deferredTenantBackendRecreations`).

Production is therefore the only place still running `src-gen`. What CI does not cover: the
production-mode (minified) bundle, the read-only tenant rootfs, the root tenant user, and the
`/app` image layout. The layout check and the VPS plan below cover those.

## What the backend loads by path

In the bundle every module's `__dirname` is `/app/examples/browser/lib/backend`. Unbundled, it was the
module's own `packages/<pkg>/lib/node` directory or `node_modules/...`.

| Dependency | Unbundled | Bundled | Status |
|---|---|---|---|
| App project path (`THEIA_APP_PROJECT_PATH`, `BackendApplicationPath`) | `resolve(src-gen/backend, '..', '..')` | `resolve(lib/backend, '..', '..')`, same directory | OK |
| Frontend static files | `../../lib/frontend` | same depth | OK |
| IPC bootstrap (`ipc-connection-provider.ts` forks `__dirname/ipc-bootstrap`) | `@theia/core/lib/node/messaging/ipc-bootstrap.js` | entry `lib/backend/ipc-bootstrap.js` | OK |
| Plugin host (`plugin-ext-hosted-backend-module.ts` forks `__dirname/plugin-host`) | `@theia/plugin-ext/lib/hosted/node/plugin-host.js` | entry `lib/backend/plugin-host.js` | OK |
| `backend-init-theia` (`scanner-theia.ts`) | package file | entry `lib/backend/backend-init-theia.js` | OK |
| `plugin-vscode-init` (`scanner-vscode.ts`: `path.join(__dirname, 'plugin-vscode-init')`) | package file | entry `lib/backend/plugin-vscode-init.js` | OK |
| `plugin-host-rpc.ts` fallback `__dirname + '/scanners/backend-init-theia.js'` | package file | missing | Reached only if a scanner sets no `backendInitPath`. Upstream has the same gap |
| File watcher | `--no-cluster` → in-process (`WATCHER_SINGLE_THREADED`); `parcel-watcher` entry for the forked mode | `lib/backend/parcel-watcher.js`, `@parcel/watcher` `.node` under `native/` | OK. The native module is chosen for the build stage's libc/arch (same image) |
| node-pty (terminals, every tenant spawn) | `node-pty/prebuilds/linux-x64/pty.node` (`loadNativeModule` tries `../build/Release`, …, `../prebuilds/<platform>-<arch>`) | `lib/prebuilds/linux-x64/pty.node`, copied by `copyNodePtySpawnHelper` (bundle-plugin). `require('../prebuilds/…')` resolves relative to the bundle file | OK on paper. The copy runs in an un-awaited `onEnd`, so the layout check verifies it |
| ripgrep | `@vscode/ripgrep` `rgPath` | rewritten to `lib/backend/native/rg` | OK |
| drivelist | `bindings` | `lib/backend/native/drivelist.node` | OK |
| Terminal shell integration | `@theia/terminal/lib/node/shell-integrations` | copied to `lib/backend/shell-integrations` | OK |
| QAIQ guarded shell (`CLAUDE_CODE_SHELL`, `qaap-agent-task-runner-tool-pills2.ts`) | `__dirname/../../../../scripts/qaap-guarded-bash.mjs`: from `packages/qaap-cloud-workspace/lib/node` that is `/app/scripts/…` | from `examples/browser/lib/backend`, also four levels below `/app`: the same file | OK, but only because both directories are four levels deep. The layout check pins it, since a missing file would leave hosted QAIQ shells without the destructive-command guard |
| `qaap-guarded-bash.mjs` → compiled guard | `../packages/qaap-cloud-workspace/lib/common/…` relative to the script | same, since `/app/packages/*/lib` stays in the image | OK while the image keeps `/app/packages` |
| System skills (`qaap-system-skills-env.ts`) | candidates relative to `__dirname`, then `cwd` | the first candidate is wrong, the others are right | OK. `QAAP_SYSTEM_SKILLS_DIR=/opt/qaap/system-skills` wins in the image |
| Legal pages (`qaap-immutable-chunk-cache-contribution.ts`) | `BackendApplicationPath/lib/frontend/legal`, fallback `__dirname/../../resources/legal` | first candidate exists (copied by `ApplicationPackageManager.copy`) | OK |
| Helper CLIs / helper API | env only (`QAAP_TASK_API_URL`, `QAAP_TASK_TOKEN`) | same | OK |
| Agent harnesses (qaiq, openclaude, codex, claude, opencode, …) | `PATH` (`/usr/local/bin`, `/opt/qaiq`) | same | OK |
| Tenant spawn wrapper, `setpriv`, rlimit fallback | inline `sh -c` scripts | same | OK |
| Built-in plugins | `--plugins=local-dir:/app/plugins` | same | OK |
| `--ovsx-router-config` | absolute path | same | OK |

## Layout check

`QaapBackendBundleLayoutCheck` (`packages/qaap-cloud-workspace/src/node/qaap-backend-bundle-layout.ts`)
encodes the table above. It collects:

- the fixed requirements: `lib/backend/main.js`, `package.json`, `lib/frontend/index.html`, `/app/plugins`,
  `ovsx-router-config.json`, the compiled destructive-command guard, `lib/backend/shell-integrations`
  (must not be empty), and `lib/prebuilds/<platform>-<arch>/pty.node`;
- every entry in `gen-esbuild.node.mjs` as `lib/backend/<entry>.js`. The ConPTY helpers are skipped
  off Windows. If the config is missing, that is reported as a problem instead of guessing;
- the string literals each `lib/backend/*.js` turns into paths: `path.join/resolve(__dirname, '…')`,
  template prefixes, `__dirname + '…'` and the `./native/…` assets.

Known fallbacks may be missing (`optionalPaths`): `scanners/backend-init-theia.js`, the first
system-skills candidate and `../../resources/legal`. Everything else counts as a problem (`missing`,
`empty`, or `load-failed` with `--load-native`). Run it inside the image:

    docker run --rm --entrypoint node <image> /app/scripts/qaap-backend-bundle-layout-check.js --load-native

It exits 1 and lists each path along with what needs it. Breakage it reports if the image layout
drifts: no `pty.node` means no terminals or tenant spawns. A missing entry (`ipc-bootstrap`, `plugin-host`,
`plugin-vscode-init`, …) means no IPC children or plugins. A missing `native/rg` or `drivelist.node` breaks
search and file dialogs. Empty `shell-integrations` loses terminal shell integration. A missing
`scripts/qaap-guarded-bash.mjs` leaves QAIQ shells without the guard. The spec builds the image layout in
a temp directory and removes each of these in turn.

## VPS e2e plan

This has not been run. Each phase needs an operator. Phases 0–2 never touch the running service.
Run host checks as root or through `docker compose exec`. The loopback guard rejects `ubuntu`'s
own `127.0.0.1:4873` clients (ci-invariants, "Tenant host loopback guard").

**Phase 0: baseline (read-only).**
- `docker ps --format '{{.Names}} {{.Image}} {{.Status}}'`. Record the `qaap-theia-1` image
  (`docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}'`). Its
  `docker image inspect -f '{{json .Config.Cmd}}'` must mention `QAAP_BACKEND_ENTRY`. Otherwise the image
  predates this change and ignores the variable.
- `docker inspect -f '{{json .Config.Cmd}}' qaap-backend-<id>` on the rootless daemon shows
  `src-gen/backend/main.js` today.
- For 2–3 recent tenant starts, take timings from `docker logs -t qaap-backend-<id>`: container start →
  `detected agents` → `Theia app listening on` → plugins deployed. Use the same phases as
  `/workspace/logs/coldstart.md`, and note whether the host was contended (`docker stats --no-stream`).

**Phase 1: layout check in the image (no service change).**

    docker run --rm --read-only --tmpfs /tmp --entrypoint node <image> \
        /app/scripts/qaap-backend-bundle-layout-check.js --load-native

Pass: `OK: N paths … native modules load`, exit 0. Any `MISSING`/`EMPTY`/`LOAD-FAILED` stops the plan.
`--read-only` matches the tenant rootfs.

**Phase 2: side-by-side cold start (throwaway containers, not the service).** Use the same image
with no published ports and `--network none`. Do this three times per entry, alternating:

    docker run --rm -d --name qaap-bebundle-<entry>-<n> --network none \
        --cpus 2 --memory 4g -e QAAP_BACKEND_ENTRY=<entry> <image>

These containers run the image's main-backend role with default settings (no OAuth, no Docker
socket). They measure module loading and catch load errors. Tenant-only paths are left to phase 3.

- Time `docker logs -t` from start to `Theia app listening on`. Pass: the bundle saves ≥ 3 s
  uncontended (expected ~4–5 s, coldstart.md module-loading phase).
- `docker exec … node -e '<health GET /qaap/api/health>'` returns 200 (same probe as the HEALTHCHECK).
- grep the logs for `Cannot find module`, `Failed to load native module`, `ENOENT`, `MODULE_NOT_FOUND`,
  `plugin-host` and `exited`. All must be empty. Plugin deploy must report the same plugin count as src-gen (98).
- `docker stats --no-stream`: RSS stays within +20 % of src-gen.
- `QAAP_BACKEND_ENTRY=bogus` exits 64 with `Unsupported QAAP_BACKEND_ENTRY`.

**Phase 3: canary on the service (explicit approval needed, outside a demo window).** Set
`QAAP_BACKEND_ENTRY=lib/backend/main.js` in the VPS `.env`, then run `docker compose up -d theia`. The main
backend restarts. Each idle tenant backend is recreated with the new `Cmd` on its next request. A tenant
with a running agent turn keeps src-gen until the turn ends (deferred recreation). Then
check with a test account in a fresh tenant:

| Area | Check | Depends on |
|---|---|---|
| Tenant spawn | `docker inspect` the new `qaap-backend-<id>`: `Cmd` has `lib/backend/main.js` | orchestrator `tenantBackendCommand()` |
| Terminals | open a terminal, `echo ok` prints, resize works, no `terminal "<id>" does not exist` | `lib/prebuilds/linux-x64/pty.node`, spawn wrapper (ci-invariants #1) |
| Shell integration | command decorations appear after `ls` | `lib/backend/shell-integrations` |
| Plugin host | open a `.ts` file: hover/diagnostics work, Git SCM view lists changes, no plugin-host crash in the logs | `plugin-host.js`, `plugin-vscode-init.js`, `backend-init-theia.js` |
| Search / dialogs | workspace text search returns hits, the Open File dialog lists drives/roots | `native/rg`, `native/drivelist.node` |
| File watching | `touch x` in a terminal shows up in the explorer | `parcel-watcher` / in-process watcher |
| IPC children | anything that forks `ipc-bootstrap` (e.g. hosted plugin, file-watcher fork) starts | `ipc-bootstrap.js` |
| Agent runners | one QAIQ turn and one codex/claude turn complete. `detected agents` lists the same harnesses as before | `PATH`, helper API env |
| Guarded shell | in a QAIQ turn, a destructive command (e.g. `rm -rf /`) is refused by the guard | `CLAUDE_CODE_SHELL` → `/app/scripts/qaap-guarded-bash.mjs` → compiled guard |
| Helper CLIs | an agent turn that calls the task API (`QAAP_TASK_API_URL`) succeeds | env only |
| Preview | start a dev-server preview, it reaches `ready` | tenant spawn + terminals |
| Main backend | login, Work Hub, project list, `/qaap/api/health` 200 | Dockerfile `CMD` |

Then keep it running for 24 h. Compare tenant `Theia app listening on` times against phase 0, and watch
`docker logs` of `qaap-theia-1` and the tenants for the phase-2 error strings.

**Rollback.** Remove the line from `.env` (or set it empty), then `docker compose up -d theia`. Tenants go
back to src-gen on their next request, because the `Cmd` mismatch makes them stale. No data migration is
involved. Both entries read the same `~/.theia`/`~/.qaap`.

**Then.** After phase 3 passes, change the default in the Dockerfile `CMD`, `getTenantBackendEntry()` and
their specs in a separate commit. Add the phase-1 command to `scripts/qaap-image-smoke.sh` so CI
checks every candidate image.

Notes for the reviewer: the node bundle is `platform: 'node'` with no `define`, so tenants keep reading
`NODE_ENV=development` at runtime as before. `minify` is on without `keepNames`. The only
qaap backend use of `constructor.name` is a log line (`qaap-ai-provider-env-tenant-scope.ts`).

## Not changed here

- **Node compile cache** (`/workspace/logs/coldstart.md`, F3): top-level compile of the 18.9 MB bundle
  costs 1.6–2.7 s cold and 45 ms with a V8 cache. The tenant backend runs as root and `~/.theia` is
  writable by the agent uid, so a cache needs a root-only directory. `NODE_COMPILE_CACHE` must also be
  removed from the env of every child process. That is a separate change on the tenant-spawn path.
- The default. Switch it only after the e2e plan below passes on the VPS.
