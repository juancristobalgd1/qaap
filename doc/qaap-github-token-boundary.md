# GitHub token boundary (security)

**Invariant:** agent processes never receive the signed-in user's GitHub token. That covers env vars,
files, credential helpers, `gh` configuration, fds and argv. Agents run as `QAAP_AGENT_UID` and
execute model-chosen commands, including commands planted by prompt injection (README, issues, web
pages, dependency scripts). The token is the control-plane OAuth token with scope `read:user repo`.
It can read and write **every** repository the user (and the orgs that allowed the app) can reach,
and it does not expire on GitHub's side. A short lifetime for a copy on our side does not limit a
token that has been exfiltrated.

Decision: Fo (CTO), Oct 4, 2026, after the review of PR #188 (finding A1). The first version of that PR
published the token in `/tmp/qaap-git-credential/github.json` for the agent uid, with a `gh` shim and a
system `credential.helper`. All of that is removed.

## What uses the token

Every GitHub transfer with the token runs as a **sealed git child of the backend uid**
(`QaapSealedGithubGit` in `qaap-shared-core`). The rules are the same for each one:

- A fresh `0700` bare repository in the backend's own temp dir, created with `--template=` and
  removed afterwards. `HOME` is that directory.
- `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, no hooks (`core.hooksPath=/dev/null`),
  `protocol.allow=never` except `https`, `http.sslVerify=true`, no background gc or maintenance, and
  `core.alternateRefsCommand` replaced by a no-op (otherwise git runs `for-each-ref` in the project).
- The URL is `https://github.com/<owner>/<repo>.git`, built by the backend from the workspace path
  `<reposRoot>/users/<login>/<owner>/<repo>` (`resolveRepositoryWorkspacePath`). It is never read
  from the project's `.git/config`.
- Only `PATH`, `LANG`, `LC_ALL` and the orchestrator's egress proxy variables (`HTTPS_PROXY`,
  `HTTP_PROXY`, `NO_PROXY` and their lower-case forms) are inherited. The orchestrator sets these on
  the backend container when a tenant egress proxy is configured (`tenantEgressProxyEnv`), and agents
  cannot change the backend's environment. The proxy is not repeated as `-c http.proxy` (no other
  git config is read, and argv is visible in `/proc/<pid>/cmdline`). Git runs with its private
  scratch directory as cwd.
- The token is only in that child's environment. An inline credential helper answers `get` from it
  only for `protocol=https`, `host=github.com` (a redirect to another host gets nothing) and ignores
  `store`/`erase`. Nothing is written to disk or argv.
- Hosted fetch bundles are created and removed by walking from the repositories root through
  directory descriptors that are checked not to be symlinks. A directory the agent swaps for a
  symlink fails the call, so the backend uid never creates a file outside the workspace tree. Linux
  walks `/proc/self/fd/<fd>/<name>`; darwin opens with `O_NOFOLLOW_ANY`, so the kernel refuses a
  symlink anywhere in the path, once a probe on a scratch directory proved the kernel takes the flag
  (the macos-15 CI runners reject it with `EINVAL`). Elsewhere, and on darwin without a working flag,
  the components are checked before and after the open and the file just created is removed when a
  swap is detected.

The token is used by:

- **Control-plane GitHub API calls** (repositories, pull requests, merge) in the backend, as before.
- **Hosted Work Hub push** (`commit-push`, `create-branch-commit-push`, `commit-create-pr`):
  `QaapHostedGitPush`.
  1. The endpoint reads the current branch, commit id and common git dir with the usual agent-uid git.
     That step has no token.
  2. The destination is the project's own repository and `refs/heads/<current local branch>`. A push
     remote naming another repository is refused, and `branch.*.merge` is ignored. The commit
     workflow returns the destination (`pushedTo`) and the Work Hub shows it.
  3. The sealed child runs `git push <url> <sha>:refs/heads/<branch>` with the project's `objects`
     directory as `GIT_ALTERNATE_OBJECT_DIRECTORIES`.
