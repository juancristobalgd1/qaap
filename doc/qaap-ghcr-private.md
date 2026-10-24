# Making the GHCR image package private

The VPS pulls `ghcr.io/juancristobalgd1/qaap` on two sides. Today the package is public, so the
rootless tenant seed pulls anonymously. This runbook makes the VPS pulls authenticate with a
read-only credential, so the package can then be made private without breaking deploys.

Nothing here changes the publish job: CI keeps pushing with the workflow `GITHUB_TOKEN`.

## Who pulls what today

| Where | Daemon | Credential today | Notes |
|---|---|---|---|
| `.github/workflows/qaap-vps-deploy.yml`, `verify_image` job (`scripts/qaap-image-smoke.sh`) | CI runner | `docker/login-action` with `github.token` (`packages: read`) | Runs in CI, unaffected by the VPS credentials. |
| Same workflow, `deploy` job, SSH script | Host (root) | `docker login ghcr.io` with `github.token`, logged out on exit | Covers `scripts/qaap-vps-update.sh` and everything it runs. |
| `scripts/qaap-vps-update.sh`: `docker compose pull theia` | Host (root) | Workflow login above | Serving image. |
| `scripts/qaap-vps-tenant-image.sh`: `rootless_pull_digest` (host client to the rootless socket) | Rootless (uid 1000, `ubuntu`) | Anonymous: empty `DOCKER_CONFIG` | Tenant seed. Falls back to `docker save \| docker load`. |
| Same file: `docker exec theia docker pull` (fallback when the host cannot reach the rootless socket) | Rootless, inside Theia | Anonymous: `DOCKER_CONFIG=/nonexistent/...` | Not covered by the new credential, see Risks. |
| `scripts/qaap-vps-update.sh` prefetch | Rootless | Same as the host-client pull | Background job of the same pull. |
| `scripts/qaap-vps-rollback.sh`, `scripts/qaap-vps-safe-restart.sh`, `scripts/qaap-vps-image-prune.sh` | Host and rootless | None: they only inspect, tag, `up --pull never`, remove | No registry access. |
| `.github/workflows/qaap-staging-deploy.yml` | Staging host | `docker login` with `GHCR_TOKEN` | Separate host, unaffected by the VPS settings. |
| `packages/qaap-cloud-workspace/src/node/qaap-task-sandbox-broker.ts` (`docker.pull`, dockerode) | Rootless, inside Theia | Anonymous | Pulls devcontainer images from `QAAP_TASK_SANDBOX_PULL_ALLOWLIST`. Covered only if that allowlist names the qaap package; see Risks. |

## What the switch does

`scripts/qaap-ghcr-read-auth.sh` (sourced by `qaap-vps-update.sh`) reads two optional settings
from the environment or `/opt/qaap/.env`:

- `QAAP_GHCR_USERNAME`: the GitHub login that owns the token.
- `QAAP_GHCR_READ_TOKEN`: a classic PAT with **only** `read:packages`.

With both set, each update:

1. runs `docker login ghcr.io --password-stdin` for the host daemon (root);
2. runs the same login for the rootless daemon as `ubuntu` (`sudo -n -u ubuntu env DOCKER_HOST=unix:///run/user/1000/docker.sock docker login …`);
3. pulls the tenant digest with the host client to the rootless socket using that login, instead of an empty client config;
4. logs both daemons out on exit, including after a failed deploy.

With either setting missing, or both empty, nothing changes: the pulls are anonymous, as before.
The token is passed only on stdin, never in argv, and the script never prints it. A failed login is
reported as a warning and the update continues anonymously. The script parses `.env`; it does not source it.

## Runbook (run in this order)

Each step is operator-side. Do not change the package visibility before step 4.

1. **Create the token.** GitHub → Settings → Developer settings → Personal access tokens → Tokens
   (classic). Scope: `read:packages` only. No `write:packages`, no `repo`. Set an expiry and note its
   date. Use the account that owns the package, or one with read access to it.

2. **Add the settings to the VPS.** Edit `/opt/qaap/.env` (the file `docker compose` reads; keep it
   `chmod 600`):

   ```
   QAAP_GHCR_USERNAME=<github login>
   QAAP_GHCR_READ_TOKEN=<the PAT>
   ```

   Set both. Setting only one is refused with a warning and changes nothing.

