// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapPullRequestWatch } from '@theia/qaap-shared-core/lib/common/qaap-pull-request-watch';
import { QAAP_NOTICE_TRACE_ID_PREFIX } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import { type QaapAgentConversation, toConversationSummary } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

/** Optional side effects when recording pull request watch state on a conversation. */
export interface QaapPullRequestWatchRecordOptions {
    /** Timeline notice recorded on the last agent message (e.g. merged/closed/error stop). */
    readonly traceNote?: string;
    /** When true, marks the trace event with {@link QAAP_NOTICE_TRACE_ID_PREFIX} so it renders neutrally. */
    readonly traceNotice?: boolean;
}

/** Stores the conversation's pull request watch state, announces it and persists it. */
export function recordPullRequestWatchExtracted(
    ctx: QaapAgentConversationStoreContext,
    conversationId: string,
    pullRequestWatch: QaapPullRequestWatch,
    options: QaapPullRequestWatchRecordOptions = {},
): QaapAgentConversation | undefined {
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return undefined;
    }
    let next: QaapAgentConversation = { ...conv, pullRequestWatch, updatedAt: Date.now() };
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
                            id: options.traceNotice ? `${QAAP_NOTICE_TRACE_ID_PREFIX}pr-watch-${at}` : `pr-watch-${at}`,
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
