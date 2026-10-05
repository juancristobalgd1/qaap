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
| **QAIQ guarded shell** (`CLAUDE_CODE_SHELL`, `qaap-agent-task-runner-tool-pills2.ts`) | `__dirname/../../../../scripts/qaap-guarded-bash.mjs` = `/app/scripts/…` | same expression = `/scripts/qaap-guarded-bash.mjs`, **missing** | **Broken**: hosted QAIQ/OpenClaude shells would point at a file that does not exist, and the destructive-command guard would not apply. Must be fixed before switching |
| `qaap-guarded-bash.mjs` → compiled guard | `../packages/qaap-cloud-workspace/lib/common/…` relative to the script | same, since `/app/packages/*/lib` stays in the image | OK while the image keeps `/app/packages` |
| System skills (`qaap-system-skills-env.ts`) | candidates relative to `__dirname`, then `cwd` | the first candidate is wrong, the others are right | OK. `QAAP_SYSTEM_SKILLS_DIR=/opt/qaap/system-skills` wins in the image |
| Legal pages (`qaap-immutable-chunk-cache-contribution.ts`) | `BackendApplicationPath/lib/frontend/legal`, fallback `__dirname/../../resources/legal` | first candidate exists (copied by `ApplicationPackageManager.copy`) | OK |
| Helper CLIs / helper API | env only (`QAAP_TASK_API_URL`, `QAAP_TASK_TOKEN`) | same | OK |
| Agent harnesses (qaiq, openclaude, codex, claude, opencode, …) | `PATH` (`/usr/local/bin`, `/opt/qaiq`) | same | OK |
| Tenant spawn wrapper, `setpriv`, rlimit fallback | inline `sh -c` scripts | same | OK |
| Built-in plugins | `--plugins=local-dir:/app/plugins` | same | OK |
| `--ovsx-router-config` | absolute path | same | OK |

## Not changed here

- **Node compile cache** (`/workspace/logs/coldstart.md`, F3): top-level compile of the 18.9 MB bundle
  costs 1.6–2.7 s cold and 45 ms with a V8 cache. The tenant backend runs as root and `~/.theia` is
  writable by the agent uid, so a cache needs a root-only directory. `NODE_COMPILE_CACHE` must also be
  removed from the env of every child process. That is a separate change on the tenant-spawn path.
- The default. Switch it only after the e2e plan below passes on the VPS.
