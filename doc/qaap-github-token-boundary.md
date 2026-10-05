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
  cannot change the backend's environment. `http.proxy` is pinned to the same `HTTPS_PROXY`.
- The token is only in that child's environment. An inline credential helper answers `get` from it
  and ignores `store`/`erase`. Nothing is written to disk or argv.

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

## Checks

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
