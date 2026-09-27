// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import {
    isQaapPreviewRouteId,
    qaapPreviewRouteMatchesTenant,
    type QaapPreviewRoute,
    type QaapPreviewRouteKind,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-route';

export interface QaapTenantPreviewRouteEntry {
    readonly tenantLogin: string;
    readonly recordedAt: number;
    readonly expiresAt: number;
}

/** Longest a route is remembered without being re-advertised (shares default to 24h). */
const DEFAULT_ROUTE_TTL_MS = 8 * 24 * 60 * 60_000;
const STORE_PATH = path.join(os.homedir(), '.qaap', 'tenant-preview-routes.json');

/**
 * Control-plane map from public preview identifiers (isolated preview host ids, public share
 * tokens) to the tenant whose backend serves them.
 *
 * Entries are learnt only from responses of the tenant's own backend to that tenant's own
 * authenticated requests, so a route can only ever point at the backend that advertised it. The
 * first tenant to advertise an identifier keeps it until it expires (identifiers are unguessable,
 * so nobody can pre-register someone else's). Routing is not authorization: the tenant backend
 * still enforces the share token / preview capability on every request.
 */
@injectable()
export class QaapTenantPreviewRouteTable {

    protected sqliteStore: QaapSqliteStore | undefined;
    protected readonly memory = new Map<string, QaapTenantPreviewRouteEntry>();

    record(route: QaapPreviewRoute, tenantLogin: string, now: number = Date.now()): boolean {
        const tenant = tenantLogin.trim();
        if (!tenant || !isQaapPreviewRouteId(route.kind, route.id) || !qaapPreviewRouteMatchesTenant(route, tenant)) {
            return false;
        }
        const key = this.key(route.kind, route.id);
        const existing = this.read(key, now);
        if (existing && existing.tenantLogin.toLowerCase() !== tenant.toLowerCase()) {
            console.warn('[qaap-preview-route] refused to re-point a live route to another tenant', { kind: route.kind, tenant });
            return false;
        }
        this.write(key, { tenantLogin: tenant, recordedAt: now, expiresAt: now + this.ttlMs() });
        return true;
    }

    resolve(kind: QaapPreviewRouteKind, rawId: string, now: number = Date.now()): string | undefined {
        // Preview ids are DNS labels: hosts may arrive in any case.
        const id = kind === 'preview' ? rawId.toLowerCase() : rawId;
        if (!isQaapPreviewRouteId(kind, id)) {
            return undefined;
        }
        return this.read(this.key(kind, id), now)?.tenantLogin;
    }

    protected key(kind: QaapPreviewRouteKind, id: string): string {
        // Preview ids are DNS labels (case-insensitive); share tokens are case-sensitive.
        return `${kind}:${kind === 'preview' ? id.toLowerCase() : id}`;
    }

    protected read(key: string, now: number): QaapTenantPreviewRouteEntry | undefined {
        let entry = this.memory.get(key);
        if (!entry) {
            entry = this.persistentGet(key);
            if (entry) {
                this.memory.set(key, entry);
            }
        }
        if (entry && entry.expiresAt <= now) {
            this.memory.delete(key);
            this.persistentDelete(key);
            return undefined;
        }
        return entry;
    }

    protected write(key: string, entry: QaapTenantPreviewRouteEntry): void {
        this.memory.set(key, entry);
        try {
            this.getSqliteStore().set(key, entry);
        } catch (error) {
            // Routing keeps working from memory; only restarts lose the entry.
            console.warn('[qaap-preview-route] could not persist route', String(error));
        }
    }

    protected persistentGet(key: string): QaapTenantPreviewRouteEntry | undefined {
        try {
            return this.getSqliteStore().get<QaapTenantPreviewRouteEntry>(key);
        } catch {
            return undefined;
        }
    }

    protected persistentDelete(key: string): void {
        try {
            this.getSqliteStore().delete(key);
        } catch {
            // best effort
        }
    }

    protected ttlMs(): number {
        const hours = Number.parseFloat(process.env.QAAP_PREVIEW_SHARE_TTL_HOURS?.trim() ?? '');
        // Outlive the longest share the backends may create.
        return Number.isFinite(hours) && hours > 0 ? Math.max(DEFAULT_ROUTE_TTL_MS, hours * 60 * 60_000) : DEFAULT_ROUTE_TTL_MS;
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: resolveQaapSqlitePath(STORE_PATH),
            namespace: 'tenant-preview-routes',
        });
    }
}
