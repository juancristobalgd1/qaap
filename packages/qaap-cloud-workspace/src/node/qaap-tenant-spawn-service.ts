// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
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
    isTenantUidPerUserEnabled,
    resolvePerTenantSpawnIdentity,
    QaapAgentIsolationDecision,
} from './qaap-agent-spawn-identity';
import { QaapTenantUidRegistry, resolveDefaultTenantUidRegistryPath } from './qaap-tenant-uid-registry';

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

    protected tenantUidRegistry: QaapTenantUidRegistry | undefined;
    protected agentSpawnIdentityWarned = false;
    protected agentIsolationDecision: QaapAgentIsolationDecision | undefined;
    protected agentIsolationRefusalLogged = false;
    protected tenantParentsHardened = false;
    protected setprivAvailable: boolean | undefined;

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
     * and a `chown -R` of the cwd (which the backend created as root). No-op unless uid-per-user is on,
     * the backend is root, and the cwd resolves to a tenant tree. Fail closed: a registry throw
     * (range exhausted / persistence failure) propagates out and fails the spawn.
     */
    prepareTenantIsolation(cwd: string): void {
        this.ensureTenantRootIsolated(cwd);
        this.ensureTenantIdentityProvisioned(cwd);
        if (!this.isBackendRoot()) {
            return;
        }
        const identity = this.resolveSpawnIdentity(cwd);
        if (identity.uid === undefined) {
            return;
        }
        let currentUid: number | undefined;
        try {
            currentUid = fs.statSync(cwd).uid;
        } catch {
            return; // cwd missing — let the spawn surface the real error
        }
        if (currentUid === identity.uid) {
            return; // already owned by the target uid
        }
        const gid = identity.gid ?? identity.uid;
        const result = spawnSync('chown', ['-R', `${identity.uid}:${gid}`, cwd], { stdio: 'ignore' });
        if (result.status !== 0) {
            console.warn(`[qaap-security] could not chown cwd ${cwd} to ${identity.uid}:${gid} `
                + `(exit ${result.status ?? 'signal'}); the process may not be able to write.`);
        }
    }

    /**
     * Spawn a shell command under the identity resolved for its cwd. When a uid drop applies and
     * `setpriv` is available, the command is wrapped in `setpriv --reuid U --regid G --clear-groups --
     * /bin/sh -c <command>` so the child also loses root's supplementary groups (Node's `{ uid, gid }`
     * drop never calls `setgroups`). Otherwise falls back to a plain `shell: true` spawn with the
     * Node-level drop — byte-identical to a non-isolated spawn.
     *
     * NOTE: callers should invoke {@link enforceIsolationPolicy} and {@link prepareTenantIsolation}
     * first (see {@link spawnPrepared}).
     */
    spawn(command: string, options: QaapTenantSpawnOptions): ChildProcess {
        const identity = this.resolveSpawnIdentity(options.cwd);
        const invocation = buildAgentSpawnInvocation(command, identity, this.isSetprivAvailable());
        return this.launchProcess(invocation.file, invocation.args ? [...invocation.args] : [], {
            cwd: options.cwd,
            detached: options.detached ?? true,
            env: options.env,
            stdio: options.stdio,
            ...invocation.options,
        });
    }

    /** The single `child_process.spawn` seam — overridable in tests to capture argv without executing. */
    protected launchProcess(file: string, args: string[], options: object): ChildProcess {
        return spawn(file, args, options as Parameters<typeof spawn>[2]);
    }

    /**
     * Full isolated spawn: enforce the fail-closed policy, provision + own the tenant tree, then spawn
     * under the tenant identity. Use this from callers that own the whole lifecycle (e.g. the preview
     * dev server and the terminal shell). The agent runner drives the three steps itself so it can
     * interleave latency marks and its own env/HOME wiring.
     */
    spawnPrepared(command: string, options: QaapTenantSpawnOptions): ChildProcess {
        this.enforceIsolationPolicy();
        this.prepareTenantIsolation(options.cwd);
        return this.spawn(command, options);
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
        options: { cwd: string; env: NodeJS.ProcessEnv; detached?: boolean },
    ): ChildProcess {
        this.enforceIsolationPolicy();
        this.prepareTenantIsolation(options.cwd);
        const identity = this.resolveSpawnIdentity(options.cwd);
        const spawnOptions: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; uid?: number; gid?: number } = {
            cwd: options.cwd,
            env: options.env,
            detached: options.detached ?? false,
        };
        if (identity.uid === undefined) {
            return this.launchProcess(file, [...args], spawnOptions);
        }
        const gid = identity.gid ?? identity.uid;
        if (this.isSetprivAvailable()) {
            return this.launchProcess(
                'setpriv',
                ['--reuid', String(identity.uid), '--regid', String(gid), '--clear-groups', '--', file, ...args],
                spawnOptions,
            );
        }
        spawnOptions.uid = identity.uid;
        spawnOptions.gid = gid;
        return this.launchProcess(file, [...args], spawnOptions);
    }

    /**
     * The tenant HOME/USER/LOGNAME overlay for a dropped process, or `{}` when no uid drop applies.
     * Without a writable HOME a dropped process inherits root's `/root`, which it cannot write.
     */
    tenantHomeEnvOverlay(cwd: string): { HOME?: string; USER?: string; LOGNAME?: string } {
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
        return { ...base, ...this.tenantHomeEnvOverlay(cwd) };
    }

    /**
     * Rewrite an interactive shell (`file` + `args`) so it runs under the tenant uid with cleared
     * supplementary groups, for callers that spawn through a foreign mechanism we do not control (the
     * node-pty terminal). Enforces the fail-closed policy and provisions the tenant tree first. Returns
     * the pair unchanged when no uid drop applies (local dev). THROWS when a drop is required but
     * `setpriv` is missing — it never silently returns a root/shared shell (the shipped Linux image
     * provisions util-linux; a missing setpriv is a misconfiguration, not a reason to leak root).
     */
    wrapShellForTenant(cwd: string, file: string, args: readonly string[]): { file: string; args: string[] } {
        this.enforceIsolationPolicy();
        const identity = this.resolveSpawnIdentity(cwd);
        if (identity.uid === undefined) {
            return { file, args: [...args] };
        }
        this.prepareTenantIsolation(cwd);
        const gid = identity.gid ?? identity.uid;
        if (!this.isSetprivAvailable()) {
            throw new Error('Refusing to open a terminal under a shared/root uid: setpriv (util-linux) is '
                + 'required to drop privileges for the interactive shell but was not found on PATH. '
                + 'Install util-linux in the backend image.');
        }
        return {
            file: 'setpriv',
            args: ['--reuid', String(identity.uid), '--regid', String(gid), '--clear-groups', '--', file, ...args],
        };
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
        for (const dir of [usersRoot, resolveQaapWorktreesRoot()]) {
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
