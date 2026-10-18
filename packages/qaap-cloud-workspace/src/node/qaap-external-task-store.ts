// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { INDEX_PATH } from './qaap-agent-conversation-store-constants';

/** How long a delivery id is remembered (GitHub redelivers within hours, by hand within days). */
export const QAAP_EXTERNAL_TASK_DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

interface DeliveryRecord {
    readonly at: number;
}

interface IssueRecord {
    readonly conversationId: string;
    readonly at: number;
}

/** Statuses already told to the origin (issue comment + push), so each is told once. */
export interface QaapExternalTaskNotifiedRecord {
    readonly statuses: readonly string[];
}

/**
 * Durable state of tasks started from outside the app, in the backend that owns the conversations
 * (doc/qaap-external-task-inputs.md): the authority for delivery dedup, the one-conversation-per-issue
 * key and which statuses were already posted back. Calls are synchronous SQLite, so a check-and-set
 * below cannot interleave with another delivery in this process.
 */
@injectable()
export class QaapExternalTaskStore {

    protected sqliteStore: QaapSqliteStore | undefined;
    protected claimsSincePrune = 0;

    /** `true` the first time `deliveryId` is seen within {@link QAAP_EXTERNAL_TASK_DELIVERY_TTL_MS}. */
    claimDelivery(deliveryId: string, now: number = Date.now()): boolean {
        const key = `delivery:${deliveryId}`;
        const store = this.getStore();
        const seen = store.get<DeliveryRecord>(key);
        if (seen && now - seen.at < QAAP_EXTERNAL_TASK_DELIVERY_TTL_MS) {
            return false;
        }
        store.set<DeliveryRecord>(key, { at: now });
        if (++this.claimsSincePrune >= 100) {
            this.claimsSincePrune = 0;
            this.pruneDeliveries(now);
        }
        return true;
    }

    /** The conversation an issue already started, if any. */
    conversationForIssue(source: string, repositoryId: number, issueNumber: number): string | undefined {
        return this.getStore().get<IssueRecord>(this.issueKey(source, repositoryId, issueNumber))?.conversationId;
    }

    /** Binds an issue to its conversation; `false` when another conversation already holds it. */
    bindIssue(source: string, repositoryId: number, issueNumber: number, conversationId: string, now: number = Date.now()): boolean {
        const key = this.issueKey(source, repositoryId, issueNumber);
        const store = this.getStore();
        const existing = store.get<IssueRecord>(key);
        if (existing && existing.conversationId !== conversationId) {
            return false;
        }
        store.set<IssueRecord>(key, { conversationId, at: now });
        return true;
    }

    unbindIssue(source: string, repositoryId: number, issueNumber: number): void {
        this.getStore().delete(this.issueKey(source, repositoryId, issueNumber));
    }

    /** Records `status` for `conversationId`; `false` when it was already recorded. */
    markNotified(conversationId: string, status: string): boolean {
        const key = `notified:${conversationId}`;
        const store = this.getStore();
        const statuses = store.get<QaapExternalTaskNotifiedRecord>(key)?.statuses ?? [];
        if (statuses.includes(status)) {
            return false;
        }
        store.set<QaapExternalTaskNotifiedRecord>(key, { statuses: [...statuses, status].slice(-50) });
        return true;
    }

    /** Closes the database connection (Windows cannot delete an open SQLite file); the next call reopens it. */
    close(): void {
        this.sqliteStore?.close();
    }

    protected pruneDeliveries(now: number): void {
        const store = this.getStore();
        for (const [key, value] of store.list<DeliveryRecord>()) {
            if (key.startsWith('delivery:') && now - (value?.at ?? 0) >= QAAP_EXTERNAL_TASK_DELIVERY_TTL_MS) {
                store.delete(key);
            }
        }
    }

    protected issueKey(source: string, repositoryId: number, issueNumber: number): string {
        return `issue:${source}:${repositoryId}#${issueNumber}`;
    }

    protected databasePath(): string {
        return resolveQaapSqlitePath(INDEX_PATH);
    }

    protected getStore(): QaapSqliteStore {
        if (!this.sqliteStore) {
            const databasePath = this.databasePath();
            fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
            this.sqliteStore = new QaapSqliteStore({ databasePath, namespace: 'external-tasks' });
        }
        return this.sqliteStore;
    }
}
