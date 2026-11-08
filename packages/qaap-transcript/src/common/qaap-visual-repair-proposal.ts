// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/**
 * The evidence message whose failed visual check is waiting for the user's "Fix with agent"
 * decision, or `undefined`. A proposal is open while it is the conversation's last message, the
 * turn is not running and no repair turn has been started from it yet.
 */
export function resolveVisualRepairProposalMessage(
    conv: Pick<QaapAgentConversationDTO, 'status' | 'messages'> | undefined,
): QaapAgentMessageDTO | undefined {
    if (!conv || conv.status === 'streaming') {
        return undefined;
    }
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'agent' || last.visualRepairProposedAt === undefined) {
        return undefined;
    }
    const accepted = conv.messages.some(message => message.role === 'user' && message.visualRepairSourceAgentMessageId === last.id);
    return accepted ? undefined : last;
}

/**
 * A user message the backend wrote as the instruction of an accepted visual repair. It is the
 * agent's instruction, not something the user typed, so the transcript never draws it as a bubble.
 */
export function isVisualRepairInstructionMessage(message: Pick<QaapAgentMessageDTO, 'role' | 'visualRepairSourceAgentMessageId'>): boolean {
    return message.role === 'user' && message.visualRepairSourceAgentMessageId !== undefined;
}
