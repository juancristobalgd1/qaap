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
/**
 * How long an in-memory session (positive) or a known-missing session id (negative) is trusted
 * before re-checking the shared SQLite file. Bounds how quickly logins/logouts made by another
 * backend process sharing the store become visible here, without a SQLite read per request.
 */
const SESSION_SYNC_TTL_MS = 5000;
const MISSING_SESSION_CACHE_MAX = 1000;
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
    /**
     * Keys changed since the last flush (`undefined` = delete). Persistence is per key because
     * several backends (main + tenant backends) share the same SQLite file: rewriting the whole
     * namespace would wipe sessions/OAuth states another process just created (`state_lost`).
     */
    protected readonly dirtyKeys = new Map<string, QaapGithubStoredSession | number | undefined>();
    /** Session id -> last time it was confirmed against SQLite. */
    protected readonly sessionCheckedAt = new Map<string, number>();
    /** Negative cache: session id -> time until which it is known to be missing from SQLite. */
    protected readonly missingSessions = new Map<string, number>();
    protected sessionsListSyncedAt = 0;
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
        this.sessionCheckedAt.set(id, Date.now());
        this.missingSessions.delete(id);
        this.markDirty(`session:${id}`, data);
        this.schedulePersist();
        return id;
    }

    getSession(sessionId: string | undefined): QaapGithubStoredSession | undefined {
        if (!sessionId) {
            return undefined;
        }
        const session = this.resolveSession(sessionId);
        return session && this.betaAccess.allows(session.user.login) ? session : undefined;
    }

    /** All persisted sessions — for server-side repository access resolution only. */
    listSessions(): QaapGithubStoredSession[] {
        this.syncSessionsFromStore();
        return [...this.sessions.values()].filter(session => this.betaAccess.allows(session.user.login));
    }

    deleteSession(sessionId: string | undefined): void {
        if (!sessionId) {
            return;
        }
        const key = `session:${sessionId}`;
        this.sessions.delete(sessionId);
        this.sessionCheckedAt.delete(sessionId);
        this.rememberMissingSession(sessionId, Date.now());
        this.dirtyKeys.delete(key);
        // Deleted per key and immediately (even if this process never cached the session) so a
        // logout propagates to every backend process sharing the SQLite file.
        this.deleteKeyNow(key);
    }

    /**
     * Looks a session up in memory, falling back to (and periodically revalidating against) the
     * shared SQLite file: another backend process may have created or deleted it after this
     * process loaded the store. Sessions carry no expiry of their own; GitHub token validity is
     * checked by the auth guard.
     */
    protected resolveSession(sessionId: string): QaapGithubStoredSession | undefined {
        const key = `session:${sessionId}`;
        const cached = this.sessions.get(sessionId);
        // A local write not yet flushed is authoritative; without persistence memory is all we have.
        if (!this.loaded || this.dirtyKeys.has(key)) {
            return cached;
        }
        const now = Date.now();
        if (cached) {
            if (now - (this.sessionCheckedAt.get(sessionId) ?? 0) < SESSION_SYNC_TTL_MS) {
                return cached;
            }
        } else {
            const missingUntil = this.missingSessions.get(sessionId);
            if (missingUntil !== undefined && missingUntil > now) {
                return undefined;
            }
        }
        const persisted = this.readPersistedSession(key);
        if (persisted === 'unavailable') {
            return cached;
        }
        if (persisted) {
            this.sessions.set(sessionId, persisted);
            this.sessionCheckedAt.set(sessionId, now);
            this.missingSessions.delete(sessionId);
            return persisted;
        }
        this.sessions.delete(sessionId);
        this.sessionCheckedAt.delete(sessionId);
        this.rememberMissingSession(sessionId, now);
        return undefined;
    }

    protected readPersistedSession(key: string): QaapGithubStoredSession | undefined | 'unavailable' {
        try {
            const value = this.getSqliteStore().get<unknown>(key);
            return this.isValidSession(value) ? value : undefined;
        } catch (error) {
            console.warn('[qaap-auth] Could not read persisted session:', error);
            return 'unavailable';
        }
    }

    protected rememberMissingSession(sessionId: string, now: number): void {
        if (this.missingSessions.size >= MISSING_SESSION_CACHE_MAX) {
            for (const [id, until] of this.missingSessions) {
                if (until <= now) {
                    this.missingSessions.delete(id);
                }
            }
            if (this.missingSessions.size >= MISSING_SESSION_CACHE_MAX) {
                // Map iteration order is insertion order: drop the oldest entry.
                const oldest = this.missingSessions.keys().next().value;
                if (oldest !== undefined) {
                    this.missingSessions.delete(oldest);
                }
            }
        }
        this.missingSessions.delete(sessionId);
        this.missingSessions.set(sessionId, now + SESSION_SYNC_TTL_MS);
    }

    /** Re-reads every session from SQLite (rate limited) so listings include other processes' changes. */
    protected syncSessionsFromStore(): void {
        const now = Date.now();
        if (!this.loaded || now - this.sessionsListSyncedAt < SESSION_SYNC_TTL_MS) {
            return;
        }
        let entries: Array<readonly [string, unknown]>;
        try {
            entries = this.getSqliteStore().list<unknown>();
        } catch (error) {
            console.warn('[qaap-auth] Could not list persisted sessions:', error);
            return;
        }
        this.sessionsListSyncedAt = now;
        const persistedIds = new Set<string>();
        for (const [key, value] of entries) {
            if (!key.startsWith('session:') || this.dirtyKeys.has(key) || !this.isValidSession(value)) {
                continue;
            }
            const id = key.slice('session:'.length);
            persistedIds.add(id);
            this.sessions.set(id, value);
            this.sessionCheckedAt.set(id, now);
            this.missingSessions.delete(id);
        }
        for (const id of [...this.sessions.keys()]) {
            if (!persistedIds.has(id) && !this.dirtyKeys.has(`session:${id}`)) {
                this.sessions.delete(id);
                this.sessionCheckedAt.delete(id);
            }
        }
    }

    createOAuthState(): string {
        const state = crypto.randomUUID();
        const createdAt = Date.now();
        this.oauthStates.set(state, createdAt);
        this.pruneOAuthStates();
        // Written immediately (not debounced): the GitHub callback may be served by another
        // backend process sharing this store before the debounce window elapses.
        this.writeKeyNow(`oauth:${state}`, createdAt);
        return state;
    }

    consumeOAuthState(state: string | undefined): boolean {
        this.pruneOAuthStates();
        if (!state) {
            return false;
        }
        const key = `oauth:${state}`;
        const inMemory = this.oauthStates.delete(state);
        // Persistence not loaded, or never written to SQLite yet (write failed and is pending a
        // retry): memory is authoritative.
        const pendingWrite = this.dirtyKeys.get(key) !== undefined;
        this.dirtyKeys.delete(key);
        let valid: boolean;
        if (pendingWrite || !this.loaded) {
            valid = inMemory;
        } else {
            // SQLite is the source of truth shared by every backend process: the state may have
            // been created by another process (or before a restart), or already consumed by one.
            const persisted = this.readPersistedOAuthState(key);
            valid = persisted === 'unavailable'
                ? inMemory
                : persisted !== undefined && Date.now() - persisted <= OAUTH_STATE_MAX_AGE_MS;
        }
        // Delete synchronously so the same state cannot be replayed through another process.
        this.deleteKeyNow(key);
        return valid;
    }

    protected readPersistedOAuthState(key: string): number | undefined | 'unavailable' {
        try {
            const value = this.getSqliteStore().get<unknown>(key);
            return typeof value === 'number' ? value : undefined;
        } catch (error) {
            console.warn('[qaap-auth] Could not read persisted OAuth state:', error);
            return 'unavailable';
        }
    }

    protected markDirty(key: string, value: QaapGithubStoredSession | number | undefined): void {
        this.dirtyKeys.set(key, value);
    }

    protected writeKeyNow(key: string, value: QaapGithubStoredSession | number): void {
        if (!this.loaded) {
            return;
        }
        try {
            this.getSqliteStore().set(key, value);
        } catch (error) {
            console.warn('[qaap-auth] Could not persist session store key:', error);
            this.markDirty(key, value);
            this.schedulePersist();
        }
    }

    protected deleteKeyNow(key: string): void {
        if (!this.loaded) {
            return;
        }
        try {
            this.getSqliteStore().delete(key);
        } catch (error) {
            console.warn('[qaap-auth] Could not delete session store key:', error);
            this.markDirty(key, undefined);
            this.schedulePersist();
        }
    }

    protected pruneOAuthStates(): void {
        const now = Date.now();
        let removed = false;
        for (const [state, created] of this.oauthStates.entries()) {
            if (now - created > OAUTH_STATE_MAX_AGE_MS) {
                this.oauthStates.delete(state);
                this.markDirty(`oauth:${state}`, undefined);
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
            const loadedAt = Date.now();
            for (const [key, value] of store.list<QaapGithubStoredSession | number>()) {
                if (key.startsWith('session:') && this.isValidSession(value)) {
                    const id = key.slice('session:'.length);
                    this.sessions.set(id, value);
                    this.sessionCheckedAt.set(id, loadedAt);
                } else if (key.startsWith('oauth:') && typeof value === 'number') {
                    if (Date.now() - value <= OAUTH_STATE_MAX_AGE_MS) {
                        this.oauthStates.set(key.slice('oauth:'.length), value);
                    }
                }
            }
            this.sessionsListSyncedAt = loadedAt;
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
        if (this.dirtyKeys.size === 0) {
            return;
        }
        const pending = [...this.dirtyKeys.entries()];
        this.dirtyKeys.clear();
        try {
            const store = this.getSqliteStore();
            store.withTransaction(() => {
                for (const [key, value] of pending) {
                    if (value === undefined) {
                        store.delete(key);
                    } else {
                        store.set(key, value);
                    }
                }
            });
        } catch (err) {
            // Keep the writes for the next flush unless a newer change superseded them.
            for (const [key, value] of pending) {
                if (!this.dirtyKeys.has(key)) {
                    this.dirtyKeys.set(key, value);
                }
            }
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
