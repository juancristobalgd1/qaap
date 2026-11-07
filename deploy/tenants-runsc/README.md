# gVisor tenant daemon (runsc) on the VPS

Status: **opt-in canary**. Nothing here runs by default. Production tenants stay on the rootless
daemon (`deploy/rootless/README.md`) until the canary checklist below passes and the operator flips
`QAAP_TENANT_RUNTIME` back and forth deliberately.

This overlay adds a **second, rootful dockerd** that runs tenant containers under gVisor (`runsc`)
as its default runtime. A socket proxy with an allowlist sits in front of it. The control plane,
Caddy, the relay, the Squid egress proxy and the toolchain images do not change.

## Architecture

```
 control plane (container, uid 100999, supplementary group qaap-tenants-client)
        |  DOCKER_HOST=unix:///run/docker-tenants-proxy/proxy.sock  (QAAP_TENANT_RUNTIME=runsc)
        v
 +-------------------------------------------+
 | docker-tenants-socket-proxy.service       |  user qaap-tenants-proxy
 |  allowlist of Engine API endpoints        |  403 on everything else
 |  canonical bodies (strict JSON, field     |  rejects logged, bodies never logged
 |  allowlist, Runtime=runsc forced, exact   |  every response: X-Qaap-Tenant-Proxy: 1
 |  per-tenant binds, Qaap ownership)        |
 +-------------------------------------------+
        |  /run/docker-tenants/docker.sock   (group qaap-tenants-backend, proxy user only)
        v
 +-------------------------------------------+
 | dockerd-tenants.service (rootful)         |  default-runtime runsc (--platform=systrap)
 |  data-root /var/lib/docker-tenants        |  bridge none, per-tenant networks
 |  containerd-namespace moby-tenants        |
 +-------------------------------------------+
        |
        v
 system containerd (/run/containerd/containerd.sock)  -> containerd-shim-runsc-v1 -> runsc sandbox

 Unchanged: rootless daemon (uid 1000, runc) for relay / Squid / toolchain; rootful docker for Caddy and control plane.
```

## What the proxy enforces

The raw daemon socket is root on the host, so the proxy is written as a canonical allowlist. A
compromised control plane must not be able to turn it into host root.

- **Strict parsing.** Bodies are parsed by a JSON parser that refuses (400) duplicate keys and keys
  that differ only in case at any depth (Go's `encoding/json` matches field names case-insensitively,
  folds `ſ`/`K` to `s`/`k`, and lets the last duplicate win). The daemon only receives
  `JSON.stringify(canonical)` with a recomputed `Content-Length`.
