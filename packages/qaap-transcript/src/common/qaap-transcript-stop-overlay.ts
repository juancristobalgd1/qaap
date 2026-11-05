// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { applyOptimisticRunCancelToConversation } from './qaap-transcript-run-cancel';

/**
 * While a Stop is unacknowledged the server may still report the run as streaming (its event loop can be
 * blocked by a large store write), and a poll or SSE frame can carry that stale status. The transcript
 * keeps the stopped state (idle, "Turn cancelled.") until the Stop settles: this overlay is applied to
 * every incoming conversation for a conversation whose Stop is pending.
 */
export function overlayPendingStopOnConversation(conv: QaapAgentConversationDTO): QaapAgentConversationDTO {
    if (conv.status !== 'streaming') {
        return conv;
    }
    return applyOptimisticRunCancelToConversation({ ...conv, status: 'idle' });
}
