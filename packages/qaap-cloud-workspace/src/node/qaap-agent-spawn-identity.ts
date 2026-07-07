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