- **Field allowlist.** A listed field with an unexpected value, or an unlisted field with a non-empty
  value, is refused (403). Unlisted fields whose value is empty (`null`, `""`, `0`, `false`, `[]`,
  `{}`) are dropped, which leaves Docker's default; this keeps the docker CLI working.
  - `containers/create`: `Image`, `User`, `Cmd`, `Entrypoint`, `Env`, `WorkingDir`, `Labels`
    (only `com.qaap.*`, `com.qaap.managed=true` required), `ExposedPorts`, `Tty`, `OpenStdin`,
    `StdinOnce`, `Attach*`, `Healthcheck`, `NetworkingConfig` (only the `NetworkMode` network, only
    `Aliases`), and `HostConfig.{Init, Binds, Memory, NanoCpus, PidsLimit>0, SecurityOpt, CapDrop,
    CapAdd ⊆ [SETUID, SETGID], ReadonlyRootfs, Tmpfs, NetworkMode (none or a Qaap name),
    RestartPolicy (no/on-failure), AutoRemove, LogConfig (json-file), PortBindings, ConsoleSize,
    Runtime}`. The proxy always sets `Runtime: runsc`, `CapDrop: [ALL]`,
    `SecurityOpt: [no-new-privileges:true]`, a `PidsLimit` (`QAAP_TENANT_DEFAULT_PIDS_LIMIT`) and
    `NetworkMode: none` when they are missing. `PortBindings` must name a `HostIp` from
    `QAAP_TENANT_PUBLISH_HOST_IPS` (the relay's `publishHostIp`, default `127.0.0.1`).
  - Exec create: `Cmd`, `Env`, `User`, `WorkingDir`, `Tty`, `Attach*`, `Detach`, `DetachKeys`,
    `ConsoleSize`; `Privileged` must be false. `User: 0:0` stays allowed because hosted tenant
    containers run as uid 0 (`resolveQaapHostedTenantContainerUser`) and the orchestrator execs
    shells with that user; under runsc that is root inside the gVisor sandbox only.
  - `networks/create`: Qaap name, `bridge`, `Internal`, `CheckDuplicate`, labels, and only the
    `enable_icc` option (`true` only on an internal network, as the orchestrator's per-tenant
    bridge uses). No IPAM, `Attachable`, `Ingress`, `Scope` or `ConfigFrom`.
  - `volumes/create`: only the broker's `qaap-agent-toolchain-<12 hex>` volume, driver `local`,
    no `DriverOpts`. Volumes cannot be removed through the proxy.
- **Binds.** Host sources must be exactly one of the per-tenant directories under
  `QAAP_TENANT_DATA_ROOT` (`QAAP_TENANT_BIND_TEMPLATES`, default
  `workspace/repos/users/{tenant}`, `worktrees/{tenant}`, `parallel/{tenant}`,
  `auth/users/{tenant}`, `auth/users/{tenant}/theia-home`), all of one tenant per container, with
  `rw` or `ro` only. `fs.realpathSync(source)` must equal the source, which refuses a symlink in any
  component; the data root itself must therefore not be a symlink. The long `Mounts` syntax is refused.
- **Ownership.** start, stop, kill, wait, pause, unpause, rename, inspect, logs, rm, attach, exec and
  network connect, disconnect and rm only reach resources labelled `com.qaap.managed=true` (an
  upstream inspect, cached 2 s). A missing resource gets the daemon's 404.
- **Hijack.** attach and exec start send only the canonical request upstream; client bytes follow
  only after the daemon's `101`. Any other status is relayed with `Connection: close` and both
  connections are closed. Every other request uses its own upstream connection with
  `Connection: close`.
- **Targets.** Percent-encoding, dot or empty segments, `;` and duplicate query parameters are
  refused (400); `/vX.Y/` prefixes are normalised; query parameters are allowlisted per endpoint.
- **Reads.** Container inspect drops the daemon host paths (`GraphDriver`, `LogPath`,
  `ResolvConfPath`, `HostsPath`, `HostnamePath`). `Config.Env` and `HostConfig` stay: the
  orchestrator's reuse matchers compare them (backend secret, egress env, `QAAP_BUILD_SHA`, every
  hardening field). Anyone who can reach the proxy socket can therefore read tenant env secrets.
- **Identity.** Every response carries `X-Qaap-Tenant-Proxy: 1`. The orchestrator requires it on
  `/_ping`, so pointing it at the raw daemon socket fails closed.

## Files

| File | Purpose |
| --- | --- |
| `install-runsc.sh` | Installs the pinned gVisor release (sha512-verified). Does not run `runsc install`. |
| `daemon.json` | Config of the tenant dockerd. Install as `/etc/docker-tenants/daemon.json`. |
| `dockerd-tenants.service` | systemd unit for the tenant dockerd. |
| `docker-tenants.tmpfiles.conf` | Creates `/run/docker-tenants` (0750, group `qaap-tenants-backend`). |
| `docker-tenants-socket-proxy.mjs` | Allowlist proxy (Node >= 22, no npm dependencies). |
| `docker-tenants-socket-proxy.service` | systemd unit for the proxy. |
| `docker-tenants-socket-proxy.test.mjs` | `node --test` suite with a fake upstream daemon. |
| `../../scripts/qaap-runsc-benchmark.sh` | runc vs runsc benchmark on the same host. |

## daemon.json decisions (with sources)

- **Runtime and platform.** `default-runtime: runsc`, `--platform=systrap`. systrap is the default
  platform; it is written explicitly so a gVisor upgrade cannot change it silently. Source:
  gVisor "Changing Platforms" guide (systrap default, KVM not for VMs). The VPS is a Contabo KVM
  guest without nested virtualisation, so KVM is not available.
- **directfs: not set.** gVisor's Filesystem guide states directfs is enabled by default and is
  turned off only with `--directfs=false`. Repeating it would be a no-op, so it is omitted.
