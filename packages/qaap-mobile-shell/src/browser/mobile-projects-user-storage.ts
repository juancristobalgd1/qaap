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

/** Resolve a browser cache key scoped to the signed-in GitHub/GitLab login. */
export function mobileProjectsUserStorageKey(baseKey: string, userLogin?: string): string {
    const login = userLogin ?? readQaapAuthUser()?.login;
    return qaapUserScopedStorageKey(baseKey, login);
}