- **Sealed agent git CLI (`qaaq-git push`, `qaaq-git pr create`)**: `QaapAgentGitEndpoint` + `QaapHostedGitPush`.
  1. Agents receive only a per-task `git`-scoped token in a `0600` file (`QAAP_GIT_TOKEN_FILE`,
     revoked when the task ends) — never the user's GitHub OAuth token.
  2. `QaapHostedProjectResolver` resolves the target repository strictly from backend state, never
     from `.git/config` or request parameters.
  3. Detached `HEAD`, `main`, `master`, and the repository's GitHub `default_branch` are refused,
     force-push is always off (`force: false`), and read-only (`plan`) turns are refused.
  4. The push executes through `QaapHostedGitPush` and PR creation calls GitHub directly from the
     backend; the GitHub token never crosses into the agent process or its output.
- **Hosted open/clone/fetch of a GitHub repository** (`ensureRepositoryWorkspace`):
  `QaapHostedGitFetch`.
  1. The sealed child fetches every branch and tag into its scratch repository. For an existing
     workspace, the project's tips are offered as haves and its `objects` directory is an alternate,
     so only missing objects are downloaded. `.git` and `objects` must be plain directories inside the
     workspace; otherwise everything is downloaded.
  2. It writes a git bundle (every remote ref, the project's tips as prerequisites, a pack of the
     missing objects) as `.qaap-clone-<repo>-<hex>.bundle` next to the workspace. The file is
     created exclusively (an existing file or symlink fails) with mode `0644`.
  3. Tenant git (agent uid) runs `git clone <bundle>` (then `remote set-url origin <url>`) or
     `git fetch --prune <bundle> +refs/heads/*:refs/remotes/origin/*`. It has no credential.
     An empty GitHub repository becomes `git init` plus `origin`, and its seed commit goes through
     `QaapHostedGitPush`. The bundle is removed afterwards.
  4. In hosted mode the endpoint's tenant `runGit` refuses a token, and `runTenantGit` takes no extra
     environment.
  5. Disk and concurrency limits fail the open with an explicit error: each fetch is capped at
     `QAAP_SEALED_GIT_MAX_BYTES` (4 GiB) of scratch and of bundle, at most
     `QAAP_SEALED_GIT_MAX_CONCURRENT_FETCHES` (2) sealed fetches run per backend (a further one is
     refused, not queued), and the whole sealed scratch root may hold at most
     `QAAP_SEALED_GIT_SCRATCH_BUDGET_BYTES` (8 GiB), checked before and polled during each fetch.

### Permission assumptions (N3b)

The backend has `CapDrop: ALL` and no `CAP_DAC_OVERRIDE`. It is uid 1000, or 0 under rootless
Docker. It reads agent-created files only through their permission bits:

- **Objects:** the push and the incremental fetch read the project's `objects` as an alternate. Git
  creates loose objects and packs `0444` and directories `0755` under the default `022` umask, so
  "other" can read them. A `0700` object directory, `core.sharedRepository=0600` or a `077` umask in
  the tenant breaks this. It fails closed: the push reports a missing object, and the fetch downloads
  more than needed or fails.
- **Bundle:** the backend creates `<reposRoot>/users/<login>/<owner>/` itself before cloning. It must
  be able to create a file there, and the tenant must be able to read a `0644` file there. If the
  directory is not writable by the backend uid, the open fails with a permission error.

No test runs these paths under the production uid and capability set. Check them on a VPS after a
change to the tenant images, umask or volume ownership.

### Alternates are parsed by the backend uid (N4)

