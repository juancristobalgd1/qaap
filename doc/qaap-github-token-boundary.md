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

- **Control-plane GitHub API calls** (repositories, pull requests, merge) in the backend, as before.
- **Hosted Work Hub push** (`commit-push`, `create-branch-commit-push`, `commit-create-pr`):
  `QaapHostedGitPush` in `qaap-diff-review`.
  1. The endpoint reads the branch, commit id, GitHub remote and `objects` directory with the usual
     agent-uid git. That step has no token.
  2. The tenant backend (root in its container) creates a fresh `0700` bare repository in its own
     temp dir. It runs `git push https://github.com/<owner>/<repo>.git <sha>:refs/heads/<branch>`
     there, with `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null`, no hooks, `protocol.allow=never`
     except https, and the project's objects as `GIT_ALTERNATE_OBJECT_DIRECTORIES`.
  3. The token is only in that root child's environment. An inline credential helper answers `get`
     from it and ignores `store`/`erase`. Nothing is written to disk or argv.

## Why not a git process as the agent uid with the token

Any process of the same uid can read `/proc/<pid>/environ`, open its fds and (depending on
`ptrace_scope`) trace it. The project's `.git/config` and hooks are agent-writable. A
`credential.helper` there receives the password on `store`, and `http.proxy` plus
`http.sslVerify=false` intercepts it. So the push never reads the project's config. It reads only
object data, and only as the backend uid.

## Not covered (by design)

- `git push` / `gh` typed in a terminal or run by an agent have no credential. A user who wants them
  signs in themselves (`gh auth login`, their own PAT). That credential then belongs to the uid and is
  as exposed as anything else the agent can read.
- Personal API tokens (`qaap_pat_`) can create and cancel agent tasks only (`QaapGithubAuthGuard`
  allowlist). They cannot reach the commit/push endpoint.

## Checks

- `qaap-hosted-git-push.spec`: the project config and hooks never run, the token is never in argv,
  and the scratch repo is removed.
- `qaap-git-review-endpoint.spec` ("hosted push"): agent-uid git never pushes and never sees the token.
- `qaap-legacy-git-credential-cleanup.spec`: a tenant backend deletes a credential file left by an
  older build.
