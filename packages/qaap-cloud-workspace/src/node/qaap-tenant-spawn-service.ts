// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { ChildProcess, spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapHarnessCredentialRoots } from './qaap-harness-credential-remover';
import {
    normalizeIsolationPath,
    resolveQaapParallelRoot,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveTenantHome,
    resolveTenantIsolationRoot,
    resolveUserReposRoot,
    safeUserIdSegment,
    QAAP_USER_REPOS_SEGMENT,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import {
    resolveAgentSpawnIdentity as resolveAgentSpawnIdentityFromEnv,
    buildAgentSpawnInvocation,
    evaluateAgentIsolationPolicy,
    isContainerIsolationEnabled,
    isQaapProductionRuntime,
    isTenantUidPerUserEnabled,
    resolvePerTenantSpawnIdentity,
    QaapAgentIsolationDecision,
} from './qaap-agent-spawn-identity';
import { QaapTenantUidRegistry, resolveDefaultTenantUidRegistryPath } from './qaap-tenant-uid-registry';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapTaskSandbox, QaapTaskSandboxService } from './qaap-task-sandbox';
import { QaapTenantAgentStorageEnv } from './qaap-tenant-agent-storage-env';
import { QAAP_TENANT_AGENT_ACCESS_ENV, QAAP_TENANT_AGENT_ACCESS_GROUP } from './qaap-tenant-runtime';
import { QAAP_TENANT_BACKEND_HOME, QaapTenantPersistentHome, type QaapTenantPersistentHomeAccessGrant, type QaapTenantPersistentHomeOwner } from './qaap-tenant-persistent-home';
import { findExecutableOnPath, readEnvPath, resolveTrustedExecutable, resolveTrustedSystemExecutable } from './qaap-trusted-executable';
import { childProcessEnv } from './qaap-child-process-env';

/** How the spawned process's stdio streams are wired. */
export type QaapSpawnStdio = ('pipe' | 'ignore')[];

/** Outcome of a privileged ACL command; `reason` names the concrete cause (exit status, errno, first stderr line). */
export interface QaapTenantAccessCommandResult {
    readonly ok: boolean;
    readonly reason?: string;
    /** Non-empty stderr lines of a command that exited with a status (not a spawn error or timeout). */
    readonly stderr?: readonly string[];
    /** Paths a sweep could not read but tolerated (see tolerateUnreadableSubtrees). */
    readonly skipped?: readonly string[];
}

/** How long a real tenant workspace sweep failure is replayed before the sweep runs again. */
export const TENANT_BACKEND_ACL_FAILURE_TTL_MS = 60_000;
/** `find` diagnostics for a directory the backend cannot read: only these are tolerated. */
const FIND_PERMISSION_DENIED_LINE = /^find: '(.+)': Permission denied$/;
/** Deadline of one privileged access command (setfacl, chgrp, chmod, a whole `find` sweep). */
const TENANT_ACCESS_COMMAND_TIMEOUT_MS = 120_000;
/** Stderr kept from an asynchronous access command; a longer one is a failure (its diagnostics are unknown). */
const TENANT_ACCESS_COMMAND_STDERR_LIMIT = 1024 * 1024;

export { QAAP_TENANT_BACKEND_HOME };

/** HOME/USER/LOGNAME for a tenant child plus, inside tenant containers, cache/data relocation vars. */
export type QaapTenantHomeEnvOverlay = { HOME?: string; USER?: string; LOGNAME?: string } & Record<string, string>;

/** Options for {@link QaapTenantSpawnService.spawn}. */
export interface QaapTenantSpawnOptions {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdio: QaapSpawnStdio;
    /** Process-group leader (default true) so the whole tree can be killed together. */
    readonly detached?: boolean;
}

interface QaapResourceLimits {
    readonly memoryBytes: number;
    readonly cpuCores: number;
}

interface QaapProcessInvocation {
    readonly file: string;
    readonly args: string[];
    readonly shell: boolean;
}

const DEFAULT_AGENT_MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_AGENT_CPU_LIMIT_CORES = 2;
const SYSTEMD_RUN_PROBE_TIMEOUT_MS = 3000;
/**
 * `oom_score_adj` given to every process a tenant backend spawns (agents, verification builds, dev
 * servers, terminals). The backend itself stays at 0, so when the tenant container's memory cgroup
 * fills the kernel kills one child (one turn or one preview) instead of the backend, which would take
 * the container and every in-flight turn with it. Raising the value needs no capability.
 */
const TENANT_BACKEND_CHILD_OOM_SCORE_ADJ = 500;

/**
 * Single source of truth for spawning a workspace-scoped child process under the correct OS identity
 * for multi-tenant isolation (SEC-1). Every process that runs tenant-controlled code on the shared
 * backend — the background agent, the self-verification/one-shot helpers, the preview dev server, and
 * the interactive terminal shell — MUST go through this service so it drops to the tenant's uid,
 * clears root's supplementary groups (`setpriv --clear-groups`), and provisions the tenant's OS
 * account + private HOME. Bound as a singleton so uid assignment (via the shared
 * {@link QaapTenantUidRegistry}) stays consistent across all of them: two callers must never map the
 * same login to different uids.
 *
 * Everything is a no-op — byte-identical to a non-isolated spawn — when uid-per-user is off, the
 * backend is not root, or the cwd is outside any tenant tree, so local/single-user dev is unaffected.
 */
@injectable()
export class QaapTenantSpawnService {

    @inject(QaapDockerOrchestrator)
    @optional()
    protected readonly dockerOrchestrator?: QaapDockerOrchestrator;

    protected tenantUidRegistry: QaapTenantUidRegistry | undefined;

    @inject(QaapTaskSandboxService)
    @optional()
    protected readonly taskSandbox?: QaapTaskSandboxService;
    protected agentSpawnIdentityWarned = false;
    protected agentIsolationDecision: QaapAgentIsolationDecision | undefined;
    protected agentIsolationRefusalLogged = false;
    protected tenantParentsHardened = false;
    protected setprivAvailable: boolean | undefined;
    protected setprivExecutable: string | undefined;
    protected systemdRunAvailable: boolean | undefined;
    /** Repositories whose complete working tree was repaired during this backend lifetime. */
    protected readonly ownershipPreparedRoots = new Set<string>();

    /** Whether container-per-tenant isolation is active (Docker cloud mode). */
    isContainerIsolationEnabled(): boolean {
        return isContainerIsolationEnabled(process.env);
    }

    /**
     * Whether this backend is already running inside a dedicated tenant worker. Worker containers
     * are the isolation boundary, so their configured container uid must not be treated as a host
     * uid to drop to. In rootless Docker the worker runs as container uid 0 and keeps only the
     * SETUID/SETGID capabilities, which is exactly what `setpriv` needs to drop each agent child to
     * `QAAP_AGENT_UID`. A worker that runs as a non-root uid cannot drop anything and would share its
     * uid (and `/proc/<pid>/environ`) with the agents, so hosted workers refuse that setup
     * (`QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP`).
     */
    protected isTenantBackendMode(): boolean {
        return /^(1|true)$/i.test(process.env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '');
    }

    protected readonly preparedTenantBackendAgentRoots = new Set<string>();
    /** Roots whose sweep failed for real, with the error to replay until {@link TENANT_BACKEND_ACL_FAILURE_TTL_MS}. */
    protected readonly failedTenantBackendAgentRoots = new Map<string, { error: Error; at: number }>();
    /** Recursive workspace sweeps still running, keyed by {@link aclSweepKey} (root, uid, access mode); one per key. */
    protected readonly tenantBackendAgentRootSweeps = new Map<string, Promise<void>>();
    /** Best-effort harness-state sweeps of the agent storage (never reject), keyed by {@link aclSweepKey}. */
    protected readonly tenantAgentStorageSweeps = new Map<string, Promise<void>>();

    /**
     * On a root tenant backend, start the agent access preparation of this tenant's mounted trees as soon as the
     * service exists, so the recursive sweeps (seconds on a 1-CPU tenant) usually finish before the first client
     * connects. They run as child processes; nothing here blocks the event loop beyond the direct root grants.
     */
    @postConstruct()
    protected initTenantBackendAgentAccess(): void {
        this.prewarmTenantBackendAgentAccess();
    }

