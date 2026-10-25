// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { qaapUserScopedStorageKey } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { readQaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import type { QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

/**
 * sessionStorage base key for the agent catalog this tab last loaded. sessionStorage (not localStorage)
 * keeps it to one tab. The stored key is suffixed with the signed-in login, so a catalog is only ever
 * painted for the user who loaded it.
 */
export const COMPOSER_AGENT_CATALOG_SESSION_KEY = 'qaap.composerAgentCatalog.v1';

/** Key for the signed-in owner, or undefined when no owner is known (then nothing is read or written). */
export function composerAgentCatalogSessionKey(userLogin: string | undefined = readQaapAuthUser()?.login): string | undefined {
    if (!userLogin?.trim()) {
        return undefined;
    }
    return qaapUserScopedStorageKey(COMPOSER_AGENT_CATALOG_SESSION_KEY, userLogin);
}

/** Drops every stored catalog for this tab, which is what a sign-out must do. */
export function clearComposerAgentCatalogSession(): void {
    try {
        const prefix = COMPOSER_AGENT_CATALOG_SESSION_KEY;
        for (let index = window.sessionStorage.length - 1; index >= 0; index--) {
            const key = window.sessionStorage.key(index);
            if (key?.startsWith(prefix)) {
                window.sessionStorage.removeItem(key);
            }
        }
    } catch {
        // Storage unavailable: nothing was stored.
    }
}

/** Window the sign-out listener is attached to; a new window (new page or test realm) gets its own. */
let signOutListenerWindow: Window | undefined;

/**
 * Clears the tab's catalog once the session has no signed-in user. Installed on first use so the
 * module has no side effects at import time.
 */
function installSignOutCleanup(): void {
    if (typeof window === 'undefined' || signOutListenerWindow === window) {
        return;
    }
    signOutListenerWindow = window;
    window.addEventListener('qaap-auth-session-changed', () => {
        if (!readQaapAuthUser()?.login) {
            clearComposerAgentCatalogSession();
        }
    });
}

/**
 * Last agent catalog this tab stored for `userLogin`, or an empty list. Without a known owner nothing is
 * read. Never throws (blocked or private storage).
 */
export function readComposerAgentCatalogSession(userLogin: string | undefined = readQaapAuthUser()?.login): readonly QaapAgentTaskAgentOption[] {
    const key = composerAgentCatalogSessionKey(userLogin);
    if (!key) {
        return [];
    }
    installSignOutCleanup();
    try {
        const raw = window.sessionStorage.getItem(key);
        if (!raw) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return (parsed as Array<Partial<QaapAgentTaskAgentOption> | null>)
            .filter((agent): agent is QaapAgentTaskAgentOption => !!agent && typeof agent.id === 'string');
    } catch {
        return [];
    }
}

/**
 * Stores the catalog answered by the backend for `userLogin`. Without a known owner nothing is written.
 * Failures only mean the next reload waits for the backend.
 */
export function writeComposerAgentCatalogSession(
    agents: readonly QaapAgentTaskAgentOption[],
    userLogin: string | undefined = readQaapAuthUser()?.login,
): void {
    const key = composerAgentCatalogSessionKey(userLogin);
    if (!key) {
        return;
    }
    installSignOutCleanup();
    try {
        window.sessionStorage.setItem(key, JSON.stringify(agents));
    } catch {
        // Storage unavailable: the picker keeps loading from the backend.
    }
}