- **cgroup driver: `cgroupfs`.** runsc uses its own fs cgroup driver by default. The systemd
  driver is opt-in with the global runsc flag `--systemd-cgroup` and needs systemd >= 244 with
  cgroup v2. Source: gVisor "Systemd cgroup driver" page. With Docker's systemd driver, Docker
  would pass systemd-style cgroup paths to a runsc that expects fs paths. So the consistent choice
  is `native.cgroupdriver=cgroupfs`. Revisit only if the canary shows cgroup leaks.
- **`bridge: none`.** The default `docker0` bridge name is already used by the rootful daemon in the
  same host network namespace. Tenant networks are created per tenant by the orchestrator.
- **`iptables: true`, `ip-masq: true`.** Egress networks need NAT. **Open risk:** the rootful
  daemon and this daemon both manage the `DOCKER` / `DOCKER-USER` iptables chains in the host
  namespace. The canary must confirm that Caddy and the control plane keep working when this daemon
  starts, and that the Squid egress path still works.
- **containerd.** The daemon does not start its own containerd. It uses the system containerd with
  `containerd-namespace: moby-tenants` and `containerd-plugins-namespace: plugins.moby-tenants`,
  which keeps its container and task metadata apart from the rootful daemon's `moby` namespace.
  If the canary shows interference (for example containers listed by the wrong daemon), the fallback
  is a dedicated containerd with its own `--address`, `--root` and `--state`. Confirm the flag names
  with `dockerd --help` on the installed version.
- **`default-address-pools: 10.210.0.0/16, size 24`.** It must not overlap the rootless pool
  (`10.200.0.0/16` in the example of `doc/qaap-ci-invariants.md`), the rootful bridges (`172.17`,
  `172.18` ...), the host, or the VPN. Check with `ip -4 route` before starting.
- **`group: qaap-tenants-backend`.** Socket group of the raw daemon socket (and of
  `/run/docker-tenants`). Only the proxy user belongs to it. The control plane must not, or it could
  bypass the allowlist.
- **`live-restore: false`, `userland-proxy: false`, `icc: false`, `no-new-privileges: true`.** As
  requested. `icc` only affects the default bridge, which is disabled; per-network ICC is the
  `enable_icc` option the proxy pins.
- **`ip: 127.0.0.1`.** Default host address for published ports, so a binding without a HostIp
  could not land on every interface even if the proxy let it through.
- **`default-ulimits` (nofile 65536) and `default-shm-size: 64M`.** Bounds for containers that
  set nothing. PIDs are bounded by the proxy (`PidsLimit` forced). With `live-restore` false, a daemon restart stops the tenant containers. Check how the
  orchestrator handles a restart of the tenant daemon before the canary (the backend auto-resume
  path in the orchestrator is the relevant one).
- **Logs.** json-file with 10 MB x 3 rotation.

## Decisions on the systemd units

- `dockerd-tenants.service` runs as root with `Delegate=yes`, `KillMode=process` and no
  `NoNewPrivileges`, `ProtectSystem` or `PrivateNetwork`. dockerd needs them to manage namespaces,
  cgroups and iptables. The unit requires `containerd.service`.
- `docker-tenants-socket-proxy.service` runs as `qaap-tenants-proxy` with only
  `CAP_DAC_READ_SEARCH` (read-only path resolution through the 0700 tenant directories for the
  symlink check), `ProtectSystem=strict`, `RestrictAddressFamilies=AF_UNIX`,
  `SystemCallFilter=@system-service`, `MemoryMax=256M` and a UMask of 0117. It listens in its own
  `RuntimeDirectory` (`/run/docker-tenants-proxy`, 0750, group `qaap-tenants-client`).
  `/run/docker-tenants` (raw socket, exec-root, pidfile) is 0750 `root:qaap-tenants-backend`, so the
  control plane cannot traverse it. `MemoryDenyWriteExecute` is not set because Node's JIT needs
  writable executable memory.

## Installation (manual, host by host)

Run as root on the VPS. Each step can be checked before the next. Nothing here restarts the
rootful or rootless daemon.

1. **Prerequisites.** Ubuntu 24.04, kernel >= 5.6, `zstd`, Node >= 22 at `/usr/bin/node`.
   Record the AppArmor setting for the canary notes: `cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns`.
   It restricts unprivileged user namespaces. Both daemons run as root, so it is not expected to
   affect them, but this is not verified here; the canary must confirm it.
2. **Install runsc.** `sudo bash deploy/tenants-runsc/install-runsc.sh` (pinned `release-20261102.0`,
   sha512 checked). Check: `/usr/local/bin/runsc --version`.
