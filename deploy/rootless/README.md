# VPS rootless worker deployment

This overlay records the configuration verified on the Qaap VPS on 2026-09-17.
It is **host-specific**, not an unattended installation script. Keep production
OAuth, the beta allowlist, and backend-per-tenant isolation enabled.

## Host prerequisites and mapping

- The rootful daemon hosts Caddy and the control plane.
- The `ubuntu` user (host UID 1000) runs the rootless worker daemon at
  `/run/user/1000/docker.sock`, with its user service and lingering enabled.
- The verified rootless UID/GID mapping is `0 -> 1000`, then
  `1..65536 -> 100000..165535`. Worker UID/GID 1000 therefore maps to host
  **100999**, also used by the non-root control-plane image.
- The socket's verified host group is **100987**. The control plane receives
  that supplementary group; do not make the socket world-writable.
- `qaap_default` has gateway **172.18.0.1**. Tenant backend ports are published
  only on that private bridge, which the control plane can reach. Its own
  loopback is not the host loopback.
- `br_netfilter` is loaded; `qaap-rootless.conf` is installed at
  `/etc/modules-load.d/qaap-rootless.conf` so this survives host reboot.

Re-check all mappings, socket permissions and network addresses before using
this overlay on another machine. Never substitute the privileged rootful socket
for the rootless socket used by the application.

## Persistent data

The following rootful named volumes were copied, with the control plane stopped,
into bind-mounted host directories. The **original volumes were retained** as a
pre-migration recovery copy. They do not contain subsequent writes.

| Original volume | Active host directory |
| --- | --- |
| `qaap_theia-workspace` | `/opt/qaap-runtime/workspace` |
| `qaap_theia-worktrees` | `/opt/qaap-runtime/worktrees` |
| `qaap_theia-parallel` | `/opt/qaap-runtime/parallel` |
| `qaap_qaap-auth-data` | `/opt/qaap-runtime/auth` |
| `qaap_qaap-theia-user` | `/opt/qaap-runtime/theia-user` |
| `qaap_qaap-tenant-homes` | `/opt/qaap-runtime/tenant-homes` |

The copied directories are owned by host UID/GID 100999. The explicit
`QAAP_DOCKER_REMOTE_*` paths let the rootless daemon mount the same data seen by
the control plane. A path that exists only inside the control-plane container
is not sufficient. Back up these active directories securely, including auth
data, before subsequent migrations. Do not run `docker compose down -v`.

`compose.override.yml` is installed as `/opt/qaap/docker-compose.override.yml`.
The original compose file still supplies the remaining environment, socket mount,
ports and health checks.

## Updating images

With this overlay, plain `docker compose build theia` builds **only the derived
control-plane image**, not the full application. Existing deployment scripts
must account for this distinction. For this VPS's local-image configuration,
run the following in Bash from `/opt/qaap`, after reviewing and backing up changes:

```sh
set -euo pipefail
docker -H unix:///var/run/docker.sock compose -f docker-compose.yml build theia
docker -H unix:///var/run/docker.sock image inspect qaap-theia:local >/dev/null
docker -H unix:///var/run/docker.sock save qaap-theia:local |
    docker -H unix:///run/user/1000/docker.sock load
docker -H unix:///var/run/docker.sock compose build theia
docker -H unix:///var/run/docker.sock compose up -d --no-build --no-deps theia
```

The image transfer is large and may remain silent until `docker load` completes.
Do not interrupt it merely because no progress is printed. If using a registry
image instead, use the reviewed pinned image in both daemons and align
`QAAP_THEIA_IMAGE` with the derived image's base argument.

Existing tenant containers keep their old image until recreated. Plan that
separately during a maintenance window; do not blindly delete active user
containers. The login-only hotfix changes the control plane's pre-bundle asset
and its gzip companion without requiring a worker-image update.

## Checks

```sh
docker -H unix:///var/run/docker.sock compose ps
curl -fsS http://127.0.0.1:4873/qaap/api/auth/config
docker -H unix:///var/run/docker.sock compose exec -T theia sh -lc '
  id
  test -S /run/user/1000/docker.sock
  curl -fsS --unix-socket /run/user/1000/docker.sock http://localhost/_ping
'
docker -H unix:///run/user/1000/docker.sock ps
```

Expect a healthy control plane, `productionRuntime: true`,
`backendIsolationReady: true`, and socket ping `OK`. Then verify login with an
invited account and open a repository. Readiness alone does not prove cloning
works. During this repair, the authenticated repository-open API returned 200
for `juancristobalgd1/startcraft_remastered`, and the project appeared in the UI.
The new-project dialog opened and local `git init` worked; no GitHub repository
was created solely for testing. Preview startup is a separate verification.
