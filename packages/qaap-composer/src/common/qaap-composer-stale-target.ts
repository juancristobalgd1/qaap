// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/**
 * True when the composer is bound to a real conversation that is not the one open in the transcript
 * (for example the previous task after "New task" reset the shell). Such a summary must not receive
 * a follow-up: a new prompt starts a new task. Pending new-chat placeholders and legacy Theia chat
 * keep their own routing and are never reported as stale.
 */
export function isStaleComposerConversationTarget(
    openSummary: QaapAgentConversationSummaryDTO | undefined,
    composerSummary: QaapAgentConversationSummaryDTO,
): boolean {
    if (composerSummary.source === 'theia-chat' || composerSummary.id.startsWith('pending-new-chat-')) {
        return false;
    }
    return openSummary?.id !== composerSummary.id;
}