3. **Deploy, and check that the pulls authenticate.** Run a deploy (or
   `./scripts/qaap-vps-update.sh --branch master` on the VPS). The log must contain:

   - `[qaap-ghcr] authenticated GHCR pulls as <user> (host: yes, rootless: yes)`
   - no `[qaap-ghcr] … login failed` line
   - `pulling … into rootless Docker (host client, authenticated read-only login …)` followed by
     `tenant image pulled into rootless Docker`, not the anonymous line or a `save | load` fallback.

   Check the credential works against the registry (read-only, operator shell on the VPS):

   ```
   TOKEN="$(sed -n 's/^QAAP_GHCR_READ_TOKEN=//p' /opt/qaap/.env)"
   USER_NAME="$(sed -n 's/^QAAP_GHCR_USERNAME=//p' /opt/qaap/.env)"
   CFG="$(mktemp -d)"
   printf '%s' "$TOKEN" | DOCKER_CONFIG="$CFG" docker login ghcr.io -u "$USER_NAME" --password-stdin
   DOCKER_CONFIG="$CFG" docker manifest inspect "ghcr.io/juancristobalgd1/qaap@<pinned digest>" >/dev/null && echo 'authenticated pull OK'
   DOCKER_CONFIG="$CFG" docker logout ghcr.io; rm -rf "$CFG"
   ```

   Also confirm the Actions access of the package (step 4 prerequisite below).

   After the deploy the daemons hold no GHCR login (logout on exit). Confirm with
   `docker system info` / `cat ~/.docker/config.json` that no `ghcr.io` entry remains.

4. **Only then, make the package private.** GitHub → the user's Packages → `qaap` → Package settings
   → Change visibility → Private. Before doing this, confirm under **Manage Actions access** that the
   repository `juancristobalgd1/qaap` still has access, because the CI `verify_image` job and the
   deploy's `GITHUB_TOKEN` login depend on it.

   Then run one more deploy (or re-run the last pinned one) and check: the CI `verify_image` job is
   green, and the VPS log still shows `authenticated GHCR pulls`. A pinned deploy must not show the
   `save | load` fallback, and an anonymous check must now fail:

   ```
   CFG="$(mktemp -d)"; DOCKER_CONFIG="$CFG" docker manifest inspect "ghcr.io/juancristobalgd1/qaap@<digest>" && echo 'still public' || echo 'anonymous denied (expected)'
   rm -rf "$CFG"
   ```

5. **Rollback (back to public).** GitHub → Packages → `qaap` → Package settings → Change visibility →
   Public. The VPS needs no change: anonymous pulls work again. Keeping the two `.env` settings
   is harmless; clear them to restore exactly the previous behaviour. Revoke the PAT if it is no longer used.

## Publish job

`qaap-vps-deploy.yml`'s publish job keeps `GITHUB_TOKEN` and `packages: write`. Nothing in this runbook
touches it. The `verify_image` and `deploy` jobs keep `packages: read` and their `GITHUB_TOKEN` logins.

## Risks and gaps

- **Theia-side pulls stay anonymous.** The seed falls back to `docker exec theia docker pull` only when
  the host cannot reach the rootless socket, and the task-sandbox broker pulls devcontainer images with
  dockerode. Neither receives the token: passing it into the Theia container would put a registry token
  next to tenant-reachable code (see #188 in `doc/qaap-ci-invariants.md`). If the package is private and
  these paths are used, they fail, and the seed falls back to `docker save | docker load` (slow, but
  the deploy still completes). The sandbox broker only pulls images that match
  `QAAP_TASK_SANDBOX_PULL_ALLOWLIST`; it does not pull the qaap image, so only a sandbox image on
  `ghcr.io/juancristobalgd1/qaap` would be affected.
- **Rootless login persists nothing.** The rootless `docker login` writes `/home/ubuntu/.docker/config.json`
  for the duration of the update and is removed on exit. It is not used by the host-client pull, which
  reads the root login. It is kept because the runbook requires it; the pull path does not need it.
- **Shared client config.** If the SSH deploy user is `ubuntu` (not root), the host login and the rootless
  login write the same `~/.docker/config.json`. Logout removes both entries. A workflow login made earlier
  in the same job is removed by that logout too; the deploy does not pull after `update.sh` exits.
- **Token expiry.** A classic PAT that expires makes the next update log `login failed` and pull
  anonymously. Public packages still pull; a private package then falls back to the slower
  `save | load` path. Set a reminder for the expiry date.
- **Not verified against the live registry.** The package's visibility and Actions access could not be
  read in this environment (the default `gh` token lacks `read:packages`). Check them in the GitHub UI
  before step 4.

## Tests

- `scripts/qaap-ghcr-read-auth.test.sh` (fake docker and sudo): no settings means no login; the token reaches
  only stdin, never argv or the log; host and rootless logins both run; logout runs; partial settings are refused.
  Runs in the `qaap-guards` job.
- `scripts/qaap-vps-tenant-image.test.sh` still asserts that unauthenticated runs never send credentials to the
  rootless daemon.