    protected prewarmTenantBackendAgentAccess(): void {
        if (!this.isTenantBackendMode() || this.isContainerIsolationEnabled()) {
            return;
        }
        const login = process.env.QAAP_TENANT_LOGIN?.trim();
        try {
            this.tenantAgentStorageEnv();
            if (!login || !this.isBackendRoot()) {
                return;
            }
            const roots = [
                resolveUserReposRoot(resolveQaapReposRoot(), login),
                path.join(resolveQaapWorktreesRoot(), safeUserIdSegment(login)),
            ];
            for (const root of roots) {
                if (fs.existsSync(root)) {
                    this.prepareTenantBackendAgentAccessAsync(root).catch(error => {
                        console.warn(`[qaap-security] early agent access preparation of ${root} failed; the first agent spawn `
                            + `reports it: ${error instanceof Error ? error.message : String(error)}`);
                    });
                }
            }
        } catch (error) {
            console.warn(`[qaap-security] could not start the early agent access preparation: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Resolve the tenant segment (sanitized login) from a workspace or repo working directory. */
    resolveTenantSegment(cwd: string): string | undefined {
        const canonical = this.canonicalizeCwd(cwd);
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), canonical);
        return target?.segment;
    }

    /** Resolve the host-side directory that the tenant worker is allowed to mount. */
    resolveTenantRoot(cwd: string): string | undefined {
        const canonical = this.canonicalizeCwd(cwd);
        return resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), canonical)?.root;
    }

    /**
     * Rewrite Windows-client / mixed-separator cwds to a real absolute path on this host before
     * isolation checks, chown, and child_process/PTY spawn.
     */
    canonicalizeCwd(cwd: string): string {
        return normalizeIsolationPath(cwd);
    }

    protected getTenantUidRegistry(): QaapTenantUidRegistry {
        if (!this.tenantUidRegistry) {
            this.tenantUidRegistry = new QaapTenantUidRegistry(resolveDefaultTenantUidRegistryPath(resolveQaapReposRoot()));
        }
        return this.tenantUidRegistry;
    }

    /** Whether the backend process is root (can chown / drop privileges). Overridable in tests. */
    protected isBackendRoot(): boolean {
        return typeof process.getuid === 'function' && process.getuid() === 0;
    }

    /**
     * Whether `setpriv` (util-linux) exists in a trusted system directory — probed once. Overridable
     * in tests. The backend PATH is not consulted (see {@link resolveSetprivExecutable}).
     */
    protected isSetprivAvailable(): boolean {
        if (this.setprivAvailable === undefined) {
            this.setprivAvailable = this.resolveSetprivExecutable() !== undefined;
        }
        return this.setprivAvailable;
    }

    /**
     * Resolve `setpriv` to an absolute executable path for node-pty terminals. Theia deliberately
     * validates a requested terminal shell with `fs.accessSync`; a bare PATH command such as
     * `setpriv` fails that validation, is replaced with the default shell, and then receives the
     * setpriv argv (`--reuid`, `--regid`, ...). The fallback shell exits immediately, which used to
     * make every VPS Preview bootstrap report that its dev terminal was closed too early.
     */
    protected resolveSetprivExecutable(): string | undefined {
        // Only a root-owned, non-writable setpriv from a system directory: a PATH entry a tenant can
        // write would let tenant code replace the binary that is supposed to drop root.
        if (!this.setprivExecutable) {
            this.setprivExecutable = resolveTrustedSystemExecutable('setpriv');
        }
        return this.setprivExecutable;
    }

    /**
     * `setpriv` as launched by a root backend: always the absolute trusted path, so neither the spawn
     * env PATH nor the rlimit wrapper's `exec "$@"` can resolve it to a tenant-planted file. A
     * non-root backend cannot drop privileges anyway and keeps the plain name.
     */
    protected setprivCommand(): string {
        return this.isBackendRoot() ? this.resolveSetprivExecutable() ?? 'setpriv' : 'setpriv';
    }

    /** `systemd-run` as launched by a root backend: the absolute trusted path (see {@link setprivCommand}). */
    protected systemdRunCommand(): string {
        return this.isBackendRoot() ? resolveTrustedSystemExecutable('systemd-run') ?? 'systemd-run' : 'systemd-run';
    }

    /** Linux is the only host platform where this service can install a cgroup/rlimit boundary. */
    protected isLinuxResourceLimitPlatform(): boolean {
        return process.platform === 'linux';
    }

    /**
     * Probe the actual systemd manager, not only the systemd-run binary. A binary can be present in
     * a minimal image while no user/system manager is available to create a transient cgroup.
     * Docker tenant workers already have their own cgroup and skip this host-side probe.
     */
    protected isSystemdRunAvailable(): boolean {
        if (this.systemdRunAvailable === undefined) {
            const mode = this.isBackendRoot() ? '--system' : '--user';
            const probe = spawnSync(this.systemdRunCommand(), [
                mode,
                '--scope',
                '--quiet',
                '--wait',
                '--property=MemoryMax=64M',
                '--property=CPUQuota=100%',
                '--',
                '/bin/true',
            ], { stdio: 'ignore', timeout: SYSTEMD_RUN_PROBE_TIMEOUT_MS });
            this.systemdRunAvailable = !probe.error && probe.status === 0;
        }
        return this.systemdRunAvailable;
    }

    /** Resolve a positive byte limit from a number of bytes or a human-readable value such as 512MiB. */
    protected parseMemoryLimit(raw: string | undefined, fallback: number): number {
        const value = raw?.trim().toLowerCase();
        if (!value) {
            return fallback;
        }
        const match = /^(\d+(?:\.\d+)?)\s*(b|k|kb|ki|kib|m|mb|mi|mib|g|gb|gi|gib|t|tb|ti|tib)?$/.exec(value);
        if (!match) {
            return fallback;
        }
        const amount = Number(match[1]);
        const unit = match[2] ?? 'b';
        const multiplier = unit.startsWith('k') ? 1024
            : unit.startsWith('m') ? 1024 ** 2
                : unit.startsWith('g') ? 1024 ** 3
                    : unit.startsWith('t') ? 1024 ** 4 : 1;
        const bytes = amount * multiplier;
        return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : fallback;
    }

    /** Resolve CPU capacity as cores; a value ending in % is accepted for operator convenience. */
    protected parseCpuLimit(raw: string | undefined, fallback: number): number {
        const value = raw?.trim();
        if (!value) {
            return fallback;
        }
        const parsed = value.endsWith('%')
            ? Number.parseFloat(value.slice(0, -1)) / 100
            : Number.parseFloat(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    /**
     * Host limits are deliberately enabled by default on Linux. The tenant container path already
     * has Docker cgroups (`Memory`/`NanoCpus`) and must not be wrapped in a second manager.
     * `QAAP_AGENT_*` takes precedence; the tenant names remain compatible with Docker deployments.
     */
    protected resolveResourceLimits(): QaapResourceLimits {
        return {
            memoryBytes: this.parseMemoryLimit(
                process.env.QAAP_AGENT_MEMORY_LIMIT ?? process.env.QAAP_TENANT_MEMORY_LIMIT,
                DEFAULT_AGENT_MEMORY_LIMIT_BYTES,
            ),
            cpuCores: this.parseCpuLimit(
                process.env.QAAP_AGENT_CPU_LIMIT ?? process.env.QAAP_TENANT_CPU_LIMIT,
                DEFAULT_AGENT_CPU_LIMIT_CORES,
            ),
        };
    }

    protected shouldApplyResourceLimits(): boolean {
        // Backend-per-tenant runs inside its own Docker cgroup even though the backend itself uses
        // local spawning. Wrapping its setpriv invocation in the host's portable ulimit shell would
        // split the argv at `--reuid` and fail with "exec: --reuid: not found". The container's
        // Memory/NanoCpus/PidsLimit boundary is the resource boundary for this mode.
        const tenantBackendMode = /^(1|true)$/i.test(process.env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '');
        return this.isLinuxResourceLimitPlatform() && !this.isContainerIsolationEnabled() && !tenantBackendMode;
    }

    /**
     * Put an invocation in a cgroup. systemd-run is preferred because MemoryMax and CPUQuota cover
     * the complete descendant tree. On a non-systemd development host, rlimits are still applied so
     * a runaway process cannot grow without bounds. Production host mode fails closed rather than
     * silently launching an unbounded agent.
     */
    protected applyResourceLimits(invocation: QaapProcessInvocation, cwd: string): QaapProcessInvocation {
        if (!this.shouldApplyResourceLimits()) {
            return this.preferAsOomVictim(invocation);
        }

        const limits = this.resolveResourceLimits();
        const command = invocation.shell
            ? ['/bin/sh', '-c', invocation.file]
            : [invocation.file, ...invocation.args];
        if (this.isSystemdRunAvailable()) {
            const cpuQuota = `${Math.max(1, Math.round(limits.cpuCores * 100))}%`;
            return {
                file: this.systemdRunCommand(),
                args: [
                    this.isBackendRoot() ? '--system' : '--user',
                    '--scope',
                    '--quiet',
                    '--collect',
                    '--wait',
                    `--working-directory=${cwd}`,
                    `--property=MemoryMax=${limits.memoryBytes}`,
                    `--property=CPUQuota=${cpuQuota}`,
                    '--',
                    ...command,
                ],
                shell: false,
            };
        }

        if (isQaapProductionRuntime(process.env)) {
            throw new Error('Refusing to spawn an unbounded Linux process: systemd-run with cgroups '
                + 'is required in production host mode. Install systemd or enable Docker tenant isolation.');
        }

        const memoryKilobytes = Math.max(1, Math.floor(limits.memoryBytes / 1024));
        // POSIX /bin/sh has no ${@:3}; use a small argv-preserving script instead. The command is
        // passed as positional arguments, never interpolated into shell source. `$0` is the
        // `qaap-resource-limited` label, `$1`/`$2` are the limits and `$3…` is the command, so shift
        // exactly the two limits: `shift 3` also dropped the executable and made every wrapped
        // spawn (including every terminal shell) exec its first argument, e.g. `-l`.
        const portableFallbackScript = 'ulimit -v "$1" && ulimit -t "$2" && shift 2 && exec "$@"';
        const fallbackArgs = invocation.shell
            ? ['-c', 'ulimit -v "$1" && ulimit -t "$2" && exec /bin/sh -c "$3"',
                'qaap-resource-limited', String(memoryKilobytes), String(Math.max(1, Math.ceil(limits.cpuCores * 3600))), invocation.file]
            : ['-c', portableFallbackScript, 'qaap-resource-limited', String(memoryKilobytes),
                String(Math.max(1, Math.ceil(limits.cpuCores * 3600))), ...command];
        return { file: '/bin/sh', args: fallbackArgs, shell: false };
    }

    /**
     * Inside a backend-per-tenant container the Docker cgroup is the only memory boundary and the
     * backend shares it with everything it spawns. Run the invocation through a tiny `/bin/sh` that
     * raises its own `oom_score_adj` (inherited by setpriv, the command and all descendants) before
     * `exec`ing it unchanged. Same argv-preserving contract as the rlimit fallback: `$0` is the label
     * and `$1…` is the command, so nothing is shifted. A failed write (no /proc) is ignored.
     */
    protected preferAsOomVictim(invocation: QaapProcessInvocation): QaapProcessInvocation {
        if (!this.isLinuxResourceLimitPlatform() || !this.isTenantBackendMode()) {
            return invocation;
        }
        const raise = `{ echo ${TENANT_BACKEND_CHILD_OOM_SCORE_ADJ} > /proc/self/oom_score_adj; } 2>/dev/null`;
        const args = invocation.shell
            ? ['-c', `${raise}; exec /bin/sh -c "$1"`, 'qaap-oom-preferred', invocation.file]
            : ['-c', `${raise}; exec "$@"`, 'qaap-oom-preferred', invocation.file, ...invocation.args];
        return { file: '/bin/sh', args, shell: false };
    }

    /**
     * Fail-closed guard against the shared-container risk: throws (refusing the spawn) when the agent
     * would run as root, or under a uid shared across tenants, in a production runtime without an
     * explicit override. Call at the top of every spawn `try` block so the surrounding catch turns the
     * refusal into a failed operation instead of a privileged/leaky process. The decision is static for
     * the process lifetime, so it is evaluated once.
     */
    enforceIsolationPolicy(): void {
        if (!this.agentIsolationDecision) {
            this.agentIsolationDecision = evaluateAgentIsolationPolicy(process.env, this.isBackendRoot());
        }
        if (this.agentIsolationDecision.refuse) {
            if (!this.agentIsolationRefusalLogged) {
                this.agentIsolationRefusalLogged = true;
                console.error(`[qaap-security] ${this.agentIsolationDecision.reason}`);
            }
            throw new Error(this.agentIsolationDecision.reason);
        }
    }

    /**
     * The uid/gid to spawn a process under, given its working directory. In uid-per-user mode a cwd
     * under a tenant tree resolves to that tenant's stable uid from the registry (fail-closed: a
     * registry failure throws and the caller fails the spawn). Any other case (flag off, not root, cwd
     * outside a tenant tree) falls back to the global `QAAP_AGENT_UID` path — byte-identical to before,
     * and still never root while 1001 is set.
     */
    resolveSpawnIdentity(cwd: string): { uid?: number; gid?: number } {
        cwd = this.canonicalizeCwd(cwd);
        if (this.isTenantBackendMode()) {
            // The backend container is isolated to one login. Rootless Docker starts it as uid 0
            // inside its user namespace, where the explicit agent uid drop is required. A non-root
            // backend inherits its own identity only for local development; hosted workers set
            // QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP=1 and refuse it below.
            if (!this.isBackendRoot()) {
                if (/^(1|true)$/i.test(process.env.QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP?.trim() ?? '')) {
                    throw new Error(
                        'Refusing to spawn a tenant agent under the tenant backend\'s own uid: '
                        + 'container must run as rootless uid 0 (QAAP_TENANT_CONTAINER_UID=0).'
                    );
                }
                return {};
            }
            const identity = resolveAgentSpawnIdentityFromEnv(process.env, this.isBackendRoot());
            if (identity.uid === undefined || identity.uid === 0 || identity.warnNotRoot) {
                throw new Error('Refusing to spawn a tenant agent without a configured non-root QAAP_AGENT_UID.');
            }
            return { uid: identity.uid, ...(identity.gid !== undefined ? { gid: identity.gid } : {}) };
        }
        const isRoot = this.isBackendRoot();
        const tenant = resolvePerTenantSpawnIdentity({
            enabled: isTenantUidPerUserEnabled(process.env),
            isRoot,
            segment: resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd)?.segment,
            lookup: segment => this.getTenantUidRegistry().resolve(segment),
        });
        if (tenant) {
            return { uid: tenant.uid, gid: tenant.gid };
        }
        const identity = resolveAgentSpawnIdentityFromEnv(process.env, isRoot);
        if (identity.warnNotRoot && !this.agentSpawnIdentityWarned) {
            this.agentSpawnIdentityWarned = true;
            console.warn('[qaap-security] QAAP_AGENT_UID is set but the backend is not root — '
                + 'cannot drop agent privileges; the process will run with the backend uid.');
        }
        const spawnOptions: { uid?: number; gid?: number } = {};
        if (identity.uid !== undefined) {
            spawnOptions.uid = identity.uid;
        }
        if (identity.gid !== undefined) {
            spawnOptions.gid = identity.gid;
        }
        return spawnOptions;
    }

    /** The writable HOME for a dropped process: a per-tenant home in uid-per-user mode, else the shared one. */
    resolveTenantHome(cwd: string): string {
        cwd = this.canonicalizeCwd(cwd);
        if (isTenantUidPerUserEnabled(process.env)) {
            const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
            if (target) {
                return resolveTenantHome(target.segment);
            }
        }
        return process.env.QAAP_AGENT_HOME?.trim() || '/home/qaap-agent';
    }

    /**
     * Provision + lock everything the tenant uid needs before a process spawns under it, and give it
     * ownership of its working tree. Combines: locking the tenant root owner-only (0700), provisioning
     * an `/etc/passwd`+`/etc/group` record and a private HOME, hardening traversable parents (0711),
     * and a one-time-per-backend `chown -R` of the cwd (which the backend may have created as root).
     * Checking only the directory uid is insufficient: a legacy migration or root-owned Git
     * operation can leave an owner-correct directory containing root-owned lockfiles, making npm
     * fail with EACCES. No-op unless uid-per-user is on, the backend is root, and the cwd resolves to
     * a tenant tree. Fail closed: a registry throw (range exhausted / persistence failure) propagates
     * out and fails the spawn.
     */
    prepareTenantIsolation(cwd: string): void {
        cwd = this.canonicalizeCwd(cwd);
        this.assertTenantCwdInProduction(cwd);
        if (this.isContainerIsolationEnabled()) {
            const segment = this.resolveTenantSegment(cwd);
            const tenantRoot = this.resolveTenantRoot(cwd);
            if (!segment || !tenantRoot) {
                throw new Error(`Refusing to run a container-isolated process outside a tenant tree: "${cwd}".`);
            }
            if (!this.dockerOrchestrator || !this.dockerOrchestrator.isEnabled()) {
                throw new Error('Container isolation is enabled but the Docker orchestrator is unavailable.');
            }
            if (!this.dockerOrchestrator.isTenantContainerReady(segment, tenantRoot)) {
                throw new Error('Tenant container is not ready. Await prepareTenantIsolationAsync() before spawning.');
            }
            return;
        }
        if (this.isTenantBackendMode()) {
            this.ensureTenantBackendAgentWorkspaceAccess(cwd);
            return;
        }
        this.ensureTenantRootIsolated(cwd);
        this.ensureTenantIdentityProvisioned(cwd);
        if (!this.isBackendRoot()) {
            return;
        }
        const identity = this.resolveSpawnIdentity(cwd);
        if (identity.uid === undefined) {
            return;
        }
        const ownershipRoot = path.resolve(cwd);
        if (this.ownershipPreparedRoots.has(ownershipRoot)) {
            return;
        }
        const gid = identity.gid ?? identity.uid;
        if (this.applyTenantWorkingTreeOwnership(ownershipRoot, identity.uid, gid)) {
            this.ownershipPreparedRoots.add(ownershipRoot);
        }
    }

    /**
     * A tenant backend stays root inside its rootless user namespace so it can serve its private
     * bind mounts. Agent children still need a real uid drop. Bind-mounted workspaces are owned by
     * uid 0 in that namespace, so give only the configured agent uid an ACL on this tenant's root
     * (including default ACLs for later files) before dropping to it. The backend container mounts
     * exactly one login's tree; this never grants access to a sibling tenant.
     *
     * Synchronous callers (connection probes, model listings, bounded git/search reads, terminals, the synchronous
     * spawn helpers) never wait for the recursive sweep: they get the direct grant on the root and, while the sweep is
     * still running, proceed. Every grant only adds access for the agent uid (an ACL entry, or the shared group under
     * gVisor), so a process that starts before the sweep ends has less access, never more: isolation and fail-closed
     * checks are unchanged. Agent turns and every other asynchronous spawn go through
     * {@link prepareTenantIsolationAsync}, which awaits the sweep and fails with the same fatal error as before; a
     * recorded failure is replayed to synchronous callers too, for {@link TENANT_BACKEND_ACL_FAILURE_TTL_MS}.
     */
    protected ensureTenantBackendAgentWorkspaceAccess(cwd: string): void {
        const root = this.tenantBackendAgentRoot(cwd);
        if (root) {
            // Rejections are recorded in failedTenantBackendAgentRoots and replayed; synchronous callers do not await.
            this.tenantBackendAgentRootAccess(root, cwd).catch(() => undefined);
        }
    }

    /** {@link ensureTenantBackendAgentWorkspaceAccess} that waits until the workspace and agent storage sweeps finished. */
    protected async prepareTenantBackendAgentAccessAsync(cwd: string): Promise<void> {
        const root = this.tenantBackendAgentRoot(cwd);
        if (root) {
            await this.tenantBackendAgentRootAccess(root, cwd);
        }
        // Agent turns read their own harness state (opencode.log, .codex, ...) under the storage root right away.
        this.tenantAgentStorageEnv();
        await Promise.all([...this.tenantAgentStorageSweeps.values()]);
    }

    /**
     * Waits until a tenant backend agent may run as the dropped uid over `cwd` (workspace and harness-state sweeps
     * done); rejects with the workspace sweep error. A no-op outside a tenant backend. For asynchronous callers that
     * spawn through the synchronous wrappers (connection probes, harness CLI invocations).
     */
    async whenTenantAgentAccessReady(cwd: string): Promise<void> {
        if (this.isTenantBackendMode() && !this.isContainerIsolationEnabled()) {
            await this.prepareTenantBackendAgentAccessAsync(this.canonicalizeCwd(cwd));
        }
    }

    /** The tenant root `cwd` lives in on a root tenant backend, `undefined` when no agent grant applies. */
    protected tenantBackendAgentRoot(cwd: string): string | undefined {
        if (!this.isBackendRoot()) {
            return undefined;
        }
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
        if (!target || !fs.existsSync(target.root)) {
            throw new Error(`Refusing to spawn a tenant agent outside its mounted workspace: "${cwd}".`);
        }
        return path.resolve(target.root);
    }

    /**
     * Grants the agent uid its root (synchronously, it is one cheap `setfacl`) and returns the shared recursive sweep
     * of what the backend owns under it; the root is marked prepared when the sweep succeeds. Throws synchronously
     * for a failure it can tell right away (no agent uid, the root grant, a recorded failure still replayed).
     */
    protected tenantBackendAgentRootAccess(root: string, cwd: string): Promise<void> {
        if (this.preparedTenantBackendAgentRoots.has(root)) {
            return Promise.resolve();
        }
        // A real failure is remembered for a minute: every spawn and connection probe would otherwise repeat the
        // sweep and fail the same way.
        const failure = this.failedTenantBackendAgentRoots.get(root);
        if (failure && this.now() - failure.at < TENANT_BACKEND_ACL_FAILURE_TTL_MS) {
            throw failure.error;
        }
        let uid: number;
        let key: string;
        try {
            const resolved = this.resolveSpawnIdentity(cwd).uid;
            if (resolved === undefined) {
                throw new Error('Refusing to prepare tenant workspace access without a non-root agent uid.');
            }
            uid = resolved;
            key = this.aclSweepKey(uid, root);
            const inFlight = this.tenantBackendAgentRootSweeps.get(key);
            if (inFlight) {
                return inFlight;
            }
            const rootAcl = this.grantAgentAccess(uid, 'directory', [root]);
            if (!rootAcl.ok) {
                throw new Error(`Could not grant the non-root agent access to its tenant workspace ${root} (${rootAcl.reason}); install the acl package.`);
            }
        } catch (error) {
            throw this.recordTenantBackendAgentRootFailure(root, error);
        }
        const sweep = this.sweepTenantBackendAgentRoot(root, uid).then(
            () => {
                this.preparedTenantBackendAgentRoots.add(root);
                this.failedTenantBackendAgentRoots.delete(root);
            },
            error => {
                throw this.recordTenantBackendAgentRootFailure(root, error);
            },
        );
        const tracked: Promise<void> = sweep.finally(() => {
            if (this.tenantBackendAgentRootSweeps.get(key) === tracked) {
                this.tenantBackendAgentRootSweeps.delete(key);
            }
        });
        this.tenantBackendAgentRootSweeps.set(key, tracked);
        return tracked;
    }

    protected recordTenantBackendAgentRootFailure(root: string, error: unknown): Error {
        const cause = error instanceof Error ? error : new Error(String(error));
        this.failedTenantBackendAgentRoots.set(root, { error: cause, at: this.now() });
        return cause;
    }

    /** Sweeps what the backend owns under the tenant root in a child process; rejects with the fatal cause. */
    protected async sweepTenantBackendAgentRoot(root: string, uid: number): Promise<void> {
        const result = await this.sweepAgentAccessSinceLastSweep(uid, root);
        if (!result.ok) {
            throw new Error(`Could not prepare tenant workspace directories for agent uid ${uid} (${result.reason}); install find and acl.`);
        }
        const skipped = [...new Set(result.skipped ?? [])];
        if (skipped.length > 0) {
            // Private subtrees the agent created (0700, owned by its uid) cannot be read by the backend (no
            // CAP_DAC_READ_SEARCH). The agent reaches them itself, so they are skipped rather than blocking every agent.
            console.warn(`[qaap-security] tenant workspace sweep under ${root} skipped ${skipped.length} unreadable agent-owned path(s) `
                + `(e.g. ${skipped.slice(0, 3).join(', ')}); the readable tree is granted.`);
        }
    }

    /** Clock for the failure cache of the tenant workspace sweep; overridable in tests. */
    protected now(): number {
        return Date.now();
    }

    /** See QAAP_TENANT_AGENT_ACCESS_ENV: under gVisor the agent's access comes from a shared group rather than an ACL. */
    protected usesAgentGroupAccess(): boolean {
        return process.env[QAAP_TENANT_AGENT_ACCESS_ENV] === QAAP_TENANT_AGENT_ACCESS_GROUP;
    }

    protected agentAccessGroup(uid: number): string {
        const gid = Number.parseInt(process.env.QAAP_AGENT_GID?.trim() ?? '', 10);
        return String(Number.isInteger(gid) && gid > 0 ? gid : uid);
    }

    /**
     * Gives the agent uid access to `paths`: `directory` for read and write with later entries included, `file` for read
     * and write, `traverse` to pass through a directory it cannot list. `chgrp -h` never follows a link: the agent can
     * replace entries in the directories it writes to, and a followed link could put a backend file in the agent's group.
     */
    protected grantAgentAccess(uid: number, access: 'directory' | 'file' | 'traverse', paths: readonly string[]): QaapTenantAccessCommandResult {
        if (this.usesAgentGroupAccess()) {
            const group = this.runTenantAccessCommand('chgrp', ['-h', this.agentAccessGroup(uid), ...paths]);
            if (!group.ok) {
                return group;
            }
            const mode = access === 'directory' ? 'g+rwxs' : access === 'file' ? 'g+rw' : 'g=x';
            return this.runTenantAccessCommand('chmod', [mode, ...paths]);
        }
        const spec = access === 'directory' ? `u:${uid}:rwx,d:u:${uid}:rwx` : access === 'file' ? `u:${uid}:rw` : `u:${uid}:--x`;
        return this.runTenantAccessCommand('setfacl', ['-m', spec, ...paths]);
    }

    /** Grants the agent uid access to what the backend already created under `dir`: directories (`d`) or files (`f`). */
    protected sweepAgentAccess(uid: number, type: 'd' | 'f', dir: string, changedSince?: string): QaapTenantAccessCommandResult {
        const select = [dir, '-xdev', '-uid', '0', '-type', type, ...(changedSince ? ['-cnewer', changedSince] : [])];
        if (this.usesAgentGroupAccess()) {
            return this.tolerateUnreadableSubtrees(this.runTenantAccessCommand('find', [...select,
                '-exec', 'chgrp', '-h', this.agentAccessGroup(uid), '{}', '+',
                '-exec', 'chmod', type === 'd' ? 'g+rwxs' : 'g+rwX', '{}', '+',
            ]));
        }
        return this.tolerateUnreadableSubtrees(this.runTenantAccessCommand('find', [...select, '-exec', 'setfacl', '-m', type === 'd' ? `u:${uid}:rwx,d:u:${uid}:rwx` : `u:${uid}:rwX`, '{}', '+']));
    }

    /**
     * Sweeps directories and files under `dir`, but only the entries whose status changed since the last complete
     * sweep of `dir` for this uid and access mode. Every sweep re-ran `find -exec setfacl` over the whole tree:
     * ~63,000 entries (8-11 s of synchronous event-loop time) on each tenant cold start on staging (24 Nov 2026).
     * An entry the backend created, renamed or re-moded since then has a newer ctime (user space cannot set it);
     * the entries left out already received their grant. The stamp takes the time the sweep ended (`setfacl` bumps
     * the ctime of what it touched) and is written only after a complete successful sweep; an entry created during
     * the sweep inherits the parent's default ACL. The walk runs in a child process (`find`), never on the event loop.
     */
    protected async sweepAgentAccessSinceLastSweep(uid: number, dir: string): Promise<QaapTenantAccessCommandResult> {
        const stamp = this.aclSweepStampPath(uid, dir);
        const changedSince = stamp && fs.existsSync(stamp) ? stamp : undefined;
        // One walk grants directories and files: the walk itself is the cost once few entries changed (~63,000
        // stats per cold start on staging, twice), so two passes doubled it.
        const result = await this.sweepAgentAccessBothTypes(uid, dir, changedSince);
        if (stamp && result.ok) {
            this.writeAclSweepStamp(stamp);
        }
        return result;
    }

    /** Identity of a sweep: the same root, uid and access mode share one sweep and one stamp. */
    protected aclSweepKey(uid: number, dir: string): string {
        const mode = this.usesAgentGroupAccess() ? `group-${this.agentAccessGroup(uid)}` : 'acl';
        return `${path.resolve(dir)}\0${uid}\0${mode}`;
    }

    /** Stamp of the last complete sweep of `dir` for `uid` in the current access mode, or `undefined` when stamps are off. */
    protected aclSweepStampPath(uid: number, dir: string): string | undefined {
        const directory = this.aclSweepStampDirectory();
        if (!directory) {
            return undefined;
        }
        const id = createHash('sha256').update(this.aclSweepKey(uid, dir)).digest('hex').slice(0, 32);
        return path.join(directory, `${id}.stamp`);
    }

    /**
     * Where sweep stamps live: `QAAP_ACL_SWEEP_STAMP_DIR` (`off` disables them), else the backend's own persistent
     * `~/.qaap` on a per-tenant backend, so a container restart does not sweep everything again. Off elsewhere.
     */
    protected aclSweepStampDirectory(): string | undefined {
        const configured = process.env.QAAP_ACL_SWEEP_STAMP_DIR?.trim();
        if (configured) {
            return configured === 'off' ? undefined : configured;
        }
        return /^(1|true)$/i.test(process.env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '')
            ? path.join(os.homedir(), '.qaap', 'acl-sweep-stamps')
            : undefined;
    }

    /** Best effort: without a stamp the next sweep is a full one, which is only slower. */
    protected writeAclSweepStamp(stamp: string): void {
        try {
            fs.mkdirSync(path.dirname(stamp), { recursive: true, mode: 0o700 });
            const now = new Date();
            fs.writeFileSync(stamp, `${now.toISOString()}\n`, { mode: 0o600 });
            fs.utimesSync(stamp, now, now);
        } catch (error) {
            console.warn(`[qaap-security] could not record the agent access sweep of ${stamp}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** {@link sweepAgentAccess} for directories and files in a single `find` walk, run asynchronously. */
    protected async sweepAgentAccessBothTypes(uid: number, dir: string, changedSince?: string): Promise<QaapTenantAccessCommandResult> {
        const select = [dir, '-xdev', '-uid', '0', ...(changedSince ? ['-cnewer', changedSince] : [])];
        const branch = (type: 'd' | 'f', actions: readonly string[]): string[] => ['(', '-type', type, ...actions, ')'];
        // Group the `-o` branches so `-xdev`, `-uid 0` and `-cnewer` apply to both directories and files.
        // In POSIX/GNU `find`, implicit `-a` binds tighter than `-o`, so an ungrouped `-o` dropped `-uid 0`
        // (and `-cnewer`) on the file branch and ran `setfacl`/`chgrp` on every agent-owned file.
        const both = (dirActions: readonly string[], fileActions: readonly string[]): string[] => [
            '(',
            ...branch('d', dirActions),
            '-o',
            ...branch('f', fileActions),
            ')',
        ];
        if (this.usesAgentGroupAccess()) {
            const group = this.agentAccessGroup(uid);
            return this.tolerateUnreadableSubtrees(await this.runTenantAccessCommandAsync('find', [
                ...select,
                ...both(
                    ['-exec', 'chgrp', '-h', group, '{}', '+', '-exec', 'chmod', 'g+rwxs', '{}', '+'],
                    ['-exec', 'chgrp', '-h', group, '{}', '+', '-exec', 'chmod', 'g+rwX', '{}', '+'],
                ),
            ]));
        }
        return this.tolerateUnreadableSubtrees(await this.runTenantAccessCommandAsync('find', [
            ...select,
            ...both(
                ['-exec', 'setfacl', '-m', `u:${uid}:rwx,d:u:${uid}:rwx`, '{}', '+'],
                ['-exec', 'setfacl', '-m', `u:${uid}:rwX`, '{}', '+'],
            ),
        ]));
    }

    /**
     * A `find` that failed only because it could not read some directory (`Permission denied`) is not a failure:
     * those subtrees belong to the agent, which reaches them itself. Any other diagnostic, a spawn error or a timeout
     * stays fatal. Only the `find:` diagnostics count, so a failed `setfacl` on a readable path still fails the sweep.
     */
    protected tolerateUnreadableSubtrees(result: QaapTenantAccessCommandResult): QaapTenantAccessCommandResult {
        if (result.ok || !result.stderr || result.stderr.length === 0) {
            return result;
        }
        const skipped: string[] = [];
        for (const line of result.stderr) {
            const match = FIND_PERMISSION_DENIED_LINE.exec(line);
            if (!match) {
                return result;
            }
            skipped.push(match[1]);
        }
        return { ok: true, skipped };
    }

    protected runTenantAccessCommand(file: string, args: readonly string[]): QaapTenantAccessCommandResult {
        const result = spawnSync(file, [...args], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: TENANT_ACCESS_COMMAND_TIMEOUT_MS });
        return this.tenantAccessCommandResult(file, result.error, result.status ?? undefined, result.signal ?? undefined, result.stderr ?? '');
    }

    /**
     * {@link runTenantAccessCommand} in a child process the event loop does not wait for: for the recursive sweeps,
     * which take seconds on a large tree. Same deadline and the same result shape; a stderr longer than
     * {@link TENANT_ACCESS_COMMAND_STDERR_LIMIT} is reported without its lines, so it can never pass as tolerated.
     */
    protected runTenantAccessCommandAsync(file: string, args: readonly string[]): Promise<QaapTenantAccessCommandResult> {
        return new Promise(resolve => {
            let stderr = '';
            let truncated = false;
            let settled = false;
            let timer: NodeJS.Timeout | undefined;
            const finish = (result: QaapTenantAccessCommandResult): void => {
                if (!settled) {
                    settled = true;
                    if (timer) {
                        clearTimeout(timer);
                    }
                    resolve(result);
                }
            };
            let child: ChildProcess;
            try {
                child = spawn(file, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
            } catch (error) {
                finish(this.tenantAccessCommandResult(file, error instanceof Error ? error : new Error(String(error)), undefined, undefined, ''));
                return;
            }
            child.stderr?.setEncoding('utf8');
            child.stderr?.on('data', (chunk: string) => {
                if (stderr.length + chunk.length > TENANT_ACCESS_COMMAND_STDERR_LIMIT) {
                    truncated = true;
                    return;
                }
                stderr += chunk;
            });
            timer = setTimeout(() => {
                child.kill('SIGKILL');
                const timeout: NodeJS.ErrnoException = new Error('timed out');
                timeout.code = 'ETIMEDOUT';
                finish(this.tenantAccessCommandResult(file, timeout, undefined, undefined, stderr));
            }, TENANT_ACCESS_COMMAND_TIMEOUT_MS);
            timer.unref?.();
            child.on('error', error => finish(this.tenantAccessCommandResult(file, error, undefined, undefined, stderr)));
            child.on('close', (status, signal) => {
                const result = this.tenantAccessCommandResult(file, undefined, status ?? undefined, signal ?? undefined, stderr);
                const reason = `${result.reason} (stderr over ${TENANT_ACCESS_COMMAND_STDERR_LIMIT} bytes)`;
                finish(truncated && !result.ok ? { ok: false, reason } : result);
            });
        });
    }

    protected tenantAccessCommandResult(
        file: string,
        error: Error | undefined,
        status: number | undefined,
        signal: NodeJS.Signals | undefined,
        stderr: string,
    ): QaapTenantAccessCommandResult {
        if (!error && status === 0) {
            return { ok: true };
        }
        const cause = error
            ? (error as NodeJS.ErrnoException).code ?? error.message
            : `exit status ${status ?? signal ?? 'unknown'}`;
        const stderrLines = stderr.split('\n').map(line => line.trim()).filter(Boolean);
        const firstStderrLine = stderrLines[0];
        const exited = !error && typeof status === 'number';
        return {
            ok: false,
            reason: `${file} ${cause}${firstStderrLine ? `: ${firstStderrLine}` : ''}`,
            ...(exited ? { stderr: stderrLines } : {}),
        };
    }

    /**
     * Async lifecycle gate for Docker mode. Every asynchronous process owner must await this before
     * calling the synchronous child-process APIs. A rejected Docker create/inspect is propagated;
     * there is intentionally no best-effort prewarm and no fallback to the backend host.
     */
    async prepareTenantIsolationAsync(cwd: string): Promise<void> {
        cwd = this.canonicalizeCwd(cwd);
        this.assertTenantCwdInProduction(cwd);
        if (!this.isContainerIsolationEnabled()) {
            if (this.isTenantBackendMode()) {
                // The agent spawn waits for the recursive sweep here instead of walking the tree on the event loop.
                await this.prepareTenantBackendAgentAccessAsync(cwd);
                return;
            }
            this.prepareTenantIsolation(cwd);
            return;
        }
        const segment = this.resolveTenantSegment(cwd);
        const tenantRoot = this.resolveTenantRoot(cwd);
        if (!segment || !tenantRoot) {
            throw new Error(`Refusing to run a container-isolated process outside a tenant tree: "${cwd}".`);
        }
        if (!this.dockerOrchestrator || !this.dockerOrchestrator.isEnabled()) {
            throw new Error('Container isolation is enabled but the Docker orchestrator is unavailable.');
        }
        await this.dockerOrchestrator.ensureTenantContainer(segment, tenantRoot);
    }

    /** Recursive ownership repair seam, kept separate so the once-per-backend behavior is testable. */
    protected applyTenantWorkingTreeOwnership(cwd: string, uid: number, gid: number): boolean {
        if (!fs.existsSync(cwd)) {
            return false; // cwd missing — let the spawn surface the real error
        }
        const result = spawnSync('chown', ['-R', `${uid}:${gid}`, cwd], { stdio: 'ignore' });
        if (result.status !== 0) {
            console.warn(`[qaap-security] could not chown cwd ${cwd} to ${uid}:${gid} `
                + `(exit ${result.status ?? 'signal'}); the process may not be able to write.`);
            return false;
        }
        return true;
    }

    /**
     * Spawn a shell command under the identity resolved for its cwd. When a uid drop applies and
     * `setpriv` is available, the command is wrapped in `setpriv --reuid U --regid G --clear-groups --
     * /bin/sh -c <command>` so the child also loses root's supplementary groups (Node's `{ uid, gid }`
     * drop never calls `setgroups`). Otherwise falls back to a plain `shell: true` spawn with the
     * Node-level drop — byte-identical to a non-isolated spawn.
     *
     * In container isolation mode (QAAP_CLOUD_MODE=docker), delegates execution to `docker exec`
     * inside the tenant's dedicated worker container.
     *
     * NOTE: callers should invoke {@link enforceIsolationPolicy} and {@link prepareTenantIsolation}
     * first (see {@link spawnPrepared}).
     */
    spawn(command: string, options: QaapTenantSpawnOptions): ChildProcess {
        const cwd = this.canonicalizeCwd(options.cwd);
        const sandbox = this.taskSandboxFor(cwd);
        if (sandbox) {
            return this.taskSandbox!.spawnInSandbox(sandbox, '/bin/sh', ['-c', command], { ...options, cwd },
                (file, args, launchOptions) => this.launchProcess(file, args, launchOptions));
        }
        if (this.isContainerIsolationEnabled()) {
            const segment = this.resolveTenantSegment(cwd);
            const tenantRoot = this.resolveTenantRoot(cwd);
            if (!segment || !tenantRoot || !this.dockerOrchestrator || !this.dockerOrchestrator.isTenantContainerReady(segment, tenantRoot)) {
                throw new Error('Refusing to spawn: the validated tenant container has not been prepared.');
            }
            const wrapped = this.dockerOrchestrator.wrapShellForTenantContainer(segment, cwd, '/bin/bash', ['-c', command], tenantRoot, options.env);
            return this.launchProcess(wrapped.file, wrapped.args, {
                cwd,
                detached: options.detached ?? process.platform !== 'win32',
                env: options.env,
                stdio: options.stdio,
            });
        }
        const identity = this.resolveSpawnIdentity(cwd);
        this.assertDropIsComplete(identity);
        const invocation = buildAgentSpawnInvocation(command, identity, this.isSetprivAvailable(), this.setprivCommand());
        const limitedInvocation = this.applyResourceLimits({
            file: invocation.file,
            args: invocation.args ? [...invocation.args] : [],
            shell: invocation.options.shell,
        }, cwd);
        return this.launchProcess(limitedInvocation.file, limitedInvocation.args, {
            cwd,
            // Detached cmd.exe can exit successfully without delivering npm output on Windows.
            // Unix still needs a process group for cancellation and descendant cleanup.
            detached: options.detached ?? process.platform !== 'win32',
            env: options.env,
            stdio: options.stdio,
            shell: limitedInvocation.shell,
        });
    }

    /**
     * @internal The task sandbox a harness started at `cwd` runs in, if any. Used by the agent runner to
     * pick the address its gate and helper URLs must use (see `resolveAgentReachableOrigin`).
     */
    agentSandboxFor(cwd: string): QaapTaskSandbox | undefined {
        return this.taskSandboxFor(cwd);
    }

    /**
     * The live per-task sandbox (QAAP_TASK_SANDBOX, doc/qaap-task-sandbox.md) that owns `cwd`, if any:
     * direct mode, or broker mode inside a per-tenant backend. A control plane in container-per-tenant
     * mode (QAAP_CLOUD_MODE=docker) keeps the tenant worker as the boundary.
     */
    protected taskSandboxFor(cwd: string): QaapTaskSandbox | undefined {
        if (!this.taskSandbox?.isEnabled() || this.isContainerIsolationEnabled()) {
            return undefined;
        }
        return this.taskSandbox.sandboxFor(cwd);
    }

    /** The single `child_process.spawn` seam — overridable in tests to capture argv without executing. */
    protected launchProcess(file: string, args: string[], options: object): ChildProcess {
        // Chokepoint: whatever env a caller passes (or omits, which would inherit everything), the child never
        // receives backend-only secrets, so a future caller cannot leak them by omission.
        const requested = options as NonNullable<Parameters<typeof spawn>[2]>;
        const spawnOptions = { ...requested, env: childProcessEnv(requested.env ?? process.env) } as Parameters<typeof spawn>[2];
        return spawn(this.resolveLaunchFile(file, spawnOptions as { env?: NodeJS.ProcessEnv; shell?: boolean | string }), args, spawnOptions);
    }

    /**
     * A root backend resolves a bare executable name (`docker`, `git`, …) only from PATH entries root
     * trusts. A name found solely in a tenant-writable entry is refused rather than executed as root;
     * a name found nowhere is passed through so spawn reports ENOENT as before.
     */
    protected resolveLaunchFile(file: string, options: { env?: NodeJS.ProcessEnv; shell?: boolean | string }): string {
        if (!this.isBackendRoot() || options.shell || path.isAbsolute(file) || file.includes('/')) {
            return file;
        }
        const env = options.env ?? process.env;
        const trusted = resolveTrustedExecutable(file, env, 0);
        if (trusted) {
            return trusted;
        }
        if (findExecutableOnPath(file, readEnvPath(env))) {
            throw new Error(`Refusing to run "${file}" as root from a PATH entry that root does not own.`);
        }
        return file;
    }

    /**
     * B (fail-closed on a non-tenant cwd): in a production runtime with uid-per-user ON, refuse to run
     * a tenant-code process whose cwd does NOT resolve to a tenant tree — otherwise it would silently
     * fall back to the SHARED `QAAP_AGENT_UID` (1001), reopening cross-tenant read/write between any
     * repos that stayed 1001-owned (e.g. legacy clones outside `{reposRoot}/users/...`). Every real
     * spawn goes through {@link prepareTenantIsolation}, so this is the one chokepoint. No-op outside
     * production, when not root, or when uid-per-user is off (the shared-uid single-user box opts out
     * via the isolation policy, not here).
     */
    protected assertTenantCwdInProduction(cwd: string): void {
        if (!this.isBackendRoot() || !isTenantUidPerUserEnabled(process.env) || !isQaapProductionRuntime(process.env)) {
            return;
        }
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
        if (!target) {
            throw new Error('Refusing to run a workspace process outside a tenant tree while uid-per-user '
                + `isolation is on: "${cwd}" does not resolve to {reposRoot}/users/<login>/... or a tenant `
                + 'worktree, so it would fall back to the shared uid. Normalize the path to the tenant\'s '
                + 'canonical repo before spawning (see resolveTenantIsolationRoot).');
        }
    }

    /**
     * A (fail-closed on an incomplete drop): when a uid drop is required but `setpriv` is unavailable,
     * the Node `{ uid, gid }` fallback cannot clear root's supplementary groups. Refuse rather than run
     * a tenant process that keeps them. Consistent across agent / preview / deploy / terminal.
     */
    protected assertDropIsComplete(identity: { uid?: number }): void {
        if (identity.uid !== undefined && !this.isSetprivAvailable()) {
            throw new Error('Refusing to spawn a tenant process with an incomplete privilege drop: setpriv '
                + '(util-linux) is required to clear root\'s supplementary groups but was not found on PATH. '
                + 'Install util-linux in the backend image.');
        }
    }

    /**
     * Full isolated spawn: enforce the fail-closed policy, provision + own the tenant tree, then spawn
     * under the tenant identity. Use this from callers that own the whole lifecycle (e.g. the preview
     * dev server and the terminal shell). The agent runner drives the three steps itself so it can
     * interleave latency marks and its own env/HOME wiring.
     */
    spawnPrepared(command: string, options: QaapTenantSpawnOptions): ChildProcess {
        const cwd = this.canonicalizeCwd(options.cwd);
        this.enforceIsolationPolicy();
        this.prepareTenantIsolation(cwd);
        return this.spawn(command, { ...options, cwd });
    }

    /** Async variant used by request/task lifecycles that can wait for Docker provisioning. */
    async spawnPreparedAsync(command: string, options: QaapTenantSpawnOptions): Promise<ChildProcess> {
        const cwd = this.canonicalizeCwd(options.cwd);
        this.enforceIsolationPolicy();
        await this.prepareTenantIsolationAsync(cwd);
        return this.spawn(command, { ...options, cwd });
    }

    /**
     * Argv-form isolated spawn (no shell): enforce the policy, provision + own the tenant tree, then
     * spawn `file args...` under the tenant identity. When a uid drop applies and `setpriv` exists the
     * argv is prefixed with `setpriv --reuid U --regid G --clear-groups --` (still no shell — the dev
     * command's own args are passed through verbatim, no re-quoting). Falls back to the Node `{uid,gid}`
     * drop when `setpriv` is absent. Use for callers that already have a file+args pair (e.g. the
     * preview dev server `npm run dev`). {@link resolveProcessEnv} adds the tenant HOME/USER.
     */
    spawnArgvPrepared(
        file: string,
        args: readonly string[],
        options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: QaapSpawnStdio; detached?: boolean },
    ): ChildProcess {
        const cwd = this.canonicalizeCwd(options.cwd);
        this.enforceIsolationPolicy();
        this.prepareTenantIsolation(cwd);
        if (!this.isContainerIsolationEnabled()) {
            args = this.withDroppedGitTrust(cwd, file, args);
        }
        const spawnOptions: { cwd: string; env: NodeJS.ProcessEnv; stdio: QaapSpawnStdio; detached: boolean } = {
            cwd,
            env: options.env,
            stdio: options.stdio ?? ['pipe', 'pipe', 'pipe'],
            detached: options.detached ?? false,
        };
        const sandbox = this.taskSandboxFor(cwd);
        if (sandbox) {
            return this.taskSandbox!.spawnInSandbox(sandbox, file, args, spawnOptions,
                (launchFile, launchArgs, launchOptions) => this.launchProcess(launchFile, launchArgs, launchOptions));
        }
        if (this.isContainerIsolationEnabled()) {
            const segment = this.resolveTenantSegment(cwd);
            const tenantRoot = this.resolveTenantRoot(cwd);
            if (!segment || !tenantRoot || !this.dockerOrchestrator || !this.dockerOrchestrator.isTenantContainerReady(segment, tenantRoot)) {
                throw new Error('Refusing to spawn: the validated tenant container has not been prepared.');
            }
            const wrapped = this.dockerOrchestrator.wrapShellForTenantContainer(segment, cwd, file, args, tenantRoot, options.env);
            return this.launchProcess(wrapped.file, wrapped.args, spawnOptions);
        }
        const identity = this.resolveSpawnIdentity(cwd);
        this.assertDropIsComplete(identity);
        const invocation = identity.uid === undefined
            ? { file, args: [...args], shell: false }
            : {
                file: this.setprivCommand(),
                args: ['--reuid', String(identity.uid), '--regid', String(identity.gid ?? identity.uid), '--clear-groups', '--', file, ...args],
                shell: false,
            };
        const limitedInvocation = this.applyResourceLimits(invocation, cwd);
        return this.launchProcess(limitedInvocation.file, limitedInvocation.args, {
            ...spawnOptions,
            shell: limitedInvocation.shell,
        });
    }

    /** Async variant that makes Docker create/inspect part of the spawn lifecycle. */
    async spawnArgvPreparedAsync(
        file: string,
        args: readonly string[],
        options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: QaapSpawnStdio; detached?: boolean },
    ): Promise<ChildProcess> {
        const cwd = this.canonicalizeCwd(options.cwd);
        this.enforceIsolationPolicy();
        await this.prepareTenantIsolationAsync(cwd);
        return this.spawnArgvPrepared(file, args, { ...options, cwd });
    }

    /**
     * Return the validated argv wrapper without launching it. Synchronous read-only helpers such as
     * repository search/fingerprinting use this seam so they cannot accidentally execute against the
     * host filesystem in Docker mode. The caller must still collect output with strict bounds.
     */
    wrapArgvForTenant(cwd: string, file: string, args: readonly string[]): { file: string; args: string[] } {
        cwd = this.canonicalizeCwd(cwd);
        this.enforceIsolationPolicy();
        this.prepareTenantIsolation(cwd);
        if (this.isContainerIsolationEnabled()) {
            const segment = this.resolveTenantSegment(cwd);
            const tenantRoot = this.resolveTenantRoot(cwd);
            if (!segment || !tenantRoot || !this.dockerOrchestrator || !this.dockerOrchestrator.isTenantContainerReady(segment, tenantRoot)) {
                throw new Error('Refusing to wrap a process without a validated tenant container.');
            }
            return this.dockerOrchestrator.wrapShellForTenantContainer(segment, cwd, file, args, tenantRoot);
        }
        const identity = this.resolveSpawnIdentity(cwd);
        this.assertDropIsComplete(identity);
        if (identity.uid === undefined) {
            const limitedInvocation = this.applyResourceLimits({ file, args: [...args], shell: false }, cwd);
            return { file: limitedInvocation.file, args: limitedInvocation.args };
        }
        const gid = identity.gid ?? identity.uid;
        const limitedInvocation = this.applyResourceLimits({
            file: this.setprivCommand(),
            args: ['--reuid', String(identity.uid), '--regid', String(gid), '--clear-groups', '--', file, ...args],
            shell: false,
        }, cwd);
        return { file: limitedInvocation.file, args: limitedInvocation.args };
    }

    /**
     * The tenant HOME/USER/LOGNAME overlay for a dropped process, or `{}` when no uid drop applies.
     * Without a writable HOME a dropped process inherits root's `/root`, which it cannot write.
     */
    tenantHomeEnvOverlay(cwd: string): QaapTenantHomeEnvOverlay {
        cwd = this.canonicalizeCwd(cwd);
        if (this.isTenantBackendMode()) {
            // The tenant image has a read-only rootfs. /tmp is a private per-container tmpfs, so
            // keep agent CLI configuration writable there while caches/data use the tenant mount.
            const user = this.isBackendRoot() ? 'qaap-agent' : 'theia';
            const storageEnv = this.tenantAgentStorageEnv();
            this.ensurePersistentTenantBackendHome(QAAP_TENANT_BACKEND_HOME);
            return { HOME: QAAP_TENANT_BACKEND_HOME, USER: user, LOGNAME: user, ...storageEnv };
        }
        if (this.isContainerIsolationEnabled()) {
            // The host-side per-uid HOME is not mounted into a tenant worker. Passing it through
            // docker exec would make the child point at a nonexistent/shared host path and could
            // accidentally bypass the worker's private HOME. The orchestrator seeds this HOME
            // when it creates the container; exec must keep using the same worker-local value. A
            // backend running inside that worker uses the same rule even though its own
            // QAAP_CLOUD_MODE is local and it therefore does not enable host-side Docker routing.
            const home = process.env.QAAP_TENANT_CONTAINER_HOME?.trim() || '/tmp/qaap-home';
            return { HOME: home, USER: 'qaap-tenant', LOGNAME: 'qaap-tenant', ...this.tenantAgentStorageEnv() };
        }
        if (this.resolveSpawnIdentity(cwd).uid === undefined) {
            return {};
        }
        const overlay: QaapTenantHomeEnvOverlay = { HOME: this.resolveTenantHome(cwd) };
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
        if (target) {
            overlay.USER = `qaap-t-${target.segment}`;
            overlay.LOGNAME = overlay.USER;
        }
        return overlay;
    }

    /**
     * Resolves the filesystem roots and environment where this tenant's harness credential files
     * live. Returns `undefined` when worker container isolation is enabled (credentials live inside
     * the remote worker container, not on this process's filesystem).
     */
    resolveHarnessCredentialRoots(cwd: string): QaapHarnessCredentialRoots | undefined {
        if (this.isContainerIsolationEnabled()) {
            return undefined;
        }
        const overlay = this.tenantHomeEnvOverlay(cwd);
        const env: NodeJS.ProcessEnv = { ...process.env, ...overlay };
        if (this.isTenantBackendMode()) {
            const storageRoot = QaapTenantAgentStorageEnv.resolveRoot(
                process.env,
                QaapTenantAgentStorageEnv.defaultTenantBackendRoot(process.env),
            );
            const extraRoots = storageRoot
                ? [QaapTenantAgentStorageEnv.homeDir(storageRoot), QaapTenantAgentStorageEnv.dataDir(storageRoot)]
                : [];
            return {
                home: overlay.HOME ?? QAAP_TENANT_BACKEND_HOME,
                extraRoots,
                env,
            };
        }
        return {
            home: overlay.HOME ?? os.homedir(),
            extraRoots: [],
            env,
        };
    }

    /**
     * Cache/data locations for processes inside a tenant container, whose HOME is on the
     * memory-backed `/tmp` tmpfs (read-only rootfs). A backend running inside the tenant container
     * relocates them to its disk-backed, tenant-private config mount by default; host-side worker
     * routing (`docker exec` into a `qaap-ws-*` worker) has no such mount and only relocates when
     * `QAAP_TENANT_AGENT_STORAGE_ROOT` names an in-container path. HOME (agent config/credentials)
     * deliberately stays on the tmpfs.
     */
    protected tenantAgentStorageEnv(): Record<string, string> {
        const fallback = this.isTenantBackendMode() ? QaapTenantAgentStorageEnv.defaultTenantBackendRoot(process.env) : undefined;
        const root = QaapTenantAgentStorageEnv.resolveRoot(process.env, fallback);
        if (!root) {
            return {};
        }
        if (this.isTenantBackendMode()) {
            this.ensureTenantAgentStorage(root);
        }
        return QaapTenantAgentStorageEnv.build(root);
    }

    protected readonly preparedAgentStorageRoots = new Set<string>();
    /** Roots whose preparation was attempted in this process, successful or not (see ensureTenantAgentStorage). */
    protected readonly attemptedAgentStorageRoots = new Set<string>();
    protected readonly persistentTenantHomes = new Set<string>();

    /**
     * Link the CLI credential entries of the tmpfs HOME to the tenant's disk-backed storage, once
     * per backend process (the tmpfs only resets together with the container). The login terminal,
     * the auth probe and agent turns all resolve HOME through this overlay, so a sign-in survives a
     * backend restart, an idle stop and a redeploy. Skipped when the operator disabled the storage.
     */
    protected ensurePersistentTenantBackendHome(home: string): void {
        if (this.persistentTenantHomes.has(home)) {
            return;
        }
        const root = QaapTenantAgentStorageEnv.resolveRoot(process.env, QaapTenantAgentStorageEnv.defaultTenantBackendRoot(process.env));
        if (!root || !this.preparedAgentStorageRoots.has(root)) {
            return;
        }
        try {
            const identity = this.isBackendRoot() ? resolveAgentSpawnIdentityFromEnv(process.env, true) : undefined;
            const owner = identity?.uid !== undefined && identity.uid > 0
                ? { uid: identity.uid, gid: identity.gid ?? identity.uid }
                : undefined;
            const grantAccess = owner
                ? (entry: string, directory: boolean) => this.grantTenantEntryAccess(entry, owner.uid, directory)
                : undefined;
            this.linkPersistentTenantHome(home, QaapTenantAgentStorageEnv.homeDir(root), owner, grantAccess);
            this.persistentTenantHomes.add(home);
        } catch (error) {
            console.warn(`[qaap-security] could not persist agent sign-in state of ${home}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Overridable in tests. */
    protected linkPersistentTenantHome(home: string, persistentHome: string, owner?: QaapTenantPersistentHomeOwner, grantAccess?: QaapTenantPersistentHomeAccessGrant): void {
        QaapTenantPersistentHome.link(home, persistentHome, owner, grantAccess);
    }

    /**
     * ACL fallback for a HOME entry the backend could not chown (no CAP_CHOWN): gives the agent uid
     * access to `entry`. Directories also get a default ACL so entries created later stay reachable.
     */
    protected grantTenantEntryAccess(entry: string, uid: number, directory: boolean): void {
        const result = this.grantAgentAccess(uid, directory ? 'directory' : 'file', [entry]);
        if (!result.ok) {
            throw new Error(`Could not grant agent uid ${uid} access to ${entry} (${result.reason ?? 'unknown reason'}).`);
        }
    }

    /**
     * Create the storage directories (0700) in this container so the first tool that uses them does
     * not race another one creating the parent. Best effort: tools create missing dirs themselves.
     */
    protected ensureTenantAgentStorage(root: string): void {
        if (this.preparedAgentStorageRoots.has(root) || this.attemptedAgentStorageRoots.has(root)) {
            return;
        }
        // One attempt per backend process and root. Every agent spawn resolves this, so a failed
        // attempt that was retried would re-run the recursive ACL sweep and re-log the same failure
        // on each operation; the single warning below carries the concrete cause instead.
        this.attemptedAgentStorageRoots.add(root);
        try {
            for (const dir of [QaapTenantAgentStorageEnv.cacheDir(root), QaapTenantAgentStorageEnv.dataDir(root), QaapTenantAgentStorageEnv.homeDir(root)]) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }
            fs.chmodSync(root, 0o700);
            const uid = Number.parseInt(process.env.QAAP_AGENT_UID?.trim() ?? '', 10);
            const configRoot = process.env.QAAP_TENANT_CONFIG_ROOT?.trim();
            if (Number.isInteger(uid) && uid > 0 && configRoot) {
                this.grantTenantAgentStorageAccess(configRoot, root, uid);
            }
            this.preparedAgentStorageRoots.add(root);
        } catch (error) {
            console.warn(`[qaap-security] could not prepare tenant agent storage ${root}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected grantTenantAgentStorageAccess(configRoot: string, root: string, uid: number): void {
        const configAcl = this.grantAgentAccess(uid, 'traverse', [configRoot]);
        const rootAcl = this.grantAgentAccess(uid, 'directory', [root]);
        const childAcl = this.grantAgentAccess(uid, 'directory', [QaapTenantAgentStorageEnv.cacheDir(root), QaapTenantAgentStorageEnv.dataDir(root), QaapTenantAgentStorageEnv.homeDir(root)]);
        const failedAcl = [configAcl, rootAcl, childAcl].find(result => !result.ok);
        if (failedAcl) {
            throw new Error(`Could not grant agent uid ${uid} access to its private tenant cache at ${root} (${failedAcl.reason}).`);
        }
        // Harness state written while agents still ran as root (opencode.db, its log, caches) keeps
        // root:root 0755/0644 and default ACLs only cover new entries; without this the dropped-uid
        // agent fails on its own log file (PermissionDenied: FileSystem.open .../opencode.log).
        // Best effort, unlike the ACLs above: one stale entry find cannot read (a dir owned by an old
        // container uid, e.g. cache/bun) must not abort the whole preparation. That abort skipped the
        // sign-in links under the same root, so every Codex/Claude login stayed in the volatile HOME
        // and the task sandbox never received it. The home sweep covers the root-owned CLI state
        // (.codex, .claude, .gemini, ...) that the sign-in links point to, which an older root
        // run left at 0700 with `mask::---`. A failure is logged per directory and never skips the
        // remaining ones, so a stale cache cannot block the home repair; the storage stays usable.
        // The sweeps run in child processes; agent turns await them (prepareTenantIsolationAsync).
        const key = this.aclSweepKey(uid, root);
        if (!this.tenantAgentStorageSweeps.has(key)) {
            this.tenantAgentStorageSweeps.set(key, this.sweepTenantAgentStorage(root, uid));
        }
    }

    /** The harness-state sweeps of {@link grantTenantAgentStorageAccess}, one directory after the other; never rejects. */
    protected async sweepTenantAgentStorage(root: string, uid: number): Promise<void> {
        for (const dir of [QaapTenantAgentStorageEnv.cacheDir(root), QaapTenantAgentStorageEnv.dataDir(root), QaapTenantAgentStorageEnv.homeDir(root)]) {
            let result: QaapTenantAccessCommandResult;
            try {
                result = await this.sweepAgentAccessSinceLastSweep(uid, dir);
            } catch (error) {
                result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
            }
            if (!result.ok) {
                console.warn(`[qaap-security] agent uid ${uid} may not reach existing harness state under ${dir} `
                    + `(${result.reason ?? 'unknown reason'}); the sign-in links are still prepared.`);
            }
        }
    }

    /**
     * Augment a child env with the tenant's writable HOME (and matching USER/LOGNAME) when a uid drop
     * applies for `cwd`. No-op when no drop applies.
     */
    resolveProcessEnv(cwd: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
        return { ...base, ...this.tenantHomeEnvOverlay(this.canonicalizeCwd(cwd)) };
    }

    /**
     * Provision `dir` (and its ancestors) so a tenant-uid process can create children under it — used
     * before `git worktree add {dir}/{slug}` so the tenant can create the new worktree. `dir` is chowned
     * to the tenant resolved from `cwd` and locked 0700; ancestors are created (root-owned, traversable).
     * No-op unless uid-per-user is on, the backend is root, and `cwd` resolves to a tenant tree.
     */
    provisionTenantDir(cwd: string, dir: string): void {
        cwd = this.canonicalizeCwd(cwd);
        if (!this.isBackendRoot() || !isTenantUidPerUserEnabled(process.env)) {
            return;
        }
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
        if (!target) {
            return;
        }
        let identity: { uid: number; gid: number };
        try {
            identity = this.getTenantUidRegistry().resolve(target.segment);
        } catch {
            return;
        }
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.chownSync(dir, identity.uid, identity.gid);
            fs.chmodSync(dir, 0o700);
        } catch (error) {
            console.warn(`[qaap-security] could not provision tenant dir ${dir} for uid ${identity.uid}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Wrap a git argv to run over a tenant repo/worktree under the tenant uid (setpriv), so
     * tenant-controlled hooks AND clean/smudge/merge filter drivers run as the tenant (never root), and
     * files git writes are tenant-owned. Enforces the policy + provisions/chowns `cwd`. Returns plain
     * `git -C cwd …` when no drop applies (local dev); throws (fail-closed) if setpriv is missing.
     * `-c core.hooksPath=/dev/null` stays as belt-and-suspenders.
     */
    wrapGitForTenant(cwd: string, gitArgs: readonly string[], environment?: NodeJS.ProcessEnv): { file: string; args: string[] } {
        cwd = this.canonicalizeCwd(cwd);
        if (this.isContainerIsolationEnabled()) {
            const segment = this.resolveTenantSegment(cwd);
            const tenantRoot = this.resolveTenantRoot(cwd);
            this.prepareTenantIsolation(cwd);
            if (!segment || !tenantRoot || !this.dockerOrchestrator) {
                throw new Error('Refusing to run git without a validated tenant container.');
            }
            // `cwd` is a host path. Translate the explicit -C path as well; otherwise git inside the
            // worker receives `/workspace/repos/users/<login>/...`, which is outside its `/workspace`
            // mount and breaks worktree/parallel operations. The mounted path is tenant-local.
            const containerCwd = this.dockerOrchestrator.toContainerPath(cwd, tenantRoot);
            return this.dockerOrchestrator.wrapShellForTenantContainer(
                segment,
                cwd,
                'git',
                ['-c', 'core.hooksPath=/dev/null', '-C', containerCwd, ...gitArgs],
                tenantRoot,
                environment,
            );
        }
        return this.wrapShellForTenant(cwd, 'git', this.withDroppedGitTrust(cwd, 'git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...gitArgs]), environment);
    }

    /**
     * Read-only git children ignore the system config (`GIT_CONFIG_NOSYSTEM`), including the image's
     * `safe.directory`, so git dropped to the agent uid refuses a repo the root backend cloned
     * ("detected dubious ownership"). Trust it on the command line only for that dropped uid: it
     * already controls the repo's config, so nothing is gained. Never for a process running as the
     * backend, where this check stops repo config such as filters from running with its privileges.
     */
    protected withDroppedGitTrust(cwd: string, file: string, args: readonly string[]): string[] {
        const uid = file === 'git' ? this.resolveSpawnIdentity(cwd).uid : undefined;
        return uid ? ['-c', 'safe.directory=*', ...args] : [...args];
    }

    /**
     * Rewrite an interactive shell (`file` + `args`) so it runs under the tenant uid with cleared
     * supplementary groups, for callers that spawn through a foreign mechanism we do not control (the
     * node-pty terminal). Enforces the fail-closed policy and provisions the tenant tree first. Returns
     * the pair unchanged when no uid drop applies (local dev). THROWS when a drop is required but
     * `setpriv` is missing — it never silently returns a root/shared shell (the shipped Linux image
     * provisions util-linux; a missing setpriv is a misconfiguration, not a reason to leak root).
     *
     * In container isolation mode (QAAP_CLOUD_MODE=docker), delegates interactive PTY to
     * `docker exec -it` inside the tenant's dedicated worker container.
     */
    wrapShellForTenant(cwd: string, file: string, args: readonly string[], environment?: NodeJS.ProcessEnv): { file: string; args: string[] } {
        cwd = this.canonicalizeCwd(cwd);
        this.enforceIsolationPolicy();
        const sandbox = this.taskSandboxFor(cwd);
        if (sandbox) {
            // A terminal in a sandboxed worktree joins that task's sandbox: same processes, same ports.
            return this.taskSandbox!.wrapInteractive(sandbox, cwd, file, args, environment);
        }
        if (this.isContainerIsolationEnabled()) {
            const segment = this.resolveTenantSegment(cwd);
            const tenantRoot = this.resolveTenantRoot(cwd);
            this.prepareTenantIsolation(cwd);
            if (this.dockerOrchestrator && segment && tenantRoot) {
                return this.dockerOrchestrator.wrapInteractiveTerminalForTenant(segment, cwd, file, args, tenantRoot, environment);
            }
            throw new Error('Refusing to open a terminal without a validated tenant container.');
        }
        const identity = this.resolveSpawnIdentity(cwd);
        if (identity.uid === undefined) {
            const limitedInvocation = this.applyResourceLimits({ file, args: [...args], shell: false }, cwd);
            return { file: limitedInvocation.file, args: limitedInvocation.args };
        }
        this.prepareTenantIsolation(cwd);
        const gid = identity.gid ?? identity.uid;
        const setprivExecutable = this.resolveSetprivExecutable();
        if (!setprivExecutable) {
            throw new Error('Refusing to open a terminal under a shared/root uid: setpriv (util-linux) is '
                + 'required to drop privileges for the interactive shell but was not found on PATH. '
                + 'Install util-linux in the backend image.');
        }
        const limitedInvocation = this.applyResourceLimits({
            file: setprivExecutable,
            args: ['--reuid', String(identity.uid), '--regid', String(gid), '--clear-groups', '--', file, ...args],
            shell: false,
        }, cwd);
        return { file: limitedInvocation.file, args: limitedInvocation.args };
    }

    // ─── Provisioning primitives (overridable in tests) ───────────────────────────────────────────

    /** Chown the tenant's per-user root to its uid and lock it owner-only (0700). Overridable in tests. */
    protected applyTenantRootIsolation(userRoot: string, uid: number, gid: number): void {
        try {
            fs.chownSync(userRoot, uid, gid);
            fs.chmodSync(userRoot, 0o700);
        } catch (error) {
            console.warn(`[qaap-security] could not isolate tenant root ${userRoot} to 0700 uid ${uid}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Lock each tenant's per-user root ({reposRoot}/users/{segment}) to owner-only so a DIFFERENT
     * tenant's uid cannot even traverse into it (repos are cloned world-readable 0755). No-op when
     * uid-per-user is off, the backend is not root, or the cwd is outside a tenant tree. (SEC-1)
     */
    protected ensureTenantRootIsolated(cwd: string): void {
        if (!this.isBackendRoot() || !isTenantUidPerUserEnabled(process.env)) {
            return;
        }
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
        if (!target) {
            return;
        }
        let identity: { uid: number; gid: number };
        try {
            identity = this.getTenantUidRegistry().resolve(target.segment);
        } catch {
            return; // a registry failure already fails the spawn via resolveSpawnIdentity
        }
        this.applyTenantRootIsolation(target.root, identity.uid, identity.gid);
    }

    /**
     * Provision the OS account + private HOME + traversable parents a tenant uid needs to actually run
     * (getpwuid / git commit require a passwd record). No-op unless uid-per-user is on, the backend is
     * root, and the cwd resolves to a tenant tree. Fail closed on a registry throw. (SEC-1)
     */
    protected ensureTenantIdentityProvisioned(cwd: string): void {
        if (!this.isBackendRoot() || !isTenantUidPerUserEnabled(process.env)) {
            return;
        }
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
        if (!target) {
            return;
        }
        const identity = this.getTenantUidRegistry().resolve(target.segment);
        const home = resolveTenantHome(target.segment);
        this.ensureTenantParentsTraversable();
        this.provisionTenantOsUser(target.segment, identity.uid, identity.gid, home);
        this.provisionTenantHome(identity.uid, identity.gid, home);
    }

    /**
     * chmod 0711 the shared parent dirs so a tenant uid can TRAVERSE to its own 0700 subdir without
     * being able to LIST sibling tenants (0755 would leak the set of logins). Runs once per process.
     * Overridable in tests.
     */
    protected ensureTenantParentsTraversable(): void {
        if (this.tenantParentsHardened) {
            return;
        }
        this.tenantParentsHardened = true;
        const usersRoot = path.join(resolveQaapReposRoot(), QAAP_USER_REPOS_SEGMENT);
        // Harden the parent of EVERY recognized tenant-tree root (repos, conversation worktrees, and
        // the legacy parallel root) to 0711 so a tenant can traverse to its own 0700 segment dir but
        // cannot list sibling tenants. Must match the roots resolveTenantIsolationRoot recognizes.
        for (const dir of [usersRoot, resolveQaapWorktreesRoot(), resolveQaapParallelRoot()]) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                fs.chmodSync(dir, 0o711);
            } catch (error) {
                console.warn(`[qaap-security] could not harden tenant parent ${dir} to 0711: `
                    + `${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    /** Append an idempotent `/etc/passwd`+`/etc/group` record for a tenant uid. Overridable in tests. */
    protected provisionTenantOsUser(segment: string, uid: number, gid: number, home: string): void {
        const userName = `qaap-t-${segment}`;
        this.appendOsRecordIfMissing('/etc/group', `:x:${gid}:`, `${userName}:x:${gid}:\n`);
        this.appendOsRecordIfMissing('/etc/passwd', `:x:${uid}:`, `${userName}:x:${uid}:${gid}:Qaap tenant:${home}:/usr/sbin/nologin\n`);
    }

    /**
     * Append `line` to a colon-delimited OS account file only when no existing record contains
     * `marker`. Synchronous, so within the single `--no-cluster` backend process it is a serialized
     * critical section — concurrent tenant spawns cannot interleave partial writes.
     */
    protected appendOsRecordIfMissing(file: string, marker: string, line: string): void {
        try {
            let current: string;
            try {
                current = fs.readFileSync(file, 'utf8');
            } catch {
                return; // no account file (non-glibc / unexpected base image) — nothing safe to do
            }
            if (current.includes(marker)) {
                return; // already provisioned
            }
            fs.appendFileSync(file, current === '' || current.endsWith('\n') ? line : `\n${line}`);
        } catch (error) {
            console.warn(`[qaap-security] could not provision ${file} for a tenant uid: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Create + lock a tenant's private HOME (0700, tenant-owned), seeding shared config once. Overridable in tests. */
    protected provisionTenantHome(uid: number, gid: number, home: string): void {
        try {
            if (fs.existsSync(home) && fs.statSync(home).uid === uid) {
                return; // already provisioned and owned by this tenant
            }
            fs.mkdirSync(home, { recursive: true });
            this.seedTenantHome(home);
            const result = spawnSync('chown', ['-R', `${uid}:${gid}`, home], { stdio: 'ignore' });
            if (result.status !== 0) {
                console.warn(`[qaap-security] could not chown tenant home ${home} to ${uid}:${gid} `
                    + `(exit ${result.status ?? 'signal'}); the process may not be able to write it.`);
            }
            fs.chmodSync(home, 0o700);
        } catch (error) {
            console.warn(`[qaap-security] could not provision tenant home ${home} for uid ${uid}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Seed a fresh tenant HOME with the shared agent's `.claude` config so qaiq starts configured. */
    protected seedTenantHome(home: string): void {
        const sharedHome = process.env.QAAP_AGENT_HOME?.trim() || '/home/qaap-agent';
        const sharedClaude = path.join(sharedHome, '.claude');
        if (!fs.existsSync(sharedClaude)) {
            return;
        }
        try {
            fs.cpSync(sharedClaude, path.join(home, '.claude'), { recursive: true });
        } catch (error) {
            console.warn(`[qaap-security] could not seed tenant home ${home} from ${sharedClaude}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
