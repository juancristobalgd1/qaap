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
 * Fail-closed guard for the shared-container isolation risk. In a production runtime the agent must
 * NOT run as root: as root with `--dangerously-skip-permissions` it can read every tenant's secrets,
 * tokens and code on the shared filesystem. Refuse the spawn unless privileges are dropped
 * (`QAAP_AGENT_UID`, which the shipped image defaults to `1001`) or an operator explicitly accepts the
 * risk via `QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION`.
 *
 * Local/single-user dev is unaffected: nothing is refused when the backend is not root or the runtime
 * is not production.
 */
export function evaluateAgentIsolationPolicy(env: NodeJS.ProcessEnv, isRoot: boolean): QaapAgentIsolationDecision {
    const identity = resolveAgentSpawnIdentity(env, isRoot);
    const agentRunsAsRoot = isRoot && identity.uid === undefined;
    if (!agentRunsAsRoot || !isQaapProductionRuntime(env)) {
        return { refuse: false };
    }
    const override = env[QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION]?.trim().toLowerCase();
    if (override === 'true' || override === '1') {
        return { refuse: false };
    }
    return {
        refuse: true,
        reason: 'Refusing to spawn the agent as root in a production runtime: set QAAP_AGENT_UID=1001 to drop '
            + 'the agent to a non-root user (the shipped image provisions uid 1001), or set '
            + 'QAAP_ALLOW_ROOT_AGENT_IN_PRODUCTION=true to override at your own risk. See SECURITY.md.',
    };
}