Git follows `objects/info/alternates` of the project's object store, and it parses packs, the
commit-graph and the multi-pack-index found there. All of these are agent-written. Git reads no
config or hooks from alternates, and the scratch repository has no refs (except the fetch's haves)
and no replace refs, so this does not run code. Alternates can point to any directory the backend uid
can read, so `ownsWorkspacePath` on the `objects` path does not limit them. The exposure is small:
only valid objects reachable from the pushed commit go to the project's own GitHub repository, and
only objects reachable from GitHub's refs (minus the project's tips) go into the bundle. We accept
this.

### Task pull requests (request-less)

`QaapTaskPullRequestService` (qaap-cloud-workspace) pushes task branches and opens PRs after a turn
settles, with no HTTP request in flight. It never gives the token to an agent and uses the same sealed
paths: `QaapHostedGitPush.push` (task branch, force only for a branch it rebuilt; `refs/qaap/evidence/*`),
`QaapHostedGitPush.remoteRef` (sealed `ls-remote` before each push, to detect someone else's push) and
`QaapHostedGitFetch.fetchBundle` (to bring a foreign push into the project before building on it).

Where the token comes from:

- **Shared control plane** (no per-tenant backends): `QaapGithubSessionStore.findAccessTokenForLogin`.
- **Per-tenant backend** (`QAAP_BACKEND_PER_TENANT=1`, the tenant container runs with
  `QAAP_TENANT_BACKEND_MODE=1`): there is no shared session store. The control-plane proxy forwards the
  owner's token on every request inside the short-lived HMAC assertion (`x-qaap-tenant-assertion`,
  30 s TTL, `githubAccessToken`), exactly as diff-review's commit-push gets it. `QaapGithubAuthGuard`
  records the token of each verified assertion in `QaapGithubOwnerTokenCache`: backend heap only, never
  on disk, never in an agent's env, dropped after 12 h without a request and on a GitHub 401. The tenant
  backend serves exactly one login, so the cache holds one token. The tenant-local session store is not
  read in this mode (agents can write it).
- Without a token the conversation shows "no GitHub token: sign in again" (state `needs-sign-in` plus a
  timeline note) instead of failing silently.

## Why not a git process as the agent uid with the token

Any process of the same uid can read `/proc/<pid>/environ`, open its fds and (depending on
`ptrace_scope`) trace it. The project's `.git/config` and hooks are agent-writable. A
`credential.helper` there receives the password on `store`, and `http.proxy` plus
`http.sslVerify=false` intercepts it. So the sealed push and fetch never read the project's config.
They read only object data, and only as the backend uid.

## Not covered (by design)

- `git push` / `gh` typed in a terminal or run by an agent have no credential. A user who wants them
  signs in themselves (`gh auth login`, their own PAT). That credential then belongs to the uid and is
  as exposed as anything else the agent can read.
- Personal API tokens (`qaap_pat_`) can create and cancel agent tasks only (`QaapGithubAuthGuard`
  allowlist). They cannot reach the commit/push endpoint.

## Managed GitHub MCP server (2026-11-18)

The agent's GitHub tools use a managed MCP server named `qaap-github` (not `github`: that name stays
the user's own preference entry). It talks to `https://api.githubcopilot.com/mcp/readonly` with the
headers `X-MCP-Readonly: true` and `X-MCP-Lockdown: true`.

- **Where the token lives:** only in the backend heap, and only in the `Authorization` header sent to
  `api.githubcopilot.com`. It is never in the server description, `env`, `serverAuthToken`,
  preferences, logs, the keystore or an error message. Autostart is off; the server starts on demand.
- **Identity is the object, never the content:** the backend manager creates the managed server object
  itself and hands the managed token provider to that object alone; the upstream OAuth factory is not
  replaced. The name `qaap-github` (any letter case) and the marker client id `qaap-managed-github` are
  reserved: an entry that uses either, from user or workspace settings, an agent-written
  `~/.theia/settings.json`, a VS Code extension or an RPC call, is dropped by the frontend and refused by
  the backend. The managed server only starts with its exact read-only configuration (URL and both headers).
