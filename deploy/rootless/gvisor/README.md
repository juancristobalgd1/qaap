# gVisor tenants on the rootless daemon

Containers that run tenant code (worker, backend, task sandboxes) can run under gVisor (`runsc`, systrap platform) on
the same rootless daemon as today. Relay, Squid and the toolchain copier stay on runc. Nothing changes until a login or
the whole deployment is selected.

The VPS has no `/dev/kvm`, so systrap is the only usable platform.

## Why a fork

Upstream `runsc` cannot use the systemd cgroup driver as an unprivileged user (google/gvisor#11543): it talks to the
system bus and polkit refuses, leaving `--ignore-cgroups` and no resource limits. We build
[`juancristobalgd1/gvisor`](https://github.com/juancristobalgd1/gvisor), branch `qaap-release-20261102.0-rootless`:
release `20261102.0` plus google/gvisor#13853. That PR had no upstream review when adopted, and its second commit was
ported by hand onto a later refactor. **We own this binary until the PR merges**: see "Updating".

## Settings

| Variable | Effect |
| --- | --- |
| `QAAP_TENANT_RUNSC_LOGINS=alice,bob` | These logins run under gVisor. |
| `QAAP_TENANT_RUNTIME=runsc` | Every tenant runs under gVisor. Default `runc`. |

Both require `QAAP_TENANT_EGRESS_PROXY_IMAGE`. The control plane refuses to start a gVisor tenant unless the daemon is
rootless and the runtime has exactly `--platform=systrap --directfs=false --systemd-cgroup`, from the installed binary.

The reaper enforces the selection: a container under the wrong runtime is removed and comes back under the right one
on the next request. Running turns delay this by at most `QAAP_TENANT_RUNTIME_MIGRATION_GRACE_MS` (30 minutes), since
`busy` is what the tenant's own backend reports. Past that the turn is lost.

## Install

As root on the host, with the script from this directory:

```bash
bash qaap-gvisor-install.sh install
bash qaap-gvisor-install.sh check
```

`install` reloads the daemon with SIGHUP; measured on a throwaway daemon, a live container keeps running and the new
runtime works. Binaries are root-owned under `/usr/local/lib/qaap-gvisor/<release>`. `check` also starts a sandbox and
reads its cgroup, and needs the local image `qaap-tenant-egress:current` (or `QAAP_GVISOR_SMOKE_IMAGE`).

## Canary

Staging first, then one real login:

1. Add the login to `QAAP_TENANT_RUNSC_LOGINS`, then restart the control plane with `scripts/qaap-vps-safe-restart.sh`
   (never a plain `docker compose up -d`).
2. Run a real agent task, a terminal, a preview, a push and a task sandbox.
3. From a shell in that tenant's backend, in a worker and in a task sandbox, confirm the kernel and the isolation:

   ```bash
   dmesg | head -3                                          # names gVisor
   curl -sS -m 5 --noproxy '*' http://10.0.2.2:4873/        # must fail: host loopback
   curl -sS -m 5 --noproxy '*' https://github.com/          # must fail: no direct route
   curl -sS -m 5 https://example.com/                       # must fail unless Squid allows it
   curl -sS -m 5 https://github.com/                        # must work through Squid
   cat /proc/1/environ                                      # as uid 1001: must be denied
   touch /x                                                 # must fail: read-only root
   ```

   `--noproxy` matters: without it `curl` goes to Squid, which refuses private addresses whatever the network allows.
   Production keeps slirp4netns host loopback on and relies on `qaap-tenant-loopback-guard`.
4. On the host, confirm the limits with `qaap-gvisor-install.sh check`, and that the scope of the tenant backend has the
   expected `memory.max`, `pids.max` and `cpu.max`.

On staging, `action=deploy` rewrites `/opt/qaap-staging/staging.env`, so these settings have to be added again after it.

## Rollback

Remove the login from `QAAP_TENANT_RUNSC_LOGINS` and restart the control plane; its containers come back under runc with
the same data. Once no container uses the runtime, `qaap-gvisor-install.sh remove` takes it out of the daemon.

## Known limits

Measured on the VPS (8 cores, one run each, npm and git on a bind mount, 2 CPUs):

| Workload | runc | runsc | runsc `--directfs=false` (used) |
| --- | --- | --- | --- |
| `npm install` | 34 s | 112 s | 106 s |
| `git add`, `commit`, `status` | 4.9 s | 17.9 s | 24.1 s |
| `tsc` | 2.8 s | 6.8 s | 7.9 s |

- **Filesystem-heavy work is 3 to 5 times slower.** More CPU quota does not help, nor do `--dcache` or
  `--file-access-mounts=exclusive`.
- **`--directfs=false` is deliberate.** With directfs the sentry keeps host uid 1000, which owns the Docker socket and the
  tenant data, plus capabilities. Without it the sentry has an unprivileged uid and no capabilities. The gofer stays on
  uid 1000 with capabilities and seccomp: that remains the part to escape from.
- **No POSIX ACLs on host files.** `setfacl` fails under gVisor, so the backend and the agent share group 1001 instead:
  the backend's root is a member (`GroupAdd`), both use umask 002, and only the workspace and agent storage are `setgid`.
  Files anywhere else keep group 0, which the agent is not in. `--clear-groups` on the drop is what keeps it that way.
- **Slow cold start.** Loading the backend's modules took 76 s at 1 CPU, against 9 s under runc. The ready timeout is 150 s
  under gVisor (`QAAP_TENANT_BACKEND_READY_TIMEOUT_MS`).
- **Do not use `--file-access-mounts=exclusive`.** Worker, backend and sandboxes share the tenant trees, and that flag
  assumes nothing else changes them.
- **Pids.** The limit counts host tasks: about 40 at rest plus 2 per guest process. The limit is multiplied by 4 for
  workers and backends and by 2 for task sandboxes. Crossing it kills the whole sandbox with exit status 2 instead of failing the fork, and
  `RLIMIT_NPROC` is not enforced. Backends restart on failure; a turn in flight is lost. A fork bomb stayed contained,
  with the host unaffected and nothing left behind.
- **Aggregate task limits.** Each tenant's containers share `qaap-<hash>.slice` (`TasksMax=8192`, about 4000 guest
  processes) under `qaap.slice` (`TasksMax=50000`), and the daemon stays outside it. The rootless user's own limit is
  63342. Since a sandbox that cannot create a thread dies, crossing the tenant limit costs that tenant its containers.
  About six tenants all at their ceiling could still exhaust `qaap.slice` and affect others; the daemon keeps its margin.
  `QAAP_TENANT_PIDS_LIMIT_OVERRIDES` does not raise the slice limit.
- **Small-file cost.** Creating and reading 2000 small files took 1.3 s under runc and 13.8 s here (5.8 s with directfs).
- **Memory.** `Memory` applies, plus the same amount of swap Docker adds by default, as under runc.
- **DNS.** Docker's embedded DNS does not work from runsc (google/gvisor#7469). A tenant's only internal name, its Squid
  proxy, is in `/etc/hosts` with its current address. If Squid gets a new address, tenant containers are recreated the
  next time they are ensured; until then their egress fails.
- **Direct egress is not supported** under gVisor, for the same reason.

## Updating

`.github/workflows/qaap-gvisor-upstream-watch.yml` fails weekly when the pin is more than 30 days behind upstream or the
PR has merged. Update immediately for a security fix:

1. Rebase the two commits onto the new release tag in a branch without `/` (`build.yml` filters on `branches: "*"`).
2. Let the fork's CI build `//:release`, publish the result as a release, and update `GVISOR_RELEASE`, `GVISOR_SHA512`
   and `GVISOR_URL` in `qaap-gvisor-install.sh`.
3. Run `scripts/qaap-runsc-rootless-probe.sh` on the host with `QAAP_RUNSC_TARBALL` and `QAAP_RUNSC_SHA512`. It uses a
   throwaway daemon and must end in `VERDICT: VIABLE`.
4. Install, then recreate tenants so they pick up the new binary.

Drop the fork when #13853 ships in an upstream release.
