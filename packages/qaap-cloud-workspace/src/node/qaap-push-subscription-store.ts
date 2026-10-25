// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapPushSubscriptionJson } from '../common/qaap-cloud-api-types';

const STORE_PATH = path.join(os.homedir(), '.qaap', 'push-subscriptions.json');
const SQLITE_PATH = resolveQaapSqlitePath(STORE_PATH);

export interface StoredPushSubscription {
    readonly userLogin: string;
    readonly subscription: QaapPushSubscriptionJson;
    readonly createdAt: string;
}

@injectable()
export class QaapPushSubscriptionStore {

    protected sqliteStore: QaapSqliteStore | undefined;

    async upsert(userLogin: string, subscription: QaapPushSubscriptionJson): Promise<void> {
        // Reading first runs the one-time legacy import, so a later per-key write cannot be overwritten by it.
        await this.readAll();
        this.getSqliteStore().set<StoredPushSubscription>(subscription.endpoint, {
            // Logins are compared case-insensitively: the tenant side names owners in lower case.
            userLogin: userLogin.toLowerCase(),
            subscription,
            createdAt: new Date().toISOString(),
        });
    }

    /** Forgets one subscription (the push service reported it gone). */
    async remove(endpoint: string): Promise<void> {
        await this.readAll();
        this.getSqliteStore().delete(endpoint);
    }

    async listForUser(userLogin: string): Promise<StoredPushSubscription[]> {
        const all = await this.readAll();
        return Object.values(all).filter(row => row.userLogin.toLowerCase() === userLogin.toLowerCase());
    }

    async listAll(): Promise<StoredPushSubscription[]> {
        return Object.values(await this.readAll());
    }

    protected async readAll(): Promise<Record<string, StoredPushSubscription>> {
        try {
            const store = this.getSqliteStore();
            try {
                store.migrateLegacy<StoredPushSubscription>(raw => {
                    const parsed = JSON.parse(raw) as Record<string, StoredPushSubscription>;
                    return Object.entries(parsed && typeof parsed === 'object' ? parsed : {});
                });
            } catch {
                // A malformed legacy file must not hide valid SQLite state.
            }
            return Object.fromEntries(store.list<StoredPushSubscription>());
        } catch {
            return {};
        }
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: SQLITE_PATH,
            namespace: 'push-subscriptions',
            legacyPath: STORE_PATH,
        });
    }
}