3. **Users and groups.**
   ```sh
   sudo groupadd --system qaap-tenants-backend
   sudo groupadd --system qaap-tenants-client
   sudo useradd --system --gid qaap-tenants-client --groups qaap-tenants-backend \
       --shell /usr/sbin/nologin --no-create-home qaap-tenants-proxy
   # Add the control plane's supplementary group (qaap-tenants-client) to its container and mount only
   # /run/docker-tenants-proxy into it. Do NOT add it to qaap-tenants-backend or mount /run/docker-tenants.
   ```
4. **Data root and runtime dir.**
   ```sh
   sudo install -d -m 0750 -o root -g root /var/lib/docker-tenants
   sudo install -m 0644 deploy/tenants-runsc/docker-tenants.tmpfiles.conf /etc/tmpfiles.d/docker-tenants.conf
   sudo systemd-tmpfiles --create /etc/tmpfiles.d/docker-tenants.conf
   ```
   The tenant data (`/opt/qaap-runtime`) is not touched; see Data migration.
5. **daemon.json.** `sudo install -d /etc/docker-tenants && sudo install -m 0644 deploy/tenants-runsc/daemon.json /etc/docker-tenants/daemon.json`
   Validate the JSON: `python3 -m json.tool /etc/docker-tenants/daemon.json >/dev/null`.
6. **Start the daemon.**
   ```sh
   sudo install -m 0644 deploy/tenants-runsc/dockerd-tenants.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now dockerd-tenants.service
   sudo docker -H unix:///run/docker-tenants/docker.sock info | grep -iE 'runtime|cgroup driver|containerd'
   ```
   Expect `Default Runtime: runsc` and `runsc` listed under Runtimes.
7. **Proxy.**
   ```sh
   sudo install -d /usr/local/lib/qaap
   sudo install -m 0644 deploy/tenants-runsc/docker-tenants-socket-proxy.mjs /usr/local/lib/qaap/
   sudo install -m 0644 deploy/tenants-runsc/docker-tenants-socket-proxy.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now docker-tenants-socket-proxy.service
   ls -ld /run/docker-tenants /run/docker-tenants-proxy   # 0750 root:qaap-tenants-backend / 0750 qaap-tenants-proxy:qaap-tenants-client
   ls -l /run/docker-tenants-proxy/proxy.sock /run/docker-tenants/docker.sock   # both 0660, groups qaap-tenants-client / qaap-tenants-backend
   curl -sI --unix-socket /run/docker-tenants-proxy/proxy.sock http://d/_ping | grep -i x-qaap-tenant-proxy
   ```
8. **Smoke test.** Images can only be pulled through the proxy from the registries in
   `QAAP_TENANT_ALLOWED_REGISTRIES` (default `ghcr.io`). Pull the test images with the raw socket as
   root, then run them through the proxy:
   ```sh
   sudo docker -H unix:///run/docker-tenants/docker.sock pull busybox
   P=unix:///run/docker-tenants-proxy/proxy.sock
   docker -H $P run --rm --label com.qaap.managed=true --network none busybox dmesg
   ```
   `dmesg` must print gVisor's boot banner (for example "Starting gVisor..."), not the host kernel log.
   The proxy refuses containers without the `com.qaap.managed=true` label and networks other than
   `none` or a Qaap network. Then check the rejections, each of which must fail with a
   `qaap tenant proxy:` message:
   ```sh
   docker -H $P run --rm --label com.qaap.managed=true --network none --privileged busybox true
   docker -H $P run --rm --label com.qaap.managed=true --network none -v /:/host busybox true
   docker -H $P run --rm --label com.qaap.managed=true --network none --runtime runc busybox true
   docker -H $P run --rm --label com.qaap.managed=true --network none --cap-add SYS_ADMIN busybox true
   docker -H $P volume create -o type=none -o o=bind -o device=/ qaap-agent-toolchain-000000000000
   ```
   The docker CLI may send fields the allowlist does not know (newer API versions); a refusal names
   the field (`body.HostConfig.X is not allowed`).
9. **Orchestrator (other workstream).** Set `QAAP_TENANT_RUNTIME=runsc` (the orchestrator must
   fail closed if the daemon does not report runsc as its default runtime) and point the tenant
   Docker client at `DOCKER_HOST=unix:///run/docker-tenants-proxy/proxy.sock`. Keep the rootless socket
   for everything else.

