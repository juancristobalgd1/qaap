// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAuthSessionUser } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { nls } from '@theia/core/lib/common';
import { QaapBetaAccessPolicy } from './qaap-beta-access-policy';

export interface QaapGithubStoredSession {
    accessToken: string;
    user: QaapAuthSessionUser;
}

interface PersistedState {
    version: number;
    sessions: Array<[string, QaapGithubStoredSession]>;
    oauthStates: Array<[string, number]>;
}

const STORE_SCHEMA_VERSION = 1;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 100;
const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** Docker/VPS: persist next to cloned repos on the mounted /workspace volume. */
export function resolveQaapAuthStorePath(): string {
    if (process.env.QAAP_AUTH_STORE_PATH?.trim()) {
        return process.env.QAAP_AUTH_STORE_PATH.trim();
    }
    const reposRoot = process.env.QAAP_REPOS_ROOT?.trim()
        || (process.env.NODE_ENV === 'production' ? '/workspace/repos' : path.join(os.homedir(), '.qaap', 'workspaces'));
    if (reposRoot.endsWith(`${path.sep}repos`)) {
        return path.join(path.dirname(reposRoot), '.qaap', 'auth', 'sessions.json');
    }
    return path.join(os.homedir(), '.qaap', 'auth', 'sessions.json');
}

/**
 * In-memory sessions + OAuth state map persisted to an embedded SQLite database
 * alongside the legacy `~/.qaap/auth/sessions.json` path.
 *
 * Persistence matters because the OAuth callback URL from GitHub can arrive
 * after the backend has restarted (very common during local dev). Without it,
 * either the OAuth `state` is rejected (state_lost) or the user appears
 * "signed out" right after the developer restarts `npm run start:browser`.
 */
@injectable()
export class QaapGithubSessionStore {

    protected readonly betaAccess = new QaapBetaAccessPolicy();

    protected readonly sessions = new Map<string, QaapGithubStoredSession>();
    protected readonly oauthStates = new Map<string, number>();
    protected readonly storePath: string = resolveQaapAuthStorePath();
    protected readonly sqlitePath: string = resolveQaapSqlitePath(this.storePath);
    protected sqliteStore: QaapSqliteStore | undefined;
    protected persistTimer: NodeJS.Timeout | undefined;
    protected loaded = false;
    protected shutdownHandlersInstalled = false;

    @postConstruct()
    protected init(): void {
        this.loadFromDisk();
        this.installShutdownHandlers();
    }

    createSession(data: QaapGithubStoredSession): string {
        if (!this.betaAccess.allows(data.user.login)) {
            throw new Error(nls.localize('qaap/beta/invitationRequired', 'This account is not invited to the Qaap beta.'));
        }
        const id = crypto.randomUUID();
        this.sessions.set(id, data);
        this.schedulePersist();
        return id;
    }

    getSession(sessionId: string | undefined): QaapGithubStoredSession | undefined {
        if (!sessionId) {
            return undefined;
        }
        const session = this.sessions.get(sessionId);
        return session && this.betaAccess.allows(session.user.login) ? session : undefined;
    }

    /** All persisted sessions — for server-side repository access resolution only. */
    listSessions(): QaapGithubStoredSession[] {
        return [...this.sessions.values()].filter(session => this.betaAccess.allows(session.user.login));
    }

    /** @deprecated Never use for request handling — leaks cross-tenant tokens. */
    getAnySession(): QaapGithubStoredSession | undefined {
        return this.listSessions()[0];
    }

    deleteSession(sessionId: string | undefined): void {
        if (sessionId && this.sessions.delete(sessionId)) {
            this.schedulePersist();
        }
    }

    createOAuthState(): string {
        const state = crypto.randomUUID();
        this.oauthStates.set(state, Date.now());
        this.pruneOAuthStates();
        this.schedulePersist();
        return state;
    }

    consumeOAuthState(state: string | undefined): boolean {
        this.pruneOAuthStates();
        if (!state || !this.oauthStates.has(state)) {
            return false;
        }
        this.oauthStates.delete(state);
        this.schedulePersist();
        return true;
    }

    protected pruneOAuthStates(): void {
        const now = Date.now();
        let removed = false;
        for (const [state, created] of this.oauthStates.entries()) {
            if (now - created > OAUTH_STATE_MAX_AGE_MS) {
                this.oauthStates.delete(state);
                removed = true;
            }
        }
        if (removed) {
            this.schedulePersist();
        }
    }

