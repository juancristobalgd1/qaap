// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Non-root identity for the spawned agent/verification process, or `{}` to inherit the backend's. */
export interface QaapAgentSpawnIdentity {
    readonly uid?: number;
    readonly gid?: number;
    /** Set when QAAP_AGENT_UID was requested but could not be applied (backend not root). */
    readonly warnNotRoot?: boolean;
}

/**
 * Resolve the uid/gid to spawn the agent process under, from `QAAP_AGENT_UID` / `QAAP_AGENT_GID`.
 *
 * Dropping the agent to a non-root uid is the interim mitigation for the shared-container risk: a
 * non-root process cannot enter the root-owned `/root/.qaap` and `/root/.theia` trees, so it cannot
 * read other tenants' API keys, OAuth tokens or helper tokens even with tool auto-approval.
 *
 * Returns `{}` (inherit backend identity) when the env is unset/invalid or the backend is not root
 * — so local dev and non-containerized runs are unaffected. `warnNotRoot` flags the misconfiguration
 * where a uid was requested but privileges cannot be dropped.
 */
export function resolveAgentSpawnIdentity(
    env: NodeJS.ProcessEnv,
    isRoot: boolean,
): QaapAgentSpawnIdentity {
    const rawUid = env.QAAP_AGENT_UID?.trim();
    if (!rawUid) {
        return {};
    }
    const uid = Number.parseInt(rawUid, 10);
    if (!Number.isInteger(uid) || uid < 0) {
        return {};
    }
    if (!isRoot) {
        return { warnNotRoot: true };
    }
    const identity: { uid: number; gid?: number } = { uid };
    const rawGid = env.QAAP_AGENT_GID?.trim();
    if (rawGid) {
        const gid = Number.parseInt(rawGid, 10);
        if (Number.isInteger(gid) && gid >= 0) {
            identity.gid = gid;
        }
    }
    return identity;
}

/** Env var to explicitly accept the risk of running the agent as root in a production runtime. */
export const QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION = 'QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION';

/**
 * Env var to explicitly accept running every tenant's agent under one SHARED uid in a production
 * runtime (i.e. with `QAAP_AGENT_UID_PER_USER` off). Secrets stay isolated, but one tenant's agent
 * can read/write another tenant's code. Only acceptable on a single-user box.
 */
export const QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION = 'QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION';

/** Whether uid-per-user tenant isolation is enabled (`QAAP_AGENT_UID_PER_USER`). Default off. */
export function isTenantUidPerUserEnabled(env: NodeJS.ProcessEnv): boolean {
    return /^(1|true)$/i.test(env.QAAP_AGENT_UID_PER_USER?.trim() ?? '');
}

/**
 * Per-tenant spawn identity for uid-per-user mode. Returns the tenant's uid/gid ONLY when the flag is
 * on, the backend is root, and the cwd resolved to a tenant segment; otherwise `undefined`, so the
 * caller falls back to the global `QAAP_AGENT_UID` path (still non-root — 1001 stays set — so a cwd
 * outside any tenant tree never runs as root). `lookup` is the uid registry; if it throws (range
 * exhausted / persistence failure) the exception propagates so the caller FAILS CLOSED and refuses
 * the spawn, rather than silently running the tenant as a shared/root uid.
 */
export function resolvePerTenantSpawnIdentity(options: {
    readonly enabled: boolean;
    readonly isRoot: boolean;
    readonly segment: string | undefined;
    readonly lookup: (segment: string) => { readonly uid: number; readonly gid: number };
}): { uid: number; gid: number } | undefined {
    if (!options.enabled || !options.isRoot || !options.segment) {
        return undefined;
    }
    const { uid, gid } = options.lookup(options.segment);
    return { uid, gid };
}

/** Outcome of the fail-closed isolation policy: whether a spawn must be refused, and why. */
export interface QaapAgentIsolationDecision {
    /** True when the spawn must be refused because the agent would run as root in a production runtime. */
    readonly refuse: boolean;
    /** Human-readable reason, surfaced to the task log and console when `refuse` is true. */
    readonly reason?: string;
}

/**
 * Whether this is a hosted/production runtime. Mirrors `QaapGithubAuthGuard.isProductionRuntime`
 * (`packages/qaap-mobile-shell/src/node/qaap-github-auth-guard.ts`) deliberately: a run is production
 * when `NODE_ENV=production` or `QAAP_CLOUD_MODE` is set to anything other than `local`. Keep in sync.
 */
export function isQaapProductionRuntime(env: NodeJS.ProcessEnv): boolean {
    const cloudMode = env.QAAP_CLOUD_MODE?.trim().toLowerCase();
    return env.NODE_ENV === 'production' || (!!cloudMode && cloudMode !== 'local');
}