## Data migration (later phase, not part of this canary)

Tenant data lives in `/opt/qaap-runtime` (`workspace`, `worktrees`, `parallel`, `auth`,
`theia-user`, `tenant-homes`) and is bind-mounted into tenants by path, so the same host directories
serve both daemons. Tenant images must be present in the new daemon: pull or `docker save | load`
the tenant image into `/var/lib/docker-tenants` (the same mechanism as
`scripts/qaap-vps-tenant-image.sh`, with the tenant daemon socket). Existing tenant containers keep
their old runtime until they are recreated. Migrating them is a separate maintenance window.

## Canary

Run the canary with one internal test account on a tenant created after step 9 is enabled. Each
item is checked on the tenant daemon before the next runs:

- [ ] `exec` and `attach` work (interactive Theia terminal, `docker exec -it` through the proxy).
- [ ] `/proc/net/tcp` lists only the sandbox's sockets (gVisor netstack), not host sockets.
- [ ] `setpriv --reuid=1001 --regid=1001 --clear-groups id` runs as uid 1001 inside the tenant.
- [ ] `npm install` and `pnpm install` finish on a real tenant repository (cold and warm).
- [ ] Dev server starts and HMR updates reach the browser.
- [ ] Chromium headless runs (`chromium --headless --no-sandbox --dump-dom about:blank` or the
      Playwright image) without disabling the sandbox inside the tenant.
- [ ] `git status`, `git commit`, `git push` against a test remote through the egress proxy.
- [ ] DNS for internal names works: the Squid proxy and the relay resolve by name from a tenant.
- [ ] Memory limit: a process over `Memory` is OOM-killed, the container is not left running.
- [ ] Fork bomb (`:(){ :|:& };:` in a throwaway tenant) stops at `PidsLimit`; the host and the
      other tenants stay responsive.
- [ ] Egress to a domain that is not allowed fails in the Squid allowlist, not inside gVisor.
- [ ] Restart `dockerd-tenants.service` with no tenant running: Caddy, control plane and rootless
      tenants still answer (checks the iptables risk above).
- [ ] Benchmark: `DOCKER_HOST=unix:///run/docker-tenants-proxy/proxy.sock scripts/qaap-runsc-benchmark.sh <repo>`
      (the benchmark's containers need the `com.qaap.managed=true` label to pass the proxy).
      Thresholds: install ratio <= 1.6, dev-start ratio <= 1.3 (median). Exit code 1 means fail.

## Rollback (no redeploy)

1. Set `QAAP_TENANT_RUNTIME=runc` and `DOCKER_HOST` back to the rootless socket in the control
   plane's environment, then restart the control plane with the safe script (see
   `doc/qaap-vps-deployment.md`). New tenants go back to the rootless daemon.
2. Stop the tenant daemon only when no runsc tenant is left: `sudo systemctl stop docker-tenants-socket-proxy dockerd-tenants`.
   Use `systemctl disable` to keep it from starting at boot. Do not delete `/var/lib/docker-tenants`
   until the canary evidence is archived.
3. The rootless daemon, Caddy, Squid and the relay are not touched by either step.

## Troubleshooting

- `runsc` missing from `docker info`: check `ExecStartPre` in `dockerd-tenants.service` and the
  paths in `daemon.json`. `runsc --version` must run as root.
- `DENY` lines in `journalctl -u docker-tenants-socket-proxy`: the method, path and reason are logged,
  never bodies. An unexpected denial of a legitimate control-plane call means the allowlist needs
  the endpoint or field; add it in `ROUTES` or the canonical schema with a test, do not open the
  proxy wholesale.
- `bind source ... is not an existing directory (EACCES)`: the unit lost `CAP_DAC_READ_SEARCH`.
  `... resolves through a symlink`: a component of the path is a symlink, or the data root itself is
  one (set `QAAP_TENANT_DATA_ROOT` to the resolved path).
- Proxy cannot reach the daemon: the proxy user must be in `qaap-tenants-backend`
  (`id qaap-tenants-proxy`), and `/run/docker-tenants/docker.sock` must be group `qaap-tenants-backend`.
- Tenant network creation fails with an address pool error: the `default-address-pools` range
  overlaps something on the host; see `doc/qaap-ci-invariants.md`.
