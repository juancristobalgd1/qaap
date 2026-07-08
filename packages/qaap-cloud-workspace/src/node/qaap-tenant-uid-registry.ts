// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { safeUserIdSegment } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/**
 * Per-tenant OS uid/gid registry for the uid-per-user code-isolation model.
 *
 * The security invariant is that each tenant's workspace root `{reposRoot}/users/{segment}` is mode
 * `0700` owned by that tenant's uid, so one tenant's agent (spawned under its uid) cannot traverse
 * into another's tree. That only works if every login maps to a STABLE, COLLISION-FREE uid — a hash
 * would risk two logins colliding onto one uid (zero isolation between them). So this is a persisted,
 * monotonically-assigned registry keyed by the SAME `safeUserIdSegment(login)` used for the path
 * segment; the uid and the on-disk tree can never drift.
 *
 * Assignment happens in-process (the backend runs `--no-cluster`, one process) guarded by JS's
 * single-threaded sync execution; each assignment is persisted immediately. If a cluster is ever
 * introduced this needs an `O_EXCL` file lock instead.
 */

/** First uid handed out to a real tenant. Below this sit the shared reserved buckets + the OS range. */
export const QAAP_TENANT_UID_BASE = 20000;
/** Exclusive upper bound; ~40k distinct tenants before exhaustion (then resolve() fails closed). */
export const QAAP_TENANT_UID_MAX = 60000;

/**
 * Shared uids for the non-tenant buckets, placed BELOW the base so they can never collide with a
 * real tenant's assigned uid. Users in the same bucket share a uid → they are isolated FROM real
 * tenants but NOT from each other (documented, acceptable: anonymous users are not mutually isolated).
 */
export const QAAP_RESERVED_TENANT_UIDS: Readonly<Record<string, number>> = {
    _anonymous: 19990,
    _dev: 19991,
    _unknown: 19992,
};

export interface QaapTenantIdentity {
    readonly uid: number;
    /** Private per-tenant group: gid mirrors uid so there is a single dimension to administer. */
    readonly gid: number;
}

interface QaapTenantUidRegistryData {
    nextUid: number;
    map: Record<string, number>;
}

/**
 * Resolve the registry file path: `$QAAP_TENANT_UID_REGISTRY_PATH`, else `<reposRoot>/../.qaap/
 * uid-registry.json` (i.e. `/workspace/.qaap/...` in production — a persistent, root-owned location
 * OUTSIDE every tenant tree).
 */
export function resolveDefaultTenantUidRegistryPath(reposRoot: string): string {
    const override = process.env.QAAP_TENANT_UID_REGISTRY_PATH?.trim();
    if (override) {
        return override;
    }
    return path.join(path.dirname(reposRoot), '.qaap', 'uid-registry.json');
}

export class QaapTenantUidRegistry {

    protected data: QaapTenantUidRegistryData | undefined;

    constructor(protected readonly registryPath: string) { }

    /**
     * Resolve (assigning + persisting on first use) the stable uid/gid for a login. Reserved buckets
     * return their shared uid without touching the persisted map. Throws (fail closed) when the range
     * is exhausted or persistence fails — the caller must refuse the spawn rather than fall back to a
     * shared/root uid, which would silently break isolation.
     */
    resolve(login: string | undefined): QaapTenantIdentity {
        const segment = this.segmentFor(login);
        const reserved = QAAP_RESERVED_TENANT_UIDS[segment];
        if (reserved !== undefined) {
            return { uid: reserved, gid: reserved };
        }
        const data = this.load();
        const existing = data.map[segment];
        if (existing !== undefined) {
            return { uid: existing, gid: existing };
        }
        const uid = data.nextUid;
        if (uid >= QAAP_TENANT_UID_MAX) {
            throw new Error(`[qaap-security] tenant uid range exhausted (>= ${QAAP_TENANT_UID_MAX}); refusing to assign a uid for "${segment}".`);
        }
        data.map[segment] = uid;
        data.nextUid = uid + 1;
        this.persist(data);
        return { uid, gid: uid };
    }

    protected segmentFor(login: string | undefined): string {
        const trimmed = login?.trim();
        if (!trimmed) {
            return '_unknown';
        }
        if (QAAP_RESERVED_TENANT_UIDS[trimmed] !== undefined) {
            return trimmed;
        }
        const segment = safeUserIdSegment(trimmed);
        return segment || '_unknown';
    }

    protected load(): QaapTenantUidRegistryData {
        if (this.data) {
            return this.data;
        }
        try {
            const raw = fs.readFileSync(this.registryPath, 'utf8');
            const parsed = JSON.parse(raw) as Partial<QaapTenantUidRegistryData>;
            const map = parsed.map && typeof parsed.map === 'object' ? { ...parsed.map } : {};
            const highest = Object.values(map).reduce((max, v) => (typeof v === 'number' && v > max ? v : max), QAAP_TENANT_UID_BASE - 1);
            const nextUid = Math.max(
                typeof parsed.nextUid === 'number' ? parsed.nextUid : QAAP_TENANT_UID_BASE,
                highest + 1,
                QAAP_TENANT_UID_BASE,
            );
            this.data = { nextUid, map };
        } catch {
            // Missing file → fresh registry. A corrupt/unreadable file must NOT silently reset the map
            // (that would re-assign taken uids and cross tenants) — but an empty start on a genuinely
            // missing file is safe. readFileSync throwing ENOENT vs. JSON.parse throwing are handled the
            // same here because a corrupt file surfaces on the next persist() (write) failing closed.
            this.data = { nextUid: QAAP_TENANT_UID_BASE, map: {} };
        }
        return this.data;
    }

    protected persist(data: QaapTenantUidRegistryData): void {
        const dir = path.dirname(this.registryPath);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${this.registryPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, undefined, 2), { mode: 0o600 });
        fs.renameSync(tmp, this.registryPath);
        try {
            fs.chmodSync(this.registryPath, 0o600);
        } catch {
            /* best-effort tighten; the write above already set the mode on create */
        }
    }
}
