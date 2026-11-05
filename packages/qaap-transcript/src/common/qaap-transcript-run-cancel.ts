// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { appendTraceRunCancelledEvent } from './qaap-transcript-trace-lifecycle';

type QaapConversationMessage = QaapAgentConversationDTO['messages'][number];

/**
 * Optimistic Stop: marks the live runs of a conversation as cancelled at once, so the transcript shows
 * "Turn cancelled." before the server answers. Only the agent messages with `runActive` are touched;
 * `messageId` narrows the change to one run (a per-run Stop). Idempotent: a message that already has
 * its run_cancelled row keeps exactly one.
 */
export function applyOptimisticRunCancelToConversation(conv: QaapAgentConversationDTO, messageId?: string): QaapAgentConversationDTO {
    return {
        ...conv,
        messages: conv.messages.map(message => message.role === 'agent' && message.runActive
            && (messageId === undefined || message.id === messageId)
            ? { ...appendTraceRunCancelledEvent(message), runActive: undefined }
            : message),
    };
}

/**
 * Optimistic Stop for a turn the local copy has no agent row for yet (the agent had not streamed its first
 * message when Stop was pressed). Without a row there is nothing to mark, so the stopped turn would only
 * appear once the server answers. A user message that is the last one means the turn produced no agent
 * row: a placeholder agent row carrying the run_cancelled trace is appended. Otherwise the conversation is
 * returned unchanged.
 */
export function appendOptimisticStoppedTurnRow(conv: QaapAgentConversationDTO, at: number = Date.now()): QaapAgentConversationDTO {
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'user') {
        return conv;
    }
    const placeholder: QaapConversationMessage = appendTraceRunCancelledEvent(
        { id: `${last.id}:stopped`, role: 'agent', content: '', createdAt: at },
        { at },
    );
    return { ...conv, messages: [...conv.messages, placeholder] };
}
