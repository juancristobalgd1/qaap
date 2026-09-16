// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
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

export interface QaapTenantRuntimeRecord extends QaapTenantRuntimeStatus {
    readonly updatedAt: string;
    readonly lastActivityReason?: QaapTenantActivityReason;
}

export type QaapTenantRuntimePatch = Partial<Omit<QaapTenantRuntimeRecord, 'tenantLogin' | 'updatedAt'>>;

export function canonicalQaapTenantLogin(ownerLogin: string): string {
    const login = ownerLogin.trim().toLowerCase();
    return login || '_dev';
}

/** Durable lifecycle metadata. Container data remains in the existing tenant-owned mounts. */
@injectable()
export class QaapTenantRuntimeStore {

    protected sqliteStore: QaapSqliteStore | undefined;

    get(ownerLogin: string): QaapTenantRuntimeRecord | undefined {
        return this.getStore().get<QaapTenantRuntimeRecord>(canonicalQaapTenantLogin(ownerLogin));
    }

    list(): QaapTenantRuntimeRecord[] {
        return this.getStore().list<QaapTenantRuntimeRecord>().map(([, value]) => value);
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
        this.getStore().set(tenantLogin, record);
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
        this.getStore().set(tenantLogin, record);
        return record;
    }

    protected getStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: SQLITE_PATH,
            namespace: NAMESPACE,
            legacyPath: LEGACY_PATH,
        });
    }
}
