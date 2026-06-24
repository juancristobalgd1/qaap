// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { qaapUserScopedStorageKey } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { readQaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';

export const MOBILE_PROJECTS_SESSION_CACHE_BASE = 'qaap.mobileProjects.sessionCache.v1';
export const MOBILE_PROJECTS_HIDDEN_IDS_BASE = 'qaap.mobileProjects.hiddenIds';
export const MOBILE_PROJECTS_PINNED_IDS_BASE = 'qaap.mobileProjects.pinnedIds';
export const MOBILE_PROJECTS_DISPLAY_NAMES_BASE = 'qaap.mobileProjects.displayNames';
export const MOBILE_PROJECTS_CUSTOM_PROJECTS_BASE = 'qaap.mobileProjects.customProjects';

const SCOPED_BASE_KEYS = [
    MOBILE_PROJECTS_SESSION_CACHE_BASE,
    MOBILE_PROJECTS_HIDDEN_IDS_BASE,
    MOBILE_PROJECTS_PINNED_IDS_BASE,
    MOBILE_PROJECTS_DISPLAY_NAMES_BASE,
    MOBILE_PROJECTS_CUSTOM_PROJECTS_BASE,
];

/** Resolve a browser cache key scoped to the signed-in GitHub/GitLab login. */
export function mobileProjectsUserStorageKey(baseKey: string, userLogin?: string): string {
    const login = userLogin ?? readQaapAuthUser()?.login;
    return qaapUserScopedStorageKey(baseKey, login);
}

/** Drop all Work Hub project caches for every known user on this origin. */
export function clearAllMobileProjectsUserCaches(): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) {
            continue;
        }
        for (const base of SCOPED_BASE_KEYS) {
            if (key === base || key.startsWith(`${base}@`)) {
                keysToRemove.push(key);
            }
        }
    }
    for (const key of keysToRemove) {
        localStorage.removeItem(key);
    }
}
