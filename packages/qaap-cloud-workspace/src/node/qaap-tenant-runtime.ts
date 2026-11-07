// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as crypto from 'crypto';

/**
 * OCI runtime of the containers that run tenant code (worker, backend, task sandboxes).
 * - `QAAP_TENANT_RUNTIME=runc|runsc` selects it for every tenant (default `runc`).
 * - `QAAP_TENANT_RUNSC_LOGINS=alice,bob` moves those logins to gVisor while the rest stay on the global
 *   value, so it can be tried on one tenant and rolled back by removing the login.
 *
 * gVisor runs on the same rootless daemon as today, registered as a second runtime. Containers that run
 * no tenant code (ingress relay, Squid, toolchain copier) stay on runc: Squid needs Docker's embedded DNS,
 * which does not work from inside runsc (gVisor issue 7469).
 */
export type QaapTenantRuntime = 'runc' | 'runsc';

/** Docker's name for the gVisor runtime, in `daemon.json` and in `HostConfig.Runtime`. */
export const QAAP_RUNSC_RUNTIME_NAME = 'runsc';

/**
 * Host tasks a sandbox may use for each pid the same tenant would get under runc. Measured on the VPS with the
 * pinned release: about 40 tasks at rest plus 2 per guest process; 1024 carries 400 processes and dies at 500.
 * Crossing the limit kills the whole sandbox (the sentry cannot create a thread and exits with status 2)
 * instead of failing the fork, and RLIMIT_NPROC is not enforced, so the margin has to be generous.
 */
export const QAAP_RUNSC_PIDS_FACTOR = 4;

/**
 * The same for task sandboxes, which already start from a higher limit and of which a tenant can hold several. They
 * share the rootless user's task limit with every tenant, and a sandbox that cannot create a thread dies.
 */
export const QAAP_RUNSC_SANDBOX_PIDS_FACTOR = 2;

/**
 * The exact flags the daemon must run gVisor with. `--directfs=false` matters on a rootless daemon: with directfs the
 * sentry keeps the host uid that owns the Docker socket, plus capabilities; without it the sentry has an unprivileged uid
 * and no capabilities. Measured cost: npm unchanged, tsc 16% and git 35% slower. Compared as a whole rather than against a denylist: Go's flag
 * parser accepts `-flag`, `--flag value` and a later flag overriding an earlier one, so no list of bad flags is complete.
 */
export const QAAP_RUNSC_ARGS: readonly string[] = ['--platform=systrap', '--directfs=false', '--systemd-cgroup'];

/** Where `qaap-gvisor-install.sh` puts root-owned binaries. Anywhere else may be writable by the rootless user. */
/**
 * Tells a tenant backend how to give the agent uid access to its files. gVisor has no POSIX ACLs on host files (setfacl
 * fails with ENOTSUP), so a backend under runsc shares a group with the agent instead:
 * - the backend's root process is a member of the agent's group (`HostConfig.GroupAdd`), and both use umask 002;
 * - only trees meant for the agent are `setgid` with that group. Files there inherit it.
 * Anywhere else a new file keeps group 0, which the agent is not in (`setpriv --clear-groups`), so umask 002 gives it nothing.
 */
export const QAAP_TENANT_AGENT_ACCESS_ENV = 'QAAP_TENANT_AGENT_ACCESS';
export const QAAP_TENANT_AGENT_ACCESS_GROUP = 'group';
export const QAAP_TENANT_AGENT_GID = 1001;
/** Node reloads about 8 times slower under runsc, so a cold backend needs longer than the default 30 s. */
export const QAAP_RUNSC_BACKEND_READY_TIMEOUT_MS = 150_000;

const RUNSC_PATH_PATTERN = /^\/usr\/local\/lib\/qaap-gvisor\/[A-Za-z0-9][A-Za-z0-9._-]*\/runsc$/;

/**
 * The systemd slice that groups one tenant's gVisor containers, so that a limit applies to the tenant as a whole.
 * Systemd nests it under `qaap.slice`; `qaap-gvisor-install.sh` sets the task limits of both. Hex only: a `-` in the name
 * would add another level of nesting.
 */
