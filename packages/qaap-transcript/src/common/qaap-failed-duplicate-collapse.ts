// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    isFailedRunSummary,
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

export interface CollapseOlderFailedDuplicateTitlesOptions {
    /**
     * Also hide failed runs whose title matches a newer non-failed run, so a retried task that
     * subsequently succeeded does not list both the succeeded row and an identical failed row.
     */
    readonly hideSupersededBySuccess?: boolean;
    /** Conversation ids that must never be hidden (e.g. the currently open transcript). */
    readonly keepIds?: ReadonlySet<string>;
}

/**
 * Collapse older failed runs that share the same title so the sessions sidebar
 * does not list five identical red-X rows. Keeps the newest failed of each
 * title; returns how many older siblings were hidden per kept id.
 */
export function collapseOlderFailedDuplicateTitles(
    conversations: readonly QaapAgentConversationSummaryDTO[],
    options?: CollapseOlderFailedDuplicateTitlesOptions,
): {
    readonly conversations: QaapAgentConversationSummaryDTO[];
    readonly hiddenFailedByKeptId: ReadonlyMap<string, number>;
} {
    const keepIds = options?.keepIds;
    const newestNonFailedCreatedByTitle = new Map<string, number>();
    if (options?.hideSupersededBySuccess) {
        for (const summary of conversations) {
            if (isFailedRunSummary(summary)) {
                continue;
            }
            const key = normalizeFailedDuplicateTitle(summary.title);
            if (!key) {
                continue;
            }
            const created = summary.createdAt ?? 0;
            const prev = newestNonFailedCreatedByTitle.get(key) ?? -1;
            if (created > prev) {
                newestNonFailedCreatedByTitle.set(key, created);
            }
        }
    }

    const failedByTitle = new Map<string, QaapAgentConversationSummaryDTO[]>();
    const hideIds = new Set<string>();
    for (const summary of conversations) {
        if (!isFailedRunSummary(summary)) {
            continue;
        }
        const key = normalizeFailedDuplicateTitle(summary.title) || summary.id;
        const newerSuccessCreated = newestNonFailedCreatedByTitle.get(key);
        const failedCreated = summary.createdAt ?? 0;
        if (
            newerSuccessCreated !== undefined
            && newerSuccessCreated >= failedCreated
            && !keepIds?.has(summary.id)
        ) {
            hideIds.add(summary.id);
            continue;
        }
        const group = failedByTitle.get(key);
        if (group) {
            group.push(summary);
        } else {
            failedByTitle.set(key, [summary]);
        }
    }

    const hiddenFailedByKeptId = new Map<string, number>();
    for (const group of failedByTitle.values()) {
        if (group.length < 2) {
            continue;
        }
        const ranked = [...group].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
        const [kept, ...older] = ranked;
        let hidden = 0;
        for (const summary of older) {
            if (keepIds?.has(summary.id)) {
                continue;
            }
            hideIds.add(summary.id);
            hidden++;
        }
        if (hidden > 0) {
            hiddenFailedByKeptId.set(kept.id, hidden);
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
