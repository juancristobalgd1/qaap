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
    /** Records without it (first version) expire {@link QAAP_API_TOKEN_DEFAULT_TTL_DAYS} after creation. */
    readonly expiresAt?: number;
}

/** Public view of a token (never includes the secret or the session id). */
export interface QaapApiTokenSummary {
    readonly id: string;
    readonly label: string;
    readonly createdAt: number;
    readonly expiresAt: number;
}

export const QAAP_API_TOKEN_DEFAULT_TTL_DAYS = 30;
export const QAAP_API_TOKEN_MAX_TTL_DAYS = 90;
/** Live tokens per user; minting more is refused until one is revoked or expires. */
export const QAAP_API_TOKEN_MAX_PER_USER = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-user personal API tokens for headless callers (scripts, other agents) of the Qaap HTTP API.
 * Stored in the auth SQLite database next to the GitHub sessions, keyed by token hash.
 */
@injectable()
export class QaapApiTokenStore {

    protected sqliteStore: QaapSqliteStore | undefined;

    /**
     * Creates a token for the session's owner, valid for `ttlDays` (default 30, at most 90). The
     * returned secret is shown to the user once. `undefined` when the owner already has the maximum
     * number of live tokens.
     */
    create(ownerLogin: string, sessionId: string, label: string, ttlDays = QAAP_API_TOKEN_DEFAULT_TTL_DAYS, now = Date.now()):
        { readonly token: string; readonly summary: QaapApiTokenSummary } | undefined {
        if (this.ownedEntries(ownerLogin, now).length >= QAAP_API_TOKEN_MAX_PER_USER) {
            return undefined;
        }
        const days = Number.isFinite(ttlDays) ? Math.min(QAAP_API_TOKEN_MAX_TTL_DAYS, Math.max(1, Math.floor(ttlDays))) : QAAP_API_TOKEN_DEFAULT_TTL_DAYS;
        const token = `${QAAP_API_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
        const record: QaapApiTokenRecord = {
            id: crypto.randomUUID(),
            ownerLogin,
            sessionId,
            label: label.trim().slice(0, 100) || 'API token',
            createdAt: now,
            expiresAt: now + days * DAY_MS,
        };
        this.getStore().set(this.keyFor(token), record);
        return { token, summary: this.summarize(record) };
    }

    /** Resolves a presented token, or `undefined` for anything unknown, malformed or expired. */
    resolve(token: string | undefined, now = Date.now()): QaapApiTokenRecord | undefined {
        if (!token?.startsWith(QAAP_API_TOKEN_PREFIX) || token.length > 200) {
            return undefined;
        }
        const key = this.keyFor(token);
        const record = this.getStore().get<QaapApiTokenRecord>(key);
        if (record && this.expiresAt(record) <= now) {
            this.getStore().delete(key);
            return undefined;
        }
        return record;
    }

    list(ownerLogin: string, now = Date.now()): QaapApiTokenSummary[] {
        return this.ownedEntries(ownerLogin, now).map(([, record]) => this.summarize(record));
    }

    /** Revokes one of the owner's tokens; false when the id does not belong to them. */
    revoke(ownerLogin: string, id: string): boolean {
        const entry = this.ownedEntries(ownerLogin).find(([, record]) => record.id === id);
        return !!entry && this.getStore().delete(entry[0]);
    }

    /** Deletes every token acting for `sessionId` (sign-out, replaced session). Returns how many. */
    revokeForSession(sessionId: string | undefined): number {
        if (!sessionId) {
            return 0;
        }
        return this.getStore().list<QaapApiTokenRecord>()
            .filter(([key, record]) => record.sessionId === sessionId && this.getStore().delete(key))
            .length;
    }

    /**
     * Deletes the owner's tokens whose GitHub session no longer exists (signed out elsewhere, removed
     * from the store), so they stop counting toward {@link QAAP_API_TOKEN_MAX_PER_USER} and are not
     * listed as live. A dead token never authenticates either way. Returns how many were deleted.
     */
    revokeWithoutSession(ownerLogin: string, hasSession: (sessionId: string) => boolean, now = Date.now()): number {
        return this.ownedEntries(ownerLogin, now)
            .filter(([key, record]) => !hasSession(record.sessionId) && this.getStore().delete(key))
            .length;
    }

    /** The owner's live tokens; expired ones met on the way are deleted. */
    protected ownedEntries(ownerLogin: string, now = Date.now()): ReadonlyArray<readonly [string, QaapApiTokenRecord]> {
        const owner = ownerLogin.toLowerCase();
        return this.getStore().list<QaapApiTokenRecord>()
            .filter(([key, record]) => {
                if (record.ownerLogin.toLowerCase() !== owner) {
                    return false;
                }
                if (this.expiresAt(record) <= now) {
                    this.getStore().delete(key);
                    return false;
                }
                return true;
            });
    }

    protected expiresAt(record: QaapApiTokenRecord): number {
        return record.expiresAt ?? record.createdAt + QAAP_API_TOKEN_DEFAULT_TTL_DAYS * DAY_MS;
    }

    protected summarize(record: QaapApiTokenRecord): QaapApiTokenSummary {
        return { id: record.id, label: record.label, createdAt: record.createdAt, expiresAt: this.expiresAt(record) };
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
