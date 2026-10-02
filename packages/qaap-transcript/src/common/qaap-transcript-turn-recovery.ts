// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    resolveRunUserMessageId,
    type QaapAgentConversationDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

type TranscriptRecoveryConversation = Pick<QaapAgentConversationDTO, 'messages' | 'checkpoints' | 'status' | 'discardCheckpointId'>;

/**
 * Pre-turn checkpoint the "Discard changes" action of a cancelled run may restore, or `undefined`
 * when the action must stay hidden: nothing streams, the backend published the checkpoint (it
 * does so only after the stopped agent process exited) and it belongs to THIS run's user turn.
 */
export function resolveTranscriptDiscardCheckpointId(
    conv: TranscriptRecoveryConversation | undefined,
    agentMessageId: string | undefined,
): string | undefined {
    const checkpointId = conv?.discardCheckpointId;
    if (!conv || !checkpointId || conv.status === 'streaming') {
        return undefined;
    }
    const userMessageId = resolveRunUserMessageId(conv.messages, agentMessageId);
    if (!userMessageId) {
        return undefined;
    }
    const checkpoint = conv.checkpoints?.find(entry => entry.id === checkpointId);
    if (!checkpoint || checkpoint.kind !== 'pre-turn' || checkpoint.messageId !== userMessageId || !checkpoint.commit?.trim()) {
        return undefined;
    }
    return checkpoint.id;
}

/** Retry attempt (2 = first retry) of the user turn that produced `agentMessageId`; `undefined` for the original attempt. */
export function resolveTranscriptTurnRetryAttempt(
    conv: Pick<QaapAgentConversationDTO, 'messages'> | undefined,
    agentMessageId: string | undefined,
): number | undefined {
    if (!conv) {
        return undefined;
    }
    const userMessageId = resolveRunUserMessageId(conv.messages, agentMessageId);
    const attempt = userMessageId ? conv.messages.find(message => message.id === userMessageId)?.retryAttempt : undefined;
    return attempt !== undefined && attempt > 1 ? attempt : undefined;
}

/** Optimistic copy used while the retry request waits for the previous process to exit. */
export function markTranscriptConversationRetryOptimistic(
    conv: QaapAgentConversationDTO,
    now = Date.now(),
): QaapAgentConversationDTO {
    const lastUserIndex = conv.messages.reduce<number>(
        (last, message, index) => message.role === 'user' ? index : last,
        -1,
    );
    if (lastUserIndex < 0) {
        return { ...conv, status: 'streaming', updatedAt: now };
    }
    const lastUser = conv.messages[lastUserIndex];
    const messages = [...conv.messages];
    messages[lastUserIndex] = {
        ...lastUser,
        createdAt: now,
        retryAttempt: (lastUser.retryAttempt ?? 1) + 1,
    };
    return { ...conv, status: 'streaming', updatedAt: now, messages };
}
