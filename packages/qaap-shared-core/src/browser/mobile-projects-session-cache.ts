// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapProjectSessionSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    MOBILE_PROJECTS_SESSION_CACHE_BASE,
    mobileProjectsUserStorageKey,
} from './mobile-projects-user-storage';

/** Browser-local mirror of hub session rows (merged with server on load). */
export function readLocalProjectSessions(userLogin?: string): Map<string, QaapProjectSessionSummary> {
    const map = new Map<string, QaapProjectSessionSummary>();
    if (typeof localStorage === 'undefined') {
        return map;
    }
    try {
        const raw = localStorage.getItem(mobileProjectsUserStorageKey(MOBILE_PROJECTS_SESSION_CACHE_BASE, userLogin));
        if (!raw) {
            return map;
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return map;
        }
        for (const row of parsed) {
            if (row && typeof row === 'object' && typeof (row as QaapProjectSessionSummary).repoKey === 'string') {
                const s = row as QaapProjectSessionSummary;
                map.set(s.repoKey, s);
            }
        }
    } catch {
        /* ignore corrupt cache */
    }
    return map;
}

export function writeLocalProjectSessions(map: Map<string, QaapProjectSessionSummary>, userLogin?: string): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    localStorage.setItem(
        mobileProjectsUserStorageKey(MOBILE_PROJECTS_SESSION_CACHE_BASE, userLogin),
        JSON.stringify([...map.values()]),
    );
}

export function patchLocalProjectSession(patch: QaapProjectSessionSummary, userLogin?: string): void {
    const map = readLocalProjectSessions(userLogin);
    const existing = map.get(patch.repoKey);
    map.set(patch.repoKey, {
        ...existing,
        ...patch,
        lastActiveAt: patch.lastActiveAt ?? new Date().toISOString(),
    });
    writeLocalProjectSessions(map, userLogin);
}

/** Remove a project from the browser mirror after it has been deleted remotely. */
export function removeLocalProjectSession(repoKey: string, userLogin?: string): void {
    const map = readLocalProjectSessions(userLogin);
    const normalizedRepoKey = repoKey.toLowerCase();
    let changed = false;
    for (const key of map.keys()) {
        if (key.toLowerCase() === normalizedRepoKey) {
            map.delete(key);
            changed = true;
        }
    }
    if (changed) {
        writeLocalProjectSessions(map, userLogin);
    }
}

/**
 * Drop stale GitHub rows when the authenticated server has become the source
 * of truth. Non-GitHub rows remain local because they are not server sessions.
 */
export function removeStaleLocalGithubSessions(
    local: Map<string, QaapProjectSessionSummary>,
    remote: Map<string, QaapProjectSessionSummary>,
): Map<string, QaapProjectSessionSummary> {
    const remoteKeys = new Set([...remote.keys()].map(key => key.toLowerCase()));
    const reconciled = new Map(local);
    for (const key of reconciled.keys()) {
        if (key.toLowerCase().startsWith('github:') && !remoteKeys.has(key.toLowerCase())) {
            reconciled.delete(key);
        }
    }
    return reconciled;
}

export function mergeSessionMaps(
    ...sources: Array<Map<string, QaapProjectSessionSummary>>
): Map<string, QaapProjectSessionSummary> {
    const out = new Map<string, QaapProjectSessionSummary>();
    for (const source of sources) {
        for (const [key, value] of source.entries()) {
            const prev = out.get(key);
            out.set(key, prev ? { ...prev, ...value } : value);
        }
    }
    return out;
}
