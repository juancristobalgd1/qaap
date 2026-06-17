// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { hasActiveQaapTraceWork, resolveQaapTranscriptTrace } from './qaap-transcript-trace-model';

export function hasUnfinishedAgentWork(conv: QaapAgentConversationDTO): boolean {
    return conv.messages.some(message => message.role === 'agent' && hasUnfinishedAgentMessageWork(message));
}

export function hasUnfinishedAgentMessageWork(message: QaapAgentMessageDTO): boolean {
    return hasActiveQaapTraceWork(message);
}

/**
 * True when the visible agent turn looks complete (tools done, answer or edits shown) even if the
 * backend task is still attached — e.g. a dev server keeps the VPS process alive after the model
 * finished the turn.
 */
export function isConversationTurnVisuallySettled(conv: QaapAgentConversationDTO): boolean {
    if (hasUnfinishedAgentWork(conv)) {
        return false;
    }
    if (conv.status !== 'streaming') {
        return conv.status === 'idle';
    }
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'agent') {
        return false;
    }
    return isAgentMessageVisuallySettled(last);
}

export function isAgentMessageVisuallySettled(message: QaapAgentMessageDTO): boolean {
    if (message.role !== 'agent') {
        return false;
    }
    const segments = resolveQaapTranscriptTrace(message).segments;
    if (segments.length) {
        if (hasUnfinishedAgentMessageWork(message)) {
            return false;
        }
        const hasFinishedTool = segments.some(
            segment => segment.type === 'tool' && segment.finished,
        );
        const hasText = segments.some(
            segment => segment.type === 'text' && !!segment.content?.trim(),
        );
        if (hasText || hasFinishedTool) {
            return true;
        }
        // Thinking-only snapshots are not a completed turn while the backend task is still running.
        return false;
    }
    return !!(message.content?.trim());
}

/** UI-facing status — maps visually settled streaming turns to idle for chrome/composer. */
export function resolveTranscriptEffectiveStatus(
    conv: QaapAgentConversationDTO,
): QaapAgentConversationDTO['status'] {
    if (hasUnfinishedAgentWork(conv)) {
        return 'streaming';
    }
    if (conv.status !== 'streaming') {
        return conv.status;
    }
    return isConversationTurnVisuallySettled(conv) ? 'idle' : 'streaming';
}

/**
 * True when the last agent message should use live streaming markdown (plain/hybrid)
 * instead of full settled rendering.
 */
export function isTranscriptAgentTailStreaming(conv: QaapAgentConversationDTO): boolean {
    if (resolveTranscriptEffectiveStatus(conv) !== 'streaming' || isConversationTurnVisuallySettled(conv)) {
        return false;
    }
    const last = conv.messages[conv.messages.length - 1];
    return last?.role === 'agent';
}

export function conversationHasUserMessage(
    conv: QaapAgentConversationDTO,
    cached?: Pick<QaapAgentConversationDTO, 'id' | 'messages'>,
): boolean {
    if (conv.messages.some(message => message.role === 'user')) {
        return true;
    }
    if (cached?.id === conv.id && cached.messages.some(message => message.role === 'user')) {
        return true;
    }
    return false;
}

/** Quick-action chips only before the user sends their first message in this chat. */
export function shouldShowTranscriptEmptyQuickActions(
    conv: QaapAgentConversationDTO,
    cached?: Pick<QaapAgentConversationDTO, 'id' | 'messages'>,
): boolean {
    if (conversationHasUserMessage(conv, cached)) {
        return false;
    }
    if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
        return false;
    }
    return conv.messages.length === 0;
}