- **Per-mode scope (fail closed):** `desktop` (`QAAP_DESKTOP=1`, never on a hosted or tenant backend) reads
  `GH_TOKEN`, then `GITHUB_TOKEN`, then `gh auth token`, then the stored OAuth session. `gh` runs only by an
  absolute path (absolute PATH entries, then `/opt/homebrew/bin`, `/usr/local/bin`; never the working
  directory), with a 5 s timeout, no shell, `GH_*` overrides removed and failures reduced to a code. A
  per-tenant backend reads only its owner's token from the request-scoped owner cache and never the
  environment or `gh`. `local` needs the explicit `QAAP_LOCAL_DEV=1` (set by `npm run start:browser`, not
  for a nested preview) or `QAAP_CLOUD_MODE=local`, and reads a stored session only when exactly one login
  exists. Everything else (a hosted backend, a tenant backend without an owner, an unstated runtime) is
  `none`: nothing is registered or read. The desktop launcher (`scripts/qaap-start-electron.mjs`) sets
  `QAAP_DESKTOP=1` and no `NODE_ENV`; a desktop build that sets `NODE_ENV=production` would land in `none`.
- **Workspace trust:** the on-demand start is refused in an untrusted workspace, like upstream MCP autostart.
- **Read-only only:** the managed server uses `/mcp/readonly` and nothing else (no write URL exists in code
  until the opt-in does). On top, only tools GitHub marks `readOnlyHint` are listed or called; a call is
  checked against the live tool list, so a direct `callTool` or a tool announced later is also filtered.
- **401 handling:** the managed provider never waits for a browser. A rejected token is forgotten by a
  tenant backend only after `GET https://api.github.com/user` also returns 401. If `/user` accepts the
  token, the endpoint refusal is reported as a policy or OAuth-app restriction, not as a sign-in prompt.
  `/user` is checked at most once per token every 5 minutes (keyed by a SHA-256 of the token).
- **Single owner:** a tenant backend serves one owner; its owner-token cache is the only source.
- **Never to harness CLIs:** Theia MCP servers are not exported to `.mcp.json` or to any agent CLI.
- **Egress:** `.githubcopilot.com` is already on the tenant egress allowlist; nothing changed there.
- **Status to the frontend:** `QaapGithubMcpStatusService` (RPC `/services/qaap-github-mcp-status`, per
  connection) answers `available`, `source`, `mode` and `rejectedByPolicy` only; the value is copied field by
  field, so no token can cross it. The chat error and the chip tooltip use it for the desktop hint
  "…or run `gh auth login`".
- **Policy refusal:** a 401 (through the managed provider) or a 401/403 that ended in `Errored` is checked
  against `GET /user`. If GitHub accepts the token, the refusal is recorded per token hash for an hour: the
  server is not started again for that token (stable code `qaap-github-mcp/policy-rejected`), the chat shows
  "GitHub MCP rejected this token (Copilot policy or OAuth app restriction)" and no Connect chip is offered.
- **Connect GitHub chip:** the chat input shows it only for `needs-credential`, `auth-required` (GitHub sign-in)
  and `untrusted` (workspace trust dialog). The state lives in qaap-ai-config behind the structural contract
  `QaapGithubMcpConnectionState` (qaap-shared-core), injected optionally by qaap-composer.
- **Upstream prompts:** `code-reviewer` and `explore` refer to `{{prompt:mcp_github_tools}}`. While the managed
  tools are registered and the user has no `github` server, that fragment is an alias of the managed tools; a
  user `github` server keeps its own fragment.
- **Not done yet:** the `qaap.mcp.github.allowWrite` opt-in with confirmation (`docs/HANDOFF.md`).
- **Decision (2026-11-18): left dormant.** The managed server stays as built, but no harness uses it: harness CLIs
  (Claude Code, Codex, OpenCode, …) never receive Theia MCP servers, and the Theia GitHub chat agent is not offered
  in the composer. Nothing starts it at boot; it only starts if a Theia GitHub turn asks for it. Re-evaluate before
  wiring it to any harness, and keep the rules above when doing so.
