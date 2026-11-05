// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { appendTraceRunCancelledEvent } from './qaap-transcript-trace-lifecycle';

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
