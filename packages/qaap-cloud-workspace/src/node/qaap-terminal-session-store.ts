// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type {
    QaapTerminalSessionRecord,
    QaapTerminalSessionsUpsertRequest,
} from '../common/qaap-cloud-api-types';

const STORE_PATH = path.join(os.homedir(), '.qaap', 'terminal-sessions.json');
const SQLITE_PATH = resolveQaapSqlitePath(STORE_PATH);

@injectable()
export class QaapTerminalSessionStore {

    protected sqliteStore: QaapSqliteStore | undefined;

    async get(workspaceKey: string, ownerLogin?: string): Promise<QaapTerminalSessionRecord[]> {
        const all = await this.readAll();
        const entry = all[this.storageKey(workspaceKey, ownerLogin)];
        if (!entry) {
            return [];
        }
        if (ownerLogin && entry.ownerLogin !== ownerLogin) {
            return [];
        }
        return entry.terminals ?? [];
    }

    async upsert(request: QaapTerminalSessionsUpsertRequest, ownerLogin?: string): Promise<void> {
        const all = await this.readAll();
        all[this.storageKey(request.workspaceKey, ownerLogin)] = {
            updatedAt: new Date().toISOString(),
            terminals: request.terminals,
            ...(ownerLogin ? { ownerLogin } : {}),
        };
        await this.writeAll(all);
    }

    protected storageKey(workspaceKey: string, ownerLogin?: string): string {
        const owner = ownerLogin?.trim().toLowerCase();
        return owner ? `user:${encodeURIComponent(owner)}:${workspaceKey}` : workspaceKey;
    }

    protected async readAll(): Promise<Record<string, { updatedAt: string; terminals: QaapTerminalSessionRecord[]; ownerLogin?: string }>> {
        try {
            const store = this.getSqliteStore();
            try {
                store.migrateLegacy<{ updatedAt: string; terminals: QaapTerminalSessionRecord[]; ownerLogin?: string }>(raw => {
                    const parsed = JSON.parse(raw) as Record<string, { updatedAt: string; terminals: QaapTerminalSessionRecord[]; ownerLogin?: string }>;
                    return Object.entries(parsed && typeof parsed === 'object' ? parsed : {});
                });
            } catch {
                // A malformed legacy file must not hide valid SQLite state.
            }
            return Object.fromEntries(store.list<{ updatedAt: string; terminals: QaapTerminalSessionRecord[]; ownerLogin?: string }>());
        } catch {
            return {};
        }
    }

    protected async writeAll(
        data: Record<string, { updatedAt: string; terminals: QaapTerminalSessionRecord[]; ownerLogin?: string }>,
    ): Promise<void> {
        this.getSqliteStore().replace(Object.entries(data));
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: SQLITE_PATH,
            namespace: 'terminal-sessions',
            legacyPath: STORE_PATH,
        });
    }
}