- **Token-less legacy server never starts (backend):** besides the frontend filter and the settings migration, the
  connection's MCP manager refuses any local description that runs `@modelcontextprotocol/server-github` (any name,
  pinned version, or the `mcp-server-github` binary) without `GITHUB_PERSONAL_ACCESS_TOKEN` in its `env` or the
  backend environment, and refuses to start one whose token is gone. This closes the start-up race in which a
  frontend that did not filter the entry autostarted it before the migration removed it.

## Desktop without a Qaap GitHub session (2026-11-18)

- **Opening a project:** on desktop (`QAAP_DESKTOP=1`, skip-auth guard) `POST …/repositories/:owner/:repo/open`
  opens an existing checkout at the caller's canonical path (`{reposRoot}/users/{login}/{owner}/{repo}`, still
  checked with `isPathUnderUserWorkspace`) without any GitHub or git network call. A missing checkout is cloned by
  the backend's own git, which on desktop runs as the user, so their git credential helpers (`gh auth setup-git`,
  the keychain) answer exactly as in a terminal; Qaap never sees or passes a token there. Removed projects stay
  removed (410). Web and VPS are unchanged: without the owner's OAuth session the route answers 503.
- **Sign-in:** on desktop `startGithubOAuth` never navigates the app window. It raises the cancelable
  `qaap-desktop-github-sign-in` event; the Work Hub opens the device-flow dialog, GitHub's page opens in the system
  browser and the backend sets the session cookie, so the app keeps its state. Web keeps the OAuth redirect.

## Checks

- `qaap-github-mcp-credential-resolver.spec` (shared-core): source order, `gh` failures, tenant and
  shared-backend rules, 401 verdicts, and no token in `describe()`.
- `qaap-github-mcp-backend.spec` (ai-config): token absent from the managed description, provider
  without keystore, a 401 never hangs, read-only tool filter, no start without a credential.
- `qaap-github-mcp-on-demand-starter.spec` (ai-config): no `startServer` without credential, one start
  for concurrent turns, outcomes for auth and errors.
- `qaap-github-mcp-backend.spec` also pins the spoofing scenarios: a `qaap-github` entry with `/mcp/` and the
  marker, `/readonly` without headers, without OAuth, as a command, in another letter case, the marker under
  another name and an extension-labelled `qaap-github`; none replaces the managed server or reaches a write tool.
- `qaap-github-mcp-managed.spec` (shared-core): the reserved name and marker client id.
- `qaap-github-mcp-connection-state-impl.spec`, `qaap-mcp-frontend-service.spec` (ai-config) and
  `qaap-github-mcp-connect-chip.spec` (composer): chip states and actions, the prompt alias.
- `qaap-mcp-frontend-application-contribution.spec` (ai-config): reserved entries never leave the frontend.
- `qaap-github-mcp-default-migration.spec` (ai-config): the mirror write is a patch; a server only in the mirror is kept.
- `qaap-hosted-git-push.spec`: the project config and hooks never run, the token is never in argv,
  the scratch repo is removed, and the egress proxy is passed with TLS verification on.
- `qaap-hosted-git-fetch.spec`: the bundle carries every remote ref, only missing objects, and never
  reads the project config.
- `qaap-git-review-endpoint.spec` ("hosted push"): agent-uid git never pushes and never sees the token;
  the destination is the project's own repository and current branch.
- `qaap-github-oauth-hosted-workspace.spec`: hosted clone, fetch and seed never give tenant git the
  token, ignore an agent-rewritten `origin`, and skip a symlinked `objects` directory.
- `qaap-github-oauth-endpoint.spec` ("hosted: tenant git never receives the GitHub token").
- `qaap-legacy-git-credential-cleanup.spec`: a tenant backend deletes a credential file left by an
  older build.
