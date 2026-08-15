// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { TranscriptFollowUpEntry } from './qaap-transcript-follow-up-queue';
import type { QaapPendingUserMessageDTO } from './qaap-agent-conversation-client';

/**
 * Merge durable server `pendingUserMessages` with the local composer follow-up queue so every
 * same-session multitask message is visible in the transcript footer immediately — even before
 * the mirror POST lands.
 */
export function mergePendingUserMessagesWithLocalQueue(
    serverPending: readonly QaapPendingUserMessageDTO[] | undefined,
    localQueue: readonly TranscriptFollowUpEntry[],
): QaapPendingUserMessageDTO[] {
    const merged: QaapPendingUserMessageDTO[] = [...(serverPending ?? [])];
    const localDrafts = new Set(localQueue.map(entry => entry.draft));

    for (const [index, entry] of localQueue.entries()) {
        if (entry.serverPendingId && merged.some(item => item.id === entry.serverPendingId)) {
            continue;
        }
        if (merged.some(item => item.content === entry.draft)) {
            continue;
        }
        merged.push({
            id: entry.serverPendingId ?? `local-queue-${index}-${stableDraftKey(entry.draft)}`,
            content: entry.draft,
            createdAt: Date.now(),
            turnAgentId: entry.selectedAgentId,
            clientMessageId: entry.serverPendingId,
        });
    }

    // Drop optimistic local-only rows whose draft left the composer queue.
    return merged.filter(item => {
        if (!item.id.startsWith('local-queue-')) {
            return true;
        }
        return localDrafts.has(item.content);
    });
}

function stableDraftKey(draft: string): string {
    let hash = 0;
    for (let i = 0; i < draft.length; i += 1) {
        hash = ((hash << 5) - hash) + draft.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
