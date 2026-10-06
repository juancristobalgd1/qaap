// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';

/**
 * "Read up to" marks of agent conversations, one SQLite namespace per user login so a user's
 * marks can be listed without scanning anyone else's. Values are server-clock milliseconds and
 * only move forward: a stale tab can never make a read task unread again.
 */
@injectable()
export class QaapConversationReadMarkStore {

    protected readonly sqliteStores = new Map<string, QaapSqliteStore>();

    /** Conversation id → read mark for the user. */
    list(userLogin: string | undefined): Record<string, number> {
        const marks: Record<string, number> = {};
        try {
            for (const [conversationId, readAt] of this.getSqliteStore(userLogin).list<number>()) {
                if (typeof readAt === 'number' && readAt > 0) {
                    marks[conversationId] = readAt;
                }
            }
        } catch (error) {
            console.warn('[qaap-read-marks] read failed:', error instanceof Error ? error.message : String(error));
        }
        return marks;
    }

    /**
     * Records the conversation as read at `readAt` (default now, never later than now) and returns
     * the resulting mark, which is never lower than the previous one.
     */
    markRead(userLogin: string | undefined, conversationId: string, readAt?: number, now = Date.now()): number {
        const store = this.getSqliteStore(userLogin);
        const requested = readAt === undefined || !Number.isFinite(readAt) ? now : Math.min(readAt, now);
        const current = store.get<number>(conversationId) ?? 0;
        if (requested <= current) {
            return current;
        }
        store.set(conversationId, requested);
        return requested;
    }

    protected resolveDatabasePath(): string {
        return resolveQaapSqlitePath(path.join(os.homedir(), '.qaap', 'conversation-read-marks.json'));
    }

    protected getSqliteStore(userLogin: string | undefined): QaapSqliteStore {
        const namespace = `conversation-read-marks:${userLogin ?? ''}`;
        let store = this.sqliteStores.get(namespace);
        if (!store) {
            store = new QaapSqliteStore({ databasePath: this.resolveDatabasePath(), namespace });
            this.sqliteStores.set(namespace, store);
        }
        return store;
    }
}
