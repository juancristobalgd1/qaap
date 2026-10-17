// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapLinkedPullRequest } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapTaskPullRequest } from '@theia/qaap-shared-core/lib/common/qaap-task-pull-request';
import { type QaapAgentConversation, toConversationSummary } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

/** What {@link recordTaskPullRequestExtracted} writes besides the task pull request itself. */
export interface QaapTaskPullRequestRecordOptions {
    /** Also link the thread to the PR (Work Hub inbox / PR chips), unless it is linked to another PR. */
    readonly linkedPullRequest?: QaapLinkedPullRequest;
    /** Timeline note on the last agent message (failures only, so they are never swallowed). */
    readonly traceNote?: string;
}

/** Stores the conversation's task pull request state, announces it and persists it. */
export function recordTaskPullRequestExtracted(
    ctx: QaapAgentConversationStoreContext,
    conversationId: string,
    taskPullRequest: QaapTaskPullRequest,
    options: QaapTaskPullRequestRecordOptions = {},
): QaapAgentConversation | undefined {
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return undefined;
    }
    let next: QaapAgentConversation = { ...conv, taskPullRequest, updatedAt: Date.now() };
    const link = options.linkedPullRequest;
    const existing = conv.linkedPullRequest;
    if (link && (!existing?.number || (existing.owner === link.owner && existing.repo === link.repo && existing.number === link.number))) {
        next = { ...next, linkedPullRequest: { ...existing, ...link } };
    }
    let tracedMessageId: string | undefined;
    const traceNote = options.traceNote;
    if (traceNote) {
        const target = [...next.messages].reverse().find(message => message.role === 'agent');
        if (target) {
            const at = Date.now();
            tracedMessageId = target.id;
            next = {
                ...next,
                messages: next.messages.map(message => message.id === target.id
                    ? {
                        ...message,
                        traceEvents: [...(message.traceEvents ?? []), {
                            type: 'error' as const,
                            id: `task-pr-${at}`,
                            message: traceNote,
                            startedAt: at,
                        }],
                    }
                    : message),
            };
        }
    }
    ctx.conversations.set(conversationId, next);
    if (tracedMessageId) {
        ctx.publishFinalizedAgentMessage(conversationId, next, tracedMessageId);
    }
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void ctx.persist();
    return next;
}