    protected loadFromDisk(): void {
        try {
            const store = this.getSqliteStore();
            try {
                store.migrateLegacy(this.parseLegacyState.bind(this));
            } catch (error) {
                // Preserve the previous JSON store's primary/backup recovery behavior.
                console.warn(`[qaap-auth] Could not read session store at ${this.storePath}:`, error);
                const backupPath = `${this.storePath}.bak`;
                if (fs.existsSync(backupPath)) {
                    try {
                        store.migrateLegacy(this.parseLegacyState.bind(this), backupPath);
                    } catch (backupError) {
                        console.warn(`[qaap-auth] Could not read session store backup at ${backupPath}:`, backupError);
                    }
                }
            }
            for (const [key, value] of store.list<QaapGithubStoredSession | number>()) {
                if (key.startsWith('session:') && this.isValidSession(value)) {
                    this.sessions.set(key.slice('session:'.length), value);
                } else if (key.startsWith('oauth:') && typeof value === 'number') {
                    if (Date.now() - value <= OAUTH_STATE_MAX_AGE_MS) {
                        this.oauthStates.set(key.slice('oauth:'.length), value);
                    }
                }
            }
        } catch (error) {
            console.warn('[qaap-auth] Could not restore SQLite session store:', error);
        }
        this.loaded = true;
    }

    protected parseLegacyState(raw: string): Array<[string, QaapGithubStoredSession | number]> {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (typeof parsed.version === 'number' && parsed.version > STORE_SCHEMA_VERSION) {
            throw new Error(`Session store has newer schema v${parsed.version}`);
        }
        const entries: Array<[string, QaapGithubStoredSession | number]> = [];
        for (const entry of parsed.sessions ?? []) {
            if (this.isValidSessionEntry(entry)) {
                entries.push([`session:${entry[0]}`, entry[1]]);
            }
        }
        for (const entry of parsed.oauthStates ?? []) {
            if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number'
                && Date.now() - entry[1] <= OAUTH_STATE_MAX_AGE_MS) {
                entries.push([`oauth:${entry[0]}`, entry[1]]);
            }
        }
        return entries;
    }

    protected isValidSession(value: unknown): value is QaapGithubStoredSession {
        const session = value as Partial<QaapGithubStoredSession> | undefined;
        return !!session && typeof session.accessToken === 'string'
            && !!session.user && typeof session.user.login === 'string';
    }

    protected isValidSessionEntry(entry: unknown): entry is [string, QaapGithubStoredSession] {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
            return false;
        }
        const value = entry[1] as Partial<QaapGithubStoredSession> | undefined;
        return !!value
            && typeof value.accessToken === 'string'
            && !!value.user
            && typeof value.user.login === 'string';
    }

    protected schedulePersist(): void {
        if (!this.loaded) {
            return;
        }
        if (this.persistTimer !== undefined) {
            return;
        }
        this.persistTimer = setTimeout(() => {
            this.persistTimer = undefined;
            this.persistNow();
        }, PERSIST_DEBOUNCE_MS);
        // Allow Node to exit even if a flush is still scheduled.
        this.persistTimer.unref?.();
    }

    /**
     * Flush any pending debounced write immediately. Safe to call multiple times
     * and from shutdown signal handlers — used to guarantee that a session created
     * just before a VPS restart is not lost in the debounce window.
     */
    flushPendingPersist(): void {
        if (this.persistTimer !== undefined) {
            clearTimeout(this.persistTimer);
            this.persistTimer = undefined;
            this.persistNow();
        }
    }

    protected persistNow(): void {
        try {
            const entries: Array<readonly [string, QaapGithubStoredSession | number]> = [
                ...[...this.sessions.entries()].map(([id, session]) => [`session:${id}`, session] as const),
                ...[...this.oauthStates.entries()].map(([state, createdAt]) => [`oauth:${state}`, createdAt] as const),
            ];
            this.getSqliteStore().replace(entries);
        } catch (err) {
            console.warn('[qaap-auth] Could not persist session store:', err);
        }
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: this.sqlitePath,
            namespace: 'github-sessions',
            legacyPath: this.storePath,
        });
    }

    protected installShutdownHandlers(): void {
        if (this.shutdownHandlersInstalled) {
            return;
        }
        this.shutdownHandlersInstalled = true;
        const flush = (): void => {
            try {
                this.flushPendingPersist();
            } catch (err) {
                console.warn('[qaap-auth] Error flushing session store on shutdown:', err);
            }
        };
        process.on('beforeExit', flush);
        process.on('exit', flush);
        for (const signal of SHUTDOWN_SIGNALS) {
            process.on(signal, () => {
                flush();
                // Do not exit here — other shutdown logic may still need to run.
                // If we are the only handler, Node will exit normally after this tick.
            });
        }
    }
}
