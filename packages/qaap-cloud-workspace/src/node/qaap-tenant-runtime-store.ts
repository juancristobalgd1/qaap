// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type {
    QaapTenantActivityReason,
    QaapTenantRuntimeState,
    QaapTenantRuntimeStatus,
} from '../common/qaap-cloud-api-types';

const LEGACY_PATH = path.join(os.homedir(), '.qaap', 'cloud-workspaces.json');
const SQLITE_PATH = resolveQaapSqlitePath(LEGACY_PATH);
const NAMESPACE = 'tenant-runtime';

/** A pure activity touch (only `lastActivityAt`/reason moved) is persisted at most this often per tenant. */
export const QAAP_TENANT_TOUCH_PERSIST_INTERVAL_MS = 30_000;

export interface QaapTenantRuntimeRecord extends QaapTenantRuntimeStatus {
    readonly updatedAt: string;
    readonly lastActivityReason?: QaapTenantActivityReason;
}

export type QaapTenantRuntimePatch = Partial<Omit<QaapTenantRuntimeRecord, 'tenantLogin' | 'updatedAt'>>;

export function canonicalQaapTenantLogin(ownerLogin: string): string {
    const login = ownerLogin.trim().toLowerCase();
    return login || '_dev';
}

/**
 * Durable lifecycle metadata. Container data remains in the existing tenant-owned mounts.
 *
 * `touch()` runs up to several times per HTTP request, so records are served from an in-memory
 * read-through cache (this instance is the only writer). A touch that only advances
 * `lastActivityAt` (plus its reason/`updatedAt`) is written to SQLite at most once every
 * {@link QAAP_TENANT_TOUCH_PERSIST_INTERVAL_MS} per tenant, with a trailing flush so the latest
 * activity always lands; any other change (state, idle/stop/destroy markers, `setState`) is
 * persisted immediately. The reaper and every reader go through {@link get}/{@link list}, which
 * always see the in-memory value, so idle-timeout decisions (minutes) are unaffected by the
 * throttle. Pending touches are flushed on backend stop.
 */
@injectable()
export class QaapTenantRuntimeStore implements BackendApplicationContribution {

    protected sqliteStore: QaapSqliteStore | undefined;
    protected readonly cache = new Map<string, QaapTenantRuntimeRecord>();
    /** Tenants whose cached record is newer than SQLite (throttled activity touch). */
    protected readonly dirty = new Set<string>();
    /** Wall-clock time of the last SQLite write per tenant, for the touch throttle. */
    protected readonly lastPersistedAt = new Map<string, number>();
    protected readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
    protected touchPersistIntervalMs = QAAP_TENANT_TOUCH_PERSIST_INTERVAL_MS;

    get(ownerLogin: string): QaapTenantRuntimeRecord | undefined {
        const tenantLogin = canonicalQaapTenantLogin(ownerLogin);
        const cached = this.cache.get(tenantLogin);
        if (cached) {
            return cached;
        }
        const stored = this.getStore().get<QaapTenantRuntimeRecord>(tenantLogin);
        if (stored) {
            this.cache.set(tenantLogin, stored);
        }
        return stored;
    }

    list(): QaapTenantRuntimeRecord[] {
        const records = new Map<string, QaapTenantRuntimeRecord>();
        for (const [key, value] of this.getStore().list<QaapTenantRuntimeRecord>()) {
            records.set(key, value);
        }
        // The cache is never older than SQLite; throttled touches only exist here.
        for (const [key, value] of this.cache) {
            records.set(key, value);
        }
        return [...records.values()];
    }

