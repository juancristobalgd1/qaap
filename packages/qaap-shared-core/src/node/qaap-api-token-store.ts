// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as crypto from 'crypto';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { resolveQaapAuthStorePath } from './qaap-github-session-store';

/** Prefix of every personal API token, so callers (and secret scanners) can recognise one. */
export const QAAP_API_TOKEN_PREFIX = 'qaap_pat_';

/** What is persisted per token. The token itself is never stored, only its SHA-256. */
export interface QaapApiTokenRecord {
    readonly id: string;
    readonly ownerLogin: string;
    /** GitHub session the token acts for: signing out of that session revokes the token. */
    readonly sessionId: string;
    readonly label: string;
    readonly createdAt: number;
}

/** Public view of a token (never includes the secret or the session id). */
export interface QaapApiTokenSummary {
    readonly id: string;
    readonly label: string;
    readonly createdAt: number;
}

/**
 * Per-user personal API tokens for headless callers (scripts, other agents) of the Qaap HTTP API.
 * Stored in the auth SQLite database next to the GitHub sessions, keyed by token hash.
 */
@injectable()
export class QaapApiTokenStore {

    protected sqliteStore: QaapSqliteStore | undefined;

    /** Creates a token for the session's owner. The returned secret is shown to the user once. */
    create(ownerLogin: string, sessionId: string, label: string): { readonly token: string; readonly summary: QaapApiTokenSummary } {
        const token = `${QAAP_API_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
        const record: QaapApiTokenRecord = {
            id: crypto.randomUUID(),
            ownerLogin,
            sessionId,
            label: label.trim().slice(0, 100) || 'API token',
            createdAt: Date.now(),
        };
        this.getStore().set(this.keyFor(token), record);
        return { token, summary: this.summarize(record) };
    }

    /** Resolves a presented token, or `undefined` for anything unknown or malformed. */
    resolve(token: string | undefined): QaapApiTokenRecord | undefined {
        if (!token?.startsWith(QAAP_API_TOKEN_PREFIX) || token.length > 200) {
            return undefined;
        }
        return this.getStore().get<QaapApiTokenRecord>(this.keyFor(token));
    }

    list(ownerLogin: string): QaapApiTokenSummary[] {
        return this.ownedEntries(ownerLogin).map(([, record]) => this.summarize(record));
    }

    /** Revokes one of the owner's tokens; false when the id does not belong to them. */
    revoke(ownerLogin: string, id: string): boolean {
        const entry = this.ownedEntries(ownerLogin).find(([, record]) => record.id === id);
        return !!entry && this.getStore().delete(entry[0]);
    }

    protected ownedEntries(ownerLogin: string): ReadonlyArray<readonly [string, QaapApiTokenRecord]> {
        const owner = ownerLogin.toLowerCase();
        return this.getStore().list<QaapApiTokenRecord>()
            .filter(([, record]) => record.ownerLogin.toLowerCase() === owner);
    }

    protected summarize(record: QaapApiTokenRecord): QaapApiTokenSummary {
        return { id: record.id, label: record.label, createdAt: record.createdAt };
    }

    protected keyFor(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    protected getStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: resolveQaapSqlitePath(resolveQaapAuthStorePath()),
            namespace: 'api-tokens',
        });
    }
}
