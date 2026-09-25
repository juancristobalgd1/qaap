// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    normalizeIsolationPath,
    resolveQaapParallelRoot,
    resolveQaapReposRoot,
    resolveQaapWorktreesRoot,
    resolveTenantHome,
    resolveTenantIsolationRoot,
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

/** How the spawned process's stdio streams are wired. */
export type QaapSpawnStdio = ('pipe' | 'ignore')[];

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
     * uid to drop to. In particular, rootless Docker maps container uid 0 to the daemon owner and
     * the worker deliberately drops all capabilities; calling setpriv there cannot change uid and
     * fails with `setresuid: Operation not permitted`.
     */
    protected isTenantBackendMode(): boolean {
        return /^(1|true)$/i.test(process.env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '');
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

    /** Whether `setpriv` (util-linux) exists on PATH — probed once. Overridable in tests. */
    protected isSetprivAvailable(): boolean {
        if (this.setprivAvailable === undefined) {
            const probe = spawnSync('setpriv', ['--version'], { stdio: 'ignore' });
            this.setprivAvailable = !probe.error && probe.status === 0;
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
        if (this.setprivExecutable) {
            return this.setprivExecutable;
        }
        if (!this.isSetprivAvailable()) {
            return undefined;
        }
        const searchDirectories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
        for (const directory of searchDirectories) {
            const candidate = path.resolve(directory, 'setpriv');
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                this.setprivExecutable = candidate;
                return candidate;
            } catch {
                // Keep searching PATH. isSetprivAvailable already proved the command exists, but a
                // relative or concurrently changed PATH must still fail closed below.
            }
        }
        return undefined;
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
            const probe = spawnSync('systemd-run', [
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
            return invocation;
        }

        const limits = this.resolveResourceLimits();
        const command = invocation.shell
            ? ['/bin/sh', '-c', invocation.file]
            : [invocation.file, ...invocation.args];
        if (this.isSystemdRunAvailable()) {
            const cpuQuota = `${Math.max(1, Math.round(limits.cpuCores * 100))}%`;
            return {
                file: 'systemd-run',
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
            return {};
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
     * Async lifecycle gate for Docker mode. Every asynchronous process owner must await this before
     * calling the synchronous child-process APIs. A rejected Docker create/inspect is propagated;
     * there is intentionally no best-effort prewarm and no fallback to the backend host.
     */
    async prepareTenantIsolationAsync(cwd: string): Promise<void> {
        cwd = this.canonicalizeCwd(cwd);
        this.assertTenantCwdInProduction(cwd);
        if (!this.isContainerIsolationEnabled()) {
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
        const invocation = buildAgentSpawnInvocation(command, identity, this.isSetprivAvailable());
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

    /** The single `child_process.spawn` seam — overridable in tests to capture argv without executing. */
    protected launchProcess(file: string, args: string[], options: object): ChildProcess {
        return spawn(file, args, options as Parameters<typeof spawn>[2]);
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
        const spawnOptions: { cwd: string; env: NodeJS.ProcessEnv; stdio: QaapSpawnStdio; detached: boolean } = {
            cwd,
            env: options.env,
            stdio: options.stdio ?? ['pipe', 'pipe', 'pipe'],
            detached: options.detached ?? false,
        };
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
                file: 'setpriv',
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
            file: 'setpriv',
            args: ['--reuid', String(identity.uid), '--regid', String(gid), '--clear-groups', '--', file, ...args],
            shell: false,
        }, cwd);
        return { file: limitedInvocation.file, args: limitedInvocation.args };
    }

    /**
     * The tenant HOME/USER/LOGNAME overlay for a dropped process, or `{}` when no uid drop applies.
     * Without a writable HOME a dropped process inherits root's `/root`, which it cannot write.
     */
    tenantHomeEnvOverlay(cwd: string): { HOME?: string; USER?: string; LOGNAME?: string } {
        cwd = this.canonicalizeCwd(cwd);
        if (this.isContainerIsolationEnabled() || this.isTenantBackendMode()) {
            // The host-side per-uid HOME is not mounted into a tenant worker. Passing it through
            // docker exec would make the child point at a nonexistent/shared host path and could
            // accidentally bypass the worker's private HOME. The orchestrator seeds this HOME
            // when it creates the container; exec must keep using the same worker-local value. A
            // backend running inside that worker uses the same rule even though its own
            // QAAP_CLOUD_MODE is local and it therefore does not enable host-side Docker routing.
            const home = process.env.QAAP_TENANT_CONTAINER_HOME?.trim() || '/tmp/qaap-home';
            return { HOME: home, USER: 'qaap-tenant', LOGNAME: 'qaap-tenant' };
        }
        if (this.resolveSpawnIdentity(cwd).uid === undefined) {
            return {};
        }
        const overlay: { HOME?: string; USER?: string; LOGNAME?: string } = { HOME: this.resolveTenantHome(cwd) };
        const target = resolveTenantIsolationRoot(resolveQaapReposRoot(), resolveQaapWorktreesRoot(), cwd);
        if (target) {
            overlay.USER = `qaap-t-${target.segment}`;
            overlay.LOGNAME = overlay.USER;
        }
        return overlay;
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
    wrapGitForTenant(cwd: string, gitArgs: readonly string[]): { file: string; args: string[] } {
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
            );
        }
        return this.wrapShellForTenant(cwd, 'git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...gitArgs]);
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
        // parallel-run worktrees) to 0711 so a tenant can traverse to its own 0700 segment dir but
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