    touch(ownerLogin: string, reason: QaapTenantActivityReason, at = Date.now()): QaapTenantRuntimeRecord {
        const tenantLogin = canonicalQaapTenantLogin(ownerLogin);
        const previous = this.get(tenantLogin);
        const state = previous?.state === 'idle' ? 'active' : (previous?.state ?? 'active');
        const record: QaapTenantRuntimeRecord = {
            ...previous,
            tenantLogin,
            state,
            lastActivityAt: new Date(at).toISOString(),
            idleSince: state === 'active' ? undefined : previous?.idleSince,
            stoppedAt: state === 'active' ? undefined : previous?.stoppedAt,
            destroyAfter: state === 'active' ? undefined : previous?.destroyAfter,
            lastActivityReason: reason,
            updatedAt: new Date(at).toISOString(),
            reaperEnabled: previous?.reaperEnabled ?? false,
        };
        this.cache.set(tenantLogin, record);
        if (!previous || this.changesMoreThanActivity(previous, record)) {
            this.persist(tenantLogin, record);
            return record;
        }
        const now = Date.now();
        const last = this.lastPersistedAt.get(tenantLogin);
        if (last === undefined || now - last >= this.touchPersistIntervalMs) {
            this.persist(tenantLogin, record);
        } else {
            this.dirty.add(tenantLogin);
            this.scheduleFlush(tenantLogin, this.touchPersistIntervalMs - (now - last));
        }
        return record;
    }

    setState(ownerLogin: string, state: QaapTenantRuntimeState, patch: QaapTenantRuntimePatch = {}, at = Date.now()): QaapTenantRuntimeRecord {
        const tenantLogin = canonicalQaapTenantLogin(ownerLogin);
        const previous = this.get(tenantLogin);
        const now = new Date(at).toISOString();
        const record: QaapTenantRuntimeRecord = {
            ...previous,
            ...patch,
            tenantLogin,
            state,
            updatedAt: now,
            reaperEnabled: patch.reaperEnabled ?? previous?.reaperEnabled ?? false,
        };
        this.cache.set(tenantLogin, record);
        this.persist(tenantLogin, record);
        return record;
    }

    /** Write every throttled activity touch to SQLite now. */
    flush(): void {
        for (const tenantLogin of [...this.dirty]) {
            this.flushTenant(tenantLogin);
        }
    }

    onStop(): void {
        this.dispose();
    }

    /** Flush pending touches and cancel trailing timers. The store stays usable afterwards. */
    dispose(): void {
        for (const timer of this.flushTimers.values()) {
            clearTimeout(timer);
        }
        this.flushTimers.clear();
        try {
            this.flush();
        } catch (error) {
            console.warn('[qaap-tenant-runtime-store] failed to flush pending activity:', error);
        }
    }

    /** True when a touch changed anything besides the activity timestamp/reason (state, markers, ...). */
    protected changesMoreThanActivity(previous: QaapTenantRuntimeRecord, next: QaapTenantRuntimeRecord): boolean {
        return previous.state !== next.state
            || previous.idleSince !== next.idleSince
            || previous.stoppedAt !== next.stoppedAt
            || previous.destroyAfter !== next.destroyAfter
            || previous.reaperEnabled !== next.reaperEnabled;
    }

    protected persist(tenantLogin: string, record: QaapTenantRuntimeRecord): void {
        this.dirty.delete(tenantLogin);
        const timer = this.flushTimers.get(tenantLogin);
        if (timer) {
            clearTimeout(timer);
            this.flushTimers.delete(tenantLogin);
        }
        this.lastPersistedAt.set(tenantLogin, Date.now());
        this.getStore().set(tenantLogin, record);
    }

    protected flushTenant(tenantLogin: string): void {
        const record = this.cache.get(tenantLogin);
        if (!record || !this.dirty.has(tenantLogin)) {
            this.dirty.delete(tenantLogin);
            return;
        }
        this.persist(tenantLogin, record);
    }

    protected scheduleFlush(tenantLogin: string, delayMs: number): void {
        if (this.flushTimers.has(tenantLogin)) {
            return;
        }
        const timer = setTimeout(() => {
            this.flushTimers.delete(tenantLogin);
            try {
                this.flushTenant(tenantLogin);
            } catch (error) {
                console.warn('[qaap-tenant-runtime-store] failed to persist activity touch:', error);
            }
        }, Math.max(0, delayMs));
        timer.unref?.();
        this.flushTimers.set(tenantLogin, timer);
    }

    protected getStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: SQLITE_PATH,
            namespace: NAMESPACE,
            legacyPath: LEGACY_PATH,
        });
    }
}
