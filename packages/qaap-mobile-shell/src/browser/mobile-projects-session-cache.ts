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
