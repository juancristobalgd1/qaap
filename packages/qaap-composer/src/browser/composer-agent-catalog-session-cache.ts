// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

/**
 * sessionStorage key for the agent catalog this tab last loaded. sessionStorage (not localStorage)
 * keeps it to one tab: a reload repaints the picker at once, a new tab starts from the backend.
 */
export const COMPOSER_AGENT_CATALOG_SESSION_KEY = 'qaap.composerAgentCatalog.v1';

/** Last agent catalog this tab stored, or an empty list. Never throws (blocked or private storage). */
export function readComposerAgentCatalogSession(): readonly QaapAgentTaskAgentOption[] {
    try {
        const raw = window.sessionStorage.getItem(COMPOSER_AGENT_CATALOG_SESSION_KEY);
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

/** Stores the catalog answered by the backend. Failures only mean the next reload waits for the backend. */
export function writeComposerAgentCatalogSession(agents: readonly QaapAgentTaskAgentOption[]): void {
    try {
        window.sessionStorage.setItem(COMPOSER_AGENT_CATALOG_SESSION_KEY, JSON.stringify(agents));
    } catch {
        // Storage unavailable: the picker keeps loading from the backend.
    }
}
