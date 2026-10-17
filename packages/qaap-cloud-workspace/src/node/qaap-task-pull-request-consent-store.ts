// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { INDEX_PATH } from './qaap-agent-conversation-store-constants';

/** One user's answer for one repository. */
export interface QaapTaskPullRequestConsent {
    readonly login: string;
    readonly repository: string;
    readonly allowedAt: number;
}

/**
 * One-time consent, per user and per GitHub repository, for Qaap to push task branches and open pull
 * requests there (doc/qaap-task-to-pr.md). Kept server-side in the conversation store's SQLite file
 * (`~/.qaap/agent-conversations`, namespace `task-pr-consent`), owner-scoped by login. Until it exists
 * the task pull request service pushes nothing and asks instead.
 */
@injectable()
export class QaapTaskPullRequestConsentStore {

    protected sqliteStore: QaapSqliteStore | undefined;

    isAllowed(login: string, owner: string, repo: string): boolean {
        return !!this.getStore().get<QaapTaskPullRequestConsent>(this.key(login, owner, repo));
    }

    allow(login: string, owner: string, repo: string, now: number = Date.now()): QaapTaskPullRequestConsent {
        const consent: QaapTaskPullRequestConsent = { login: login.toLowerCase(), repository: `${owner}/${repo}`.toLowerCase(), allowedAt: now };
        this.getStore().set(this.key(login, owner, repo), consent);
        return consent;
    }

    revoke(login: string, owner: string, repo: string): void {
        this.getStore().delete(this.key(login, owner, repo));
    }

    /** Closes the database connection (Windows cannot delete an open SQLite file); the next call reopens it. */
    close(): void {
        this.sqliteStore?.close();
    }

    protected key(login: string, owner: string, repo: string): string {
        return `${login.trim().toLowerCase()}:${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
    }

    protected databasePath(): string {
        return resolveQaapSqlitePath(INDEX_PATH);
    }

    protected getStore(): QaapSqliteStore {
        if (!this.sqliteStore) {
            const databasePath = this.databasePath();
            fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
            this.sqliteStore = new QaapSqliteStore({ databasePath, namespace: 'task-pr-consent' });
        }
        return this.sqliteStore;
    }
}
