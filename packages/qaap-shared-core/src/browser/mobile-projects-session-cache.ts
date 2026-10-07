// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapProjectSessionSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { qaapProjectRemovalIdentity } from '../common/qaap-project-removal-identity';
import {
    MOBILE_PROJECTS_REMOVED_PROJECTS_BASE,
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

/**
 * Drop browser rows of projects the server reports as removed, whatever key they were recorded under:
 * `ws:`/`recent:` rows are never reconciled against the server otherwise, so they kept listing the project.
 */
export function removeLocalSessionsOfRemovedProjects(
    local: Map<string, QaapProjectSessionSummary>,
    removedProjects: ReadonlySet<string>,
): Map<string, QaapProjectSessionSummary> {
    const reconciled = new Map(local);
    if (removedProjects.size === 0) {
        return reconciled;
    }
    for (const key of local.keys()) {
        const identity = qaapProjectRemovalIdentity(key);
        if (identity && removedProjects.has(identity)) {
            reconciled.delete(key);
        }
    }
    return reconciled;
}

/** `github:owner/repo` (lower-cased) of projects the user removed, as last reported by the server. */
export function readLocalRemovedProjects(userLogin?: string): Set<string> {
    if (typeof localStorage === 'undefined') {
        return new Set();
    }
    try {
        const parsed = JSON.parse(localStorage.getItem(mobileProjectsUserStorageKey(MOBILE_PROJECTS_REMOVED_PROJECTS_BASE, userLogin)) ?? '[]') as unknown;
        return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []);
    } catch {
        return new Set();
    }
}

export function writeLocalRemovedProjects(removedProjects: ReadonlySet<string>, userLogin?: string): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    localStorage.setItem(mobileProjectsUserStorageKey(MOBILE_PROJECTS_REMOVED_PROJECTS_BASE, userLogin), JSON.stringify([...removedProjects]));
}

/** Record (or, once imported again, forget) a removal before the server's next listing reports it. */
export function setLocalProjectRemoved(projectKey: string, removed: boolean, userLogin?: string): void {
    const identity = qaapProjectRemovalIdentity(projectKey);
    if (!identity) {
        return;
    }
    const removedProjects = readLocalRemovedProjects(userLogin);
    if (removedProjects.has(identity) === removed) {
        return;
    }
    if (removed) {
        removedProjects.add(identity);
    } else {
        removedProjects.delete(identity);
    }
    writeLocalRemovedProjects(removedProjects, userLogin);
}
