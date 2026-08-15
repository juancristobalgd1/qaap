// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    isFailedRunSummary,
    type QaapAgentConversationSummaryDTO,
} from './qaap-agent-conversation-client';

/**
 * Collapse older failed runs that share the same title so the sessions sidebar
 * does not list five identical red-X rows. Keeps the newest failed of each
 * title; returns how many older siblings were hidden per kept id.
 */
export function collapseOlderFailedDuplicateTitles(
    conversations: readonly QaapAgentConversationSummaryDTO[],
): {
    readonly conversations: QaapAgentConversationSummaryDTO[];
    readonly hiddenFailedByKeptId: ReadonlyMap<string, number>;
} {
    const failedByTitle = new Map<string, QaapAgentConversationSummaryDTO[]>();
    for (const summary of conversations) {
        if (!isFailedRunSummary(summary)) {
            continue;
        }
        const key = normalizeFailedDuplicateTitle(summary.title) || summary.id;
        const group = failedByTitle.get(key);
        if (group) {
            group.push(summary);
        } else {
            failedByTitle.set(key, [summary]);
        }
    }

    const hideIds = new Set<string>();
    const hiddenFailedByKeptId = new Map<string, number>();
    for (const group of failedByTitle.values()) {
        if (group.length < 2) {
            continue;
        }
        const ranked = [...group].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
        const [kept, ...older] = ranked;
        hiddenFailedByKeptId.set(kept.id, older.length);
        for (const summary of older) {
            hideIds.add(summary.id);
        }
    }

    if (hideIds.size === 0) {
        return { conversations: [...conversations], hiddenFailedByKeptId };
    }
    return {
        conversations: conversations.filter(summary => !hideIds.has(summary.id)),
        hiddenFailedByKeptId,
    };
}

export function normalizeFailedDuplicateTitle(title: string | undefined): string {
    return (title ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