/**
 * Fail-closed guard for the shared-container isolation risk. In a production runtime:
 *
 * 1. The agent must NOT run as root: as root with `--dangerously-skip-permissions` it can read every
 *    tenant's secrets, tokens and code on the shared filesystem. Refuse the spawn unless privileges
 *    are dropped (`QAAP_AGENT_UID`, which the shipped image defaults to `1001`) or an operator
 *    explicitly accepts the risk via `QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION`.
 * 2. The agent must NOT run under a uid SHARED across tenants: with `QAAP_AGENT_UID_PER_USER` off,
 *    every tenant's code is sibling paths owned by the same uid, so a prompt-injected agent can
 *    read/write another tenant's repository (SEC-1). Refuse the spawn unless uid-per-user isolation
 *    is on or an operator explicitly accepts the risk via `QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION`
 *    (single-user boxes).
 *
 * Local/single-user dev is unaffected: nothing is refused when the backend is not root or the runtime
 * is not production.
 */
export function evaluateAgentIsolationPolicy(env: NodeJS.ProcessEnv, isRoot: boolean): QaapAgentIsolationDecision {
    if (!isRoot || !isQaapProductionRuntime(env)) {
        return { refuse: false };
    }
    const identity = resolveAgentSpawnIdentity(env, isRoot);
    if (identity.uid === undefined) {
        if (isOverrideAccepted(env[QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION])) {
            return { refuse: false };
        }
        return {
            refuse: true,
            reason: 'Refusing to spawn the agent as root in a production runtime — as root it can read every '
                + 'tenant\'s secrets, tokens and code on the shared filesystem. Fix: set QAAP_AGENT_UID=1001 '
                + '(the shipped image provisions that user and owns the workspace). Do NOT run multi-tenant as '
                + 'root; QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION=true is a last resort only for a trusted '
                + 'single-user box behind your own auth. See SECURITY.md.',
        };
    }
    if (!isTenantUidPerUserEnabled(env)) {
        if (isOverrideAccepted(env[QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION])) {
            return { refuse: false };
        }
        return {
            refuse: true,
            reason: 'Refusing to spawn the agent under a shared uid in a production runtime — with '
                + 'QAAP_AGENT_UID_PER_USER off, every tenant\'s code is owned by the same uid, so one tenant\'s '
                + 'agent can read/write another tenant\'s repository. Fix: set QAAP_AGENT_UID_PER_USER=1 '
                + '(read doc/qaap-uid-per-user.md first — enabling rewrites on-disk ownership). '
                + 'QAAP_ALLOW_SHARED_AGENT_UID_IN_PRODUCTION=true is acceptable only on a single-user box. '
                + 'See SECURITY.md.',
        };
    }
    return { refuse: false };
}

function isOverrideAccepted(raw: string | undefined): boolean {
    const value = raw?.trim().toLowerCase();
    return value === 'true' || value === '1';
}

/**
 * How to invoke the agent command so the privilege drop also CLEARS SUPPLEMENTARY GROUPS.
 * Node's `child_process.spawn({ uid, gid })` never calls `setgroups`, so a dropped agent retains the
 * backend's (root's) supplementary groups — including gid 0. Wrapping the command in
 * `setpriv --reuid U --regid G --clear-groups -- /bin/sh -c <command>` closes that hole.
 */
export interface QaapAgentSpawnInvocation {
    /** Executable or full shell command line, depending on `shell`. */
    readonly file: string;
    /** Argv when `shell` is false (setpriv wrapping); undefined for the plain shell path. */
    readonly args?: readonly string[];
    /** Spawn options fragment: `shell` plus the Node-level uid/gid drop for the fallback path. */
    readonly options: { readonly shell: boolean; readonly uid?: number; readonly gid?: number };
}

/**
 * Build the spawn invocation for an agent shell command under the resolved identity.
 *
 * - No uid drop → plain `spawn(command, { shell: true })`, byte-identical to before.
 * - Drop + `setpriv` available → `setpriv --reuid U --regid G --clear-groups -- /bin/sh -c <command>`.
 *   The command travels as a single argv element (no re-quoting), exactly what `shell: true` would
 *   have passed to `/bin/sh -c`.
 * - Drop + no `setpriv` (e.g. local dev on macOS) → fall back to Node's `{ uid, gid }` drop, which
 *   keeps supplementary groups (pre-existing behavior; cross-tenant reads are still blocked by the
 *   0700 tenant trees).
 */
export function buildAgentSpawnInvocation(
    command: string,
    identity: { readonly uid?: number; readonly gid?: number },
    setprivAvailable: boolean,
): QaapAgentSpawnInvocation {
    if (identity.uid === undefined) {
        return { file: command, options: { shell: true } };
    }
    const gid = identity.gid ?? identity.uid;
    if (setprivAvailable) {
        return {
            file: 'setpriv',
            args: ['--reuid', String(identity.uid), '--regid', String(gid), '--clear-groups', '--', '/bin/sh', '-c', command],
            options: { shell: false },
        };
    }
    return { file: command, options: { shell: true, uid: identity.uid, gid } };
}
