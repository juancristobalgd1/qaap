// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapProjectSessionSummary, QaapProjectSessionUpsertRequest } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

const PERSIST_DEBOUNCE_MS = 100;

function resolveProjectSessionStorePath(): string {
    if (process.env.QAAP_PROJECT_SESSION_STORE_PATH?.trim()) {
        return process.env.QAAP_PROJECT_SESSION_STORE_PATH.trim();
    }
    const reposRoot = process.env.QAAP_REPOS_ROOT?.trim()
        || (process.env.NODE_ENV === 'production' ? '/workspace/repos' : path.join(os.homedir(), '.qaap', 'workspaces'));
    if (reposRoot.endsWith(`${path.sep}repos`)) {
        return path.join(path.dirname(reposRoot), '.qaap', 'project-sessions.json');
    }
    return path.join(os.homedir(), '.qaap', 'project-sessions.json');
}

/** Persisted per-user hub metrics keyed by `login` → repoKey → snapshot. */
interface PersistedProjectSessions {
    users: Array<[string, Array<[string, QaapProjectSessionSummary]>]>;
}

@injectable()
export class QaapProjectSessionStore {

    protected readonly byUser = new Map<string, Map<string, QaapProjectSessionSummary>>();
    protected readonly storePath = resolveProjectSessionStorePath();
    protected readonly sqlitePath = resolveQaapSqlitePath(this.storePath);
    protected sqliteStore: QaapSqliteStore | undefined;
    protected persistTimer: NodeJS.Timeout | undefined;
    protected loaded = false;

    @postConstruct()
    protected init(): void {
        this.loadFromDisk();
    }

    listForUser(login: string): QaapProjectSessionSummary[] {
        const map = this.byUser.get(login);
        return map ? [...map.values()] : [];
    }

    getForUser(login: string, repoKey: string): QaapProjectSessionSummary | undefined {
        return this.byUser.get(login)?.get(repoKey);
    }

    deleteForUser(login: string, repoKey: string): boolean {
        const map = this.byUser.get(login);
        if (!map || !map.delete(repoKey)) {
            return false;
        }
        if (map.size === 0) {
            this.byUser.delete(login);
        }
        this.schedulePersist();
        return true;
    }

    upsertForUser(login: string, patch: QaapProjectSessionUpsertRequest): QaapProjectSessionSummary {
        let map = this.byUser.get(login);
        if (!map) {
            map = new Map();
            this.byUser.set(login, map);
        }
        const existing = map.get(patch.repoKey);
        const next: QaapProjectSessionSummary = {
            repoKey: patch.repoKey,
            branch: patch.branch ?? existing?.branch ?? 'main',
            tokens: patch.tokens ?? existing?.tokens,
            cost: patch.cost ?? existing?.cost,
            agentState: patch.agentState ?? existing?.agentState,
            lastTask: patch.lastTask ?? existing?.lastTask,
            lastActiveAt: new Date().toISOString(),
            previewUrl: patch.previewUrl ?? existing?.previewUrl,
            bootstrapPhase: patch.bootstrapPhase ?? existing?.bootstrapPhase,
        };
        map.set(patch.repoKey, next);
        this.schedulePersist();
        return next;
    }

    protected loadFromDisk(): void {
        try {
            const store = this.getSqliteStore();
            try {
                store.migrateLegacy<QaapProjectSessionSummary>(raw => {
                    const parsed = JSON.parse(raw) as Partial<PersistedProjectSessions>;
                    const entries: Array<[string, QaapProjectSessionSummary]> = [];
                    for (const userEntry of parsed.users ?? []) {
                        if (!Array.isArray(userEntry) || userEntry.length !== 2 || typeof userEntry[0] !== 'string') {
                            continue;
                        }
                        for (const repoEntry of userEntry[1] ?? []) {
                            if (Array.isArray(repoEntry) && repoEntry.length === 2
                                && typeof repoEntry[0] === 'string'
                                && repoEntry[1]
                                && typeof repoEntry[1].repoKey === 'string') {
                                entries.push([this.storageKey(userEntry[0], repoEntry[0]), repoEntry[1] as QaapProjectSessionSummary]);
                            }
                        }
                    }
                    return entries;
                });
            } catch {
                // A malformed legacy file must not hide valid SQLite state.
            }
            for (const [key, session] of store.list<QaapProjectSessionSummary>()) {
                const separator = key.indexOf('\0');
                if (separator < 0) {
                    continue;
                }
                const login = key.slice(0, separator);
                const repoKey = key.slice(separator + 1);
                const repos = this.byUser.get(login) ?? new Map<string, QaapProjectSessionSummary>();
                repos.set(repoKey, session);
                this.byUser.set(login, repos);
            }
        } catch (err) {
            console.warn('[qaap] Could not read project session store:', err);
        }
        this.loaded = true;
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
        this.persistTimer.unref?.();
    }

    protected persistNow(): void {
        const entries: Array<[string, QaapProjectSessionSummary]> = [];
        for (const [login, repos] of this.byUser.entries()) {
            for (const [repoKey, session] of repos) {
                entries.push([this.storageKey(login, repoKey), session]);
            }
        }
        try {
            this.getSqliteStore().replace(entries);
        } catch (err) {
            console.warn('[qaap] Could not persist project session store:', err);
        }
    }

    protected storageKey(login: string, repoKey: string): string {
        return `${login}\0${repoKey}`;
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: this.sqlitePath,
            namespace: 'project-sessions',
            legacyPath: this.storePath,
        });
    }
}