export function qaapTenantCgroupParent(ownerLogin: string | undefined): string {
    const tenant = ownerLogin?.trim().toLowerCase() || '__anonymous__';
    return `qaap-${crypto.createHash('sha256').update(`tenant-slice\u0000${tenant}`).digest('hex').slice(0, 16)}.slice`;
}

function globalRuntime(env: NodeJS.ProcessEnv): QaapTenantRuntime {
    const raw = env.QAAP_TENANT_RUNTIME?.trim();
    if (raw === undefined || raw === '' || raw === 'runc') {
        return 'runc';
    }
    if (raw === 'runsc') {
        return 'runsc';
    }
    throw new Error(`Unsupported QAAP_TENANT_RUNTIME=${raw}: use runc (default) or runsc (gVisor).`);
}

function canaryLogins(env: NodeJS.ProcessEnv): ReadonlySet<string> {
    return new Set((env.QAAP_TENANT_RUNSC_LOGINS ?? '').split(',').map(login => login.trim().toLowerCase()).filter(Boolean));
}

/**
 * The runtime for one tenant.
 * @throws on an unsupported `QAAP_TENANT_RUNTIME`, so a typo can never fall back to the weaker runtime.
 */
export function resolveQaapTenantRuntime(ownerLogin: string | undefined, env: NodeJS.ProcessEnv = process.env): QaapTenantRuntime {
    const runtime = globalRuntime(env);
    return runtime === 'runsc' || canaryLogins(env).has(ownerLogin?.trim().toLowerCase() ?? '') ? 'runsc' : runtime;
}

/** True when any tenant may run under gVisor. */
export function isQaapRunscConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return globalRuntime(env) === 'runsc' || canaryLogins(env).size > 0;
}

/**
 * Startup validation, so a bad setting is reported at once. The backend logs a failing contribution and keeps
 * serving, so this is not what enforces the rule: each gVisor tenant fails closed when it is ensured.
 * gVisor requires the Squid egress proxy: tenants reach it by an address in `/etc/hosts`, and without it
 * they would have neither name resolution nor an egress policy.
 */
export function validateQaapTenantRuntimeEnv(env: NodeJS.ProcessEnv = process.env): void {
    if (isQaapRunscConfigured(env) && !env.QAAP_TENANT_EGRESS_PROXY_IMAGE?.trim()) {
        throw new Error('gVisor tenants require QAAP_TENANT_EGRESS_PROXY_IMAGE: embedded DNS does not work under runsc, so direct egress is not supported.');
    }
}

export interface QaapDockerRuntimeInfo {
    readonly SecurityOptions?: readonly string[] | null;
    readonly Runtimes?: Readonly<Record<string, { readonly path?: string; readonly runtimeArgs?: readonly string[] | null }>> | null;
}

/**
 * Why a daemon cannot host gVisor tenants, or undefined when it can. A runtime merely named `runsc` proves
 * nothing, so its flags and, in hosted deployments, its binary are checked too.
 * @param info the daemon's `docker info`.
 * @param hosted whether this is a hosted deployment: the daemon must be rootless and the binary the installed one.
 */
export function qaapRunscDaemonProblem(info: QaapDockerRuntimeInfo, hosted: boolean): string | undefined {
    if (hosted && !(info.SecurityOptions ?? []).some(option => /rootless/i.test(option))) {
        return 'the daemon is not rootless';
    }
    const runtime = info.Runtimes?.[QAAP_RUNSC_RUNTIME_NAME];
    if (!runtime) {
        return `no ${QAAP_RUNSC_RUNTIME_NAME} runtime is registered`;
    }
    const args = runtime.runtimeArgs ?? [];
    if (args.length !== QAAP_RUNSC_ARGS.length || args.some((arg, index) => arg !== QAAP_RUNSC_ARGS[index])) {
        return `the ${QAAP_RUNSC_RUNTIME_NAME} runtime has flags [${args.join(' ')}], expected [${QAAP_RUNSC_ARGS.join(' ')}]`;
    }
    if (hosted && !RUNSC_PATH_PATTERN.test(runtime.path ?? '')) {
        return `the ${QAAP_RUNSC_RUNTIME_NAME} runtime binary ${runtime.path ?? '(none)'} is not the installed one`;
    }
    return undefined;
}
