// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';

/** One owner's container memory choice for one repository. */
export interface QaapProjectResourceChoice {
    readonly login: string;
    /** Lower-case `owner/name`. */
    readonly repo: string;
    readonly memoryGb: number;
    readonly updatedAt: string;
}

/** Keys join login and repository with `|`, a character neither a GitHub login nor a repository name can hold. */
const KEY_SEPARATOR = '|';

/**
 * Per owner and repository container memory (Gitpod-style per-project resources). Stored in SQLite
 * (namespace `project-resources`); the path follows `QAAP_PROJECT_RESOURCES_STORE_PATH`, else
 * `~/.qaap/project-resources.json`, whose sibling `.sqlite` file holds the data.
 */
@injectable()
export class QaapProjectResourcesStore {

    protected filePath = process.env.QAAP_PROJECT_RESOURCES_STORE_PATH?.trim()
        || path.join(os.homedir(), '.qaap', 'project-resources.json');
    protected sqliteStore: QaapSqliteStore | undefined;

    /** Lower-cases and trims a login; the same rule as the billing store. */
    static normalizeLogin(login: string): string {
        return login.trim().toLowerCase();
    }

    /** `owner/name` in lower case, or `undefined` when the value is not a plausible GitHub repository. */
    static normalizeRepo(raw: string | undefined): string | undefined {
        const value = raw?.trim().toLowerCase() ?? '';
        return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(value) && !/^\.+$/.test(value.split('/')[1]) ? value : undefined;
    }

    get(login: string, repo: string): QaapProjectResourceChoice | undefined {
        return this.getSqliteStore().get<QaapProjectResourceChoice>(this.key(login, repo));
    }

    set(login: string, repo: string, memoryGb: number, now: Date = new Date()): QaapProjectResourceChoice {
        const choice: QaapProjectResourceChoice = {
            login: QaapProjectResourcesStore.normalizeLogin(login),
            repo: repo.trim().toLowerCase(),
            memoryGb,
            updatedAt: now.toISOString(),
        };
        this.getSqliteStore().set(this.key(login, repo), choice);
        return choice;
    }

    /** Every saved choice of `login`; an owner's tenant takes the largest of these. */
    listForOwner(login: string): QaapProjectResourceChoice[] {
        const prefix = `${QaapProjectResourcesStore.normalizeLogin(login)}${KEY_SEPARATOR}`;
        return this.getSqliteStore().list<QaapProjectResourceChoice>()
            .filter(([key]) => key.startsWith(prefix))
            .map(([, value]) => value);
    }

    protected key(login: string, repo: string): string {
        return `${QaapProjectResourcesStore.normalizeLogin(login)}${KEY_SEPARATOR}${repo.trim().toLowerCase()}`;
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: resolveQaapSqlitePath(this.filePath),
            namespace: 'project-resources',
        });
    }
}
