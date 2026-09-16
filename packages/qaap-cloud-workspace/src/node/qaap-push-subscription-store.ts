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
        const all = await this.readAll();
        const key = subscription.endpoint;
        all[key] = {
            userLogin,
            subscription,
            createdAt: new Date().toISOString(),
        };
        await this.writeAll(all);
    }

    async listForUser(userLogin: string): Promise<StoredPushSubscription[]> {
        const all = await this.readAll();
        return Object.values(all).filter(row => row.userLogin === userLogin);
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

    protected async writeAll(data: Record<string, StoredPushSubscription>): Promise<void> {
        this.getSqliteStore().replace(Object.entries(data));
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: SQLITE_PATH,
            namespace: 'push-subscriptions',
            legacyPath: STORE_PATH,
        });
    }
}
