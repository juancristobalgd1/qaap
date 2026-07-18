// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isAgentsHubIdleConversationSummary } from './qaap-agents-hub-landing';
import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';

export type QaapPreviewFeedbackSubmitTarget =
    | { readonly kind: 'idle' }
    | { readonly kind: 'active'; readonly summary: QaapAgentConversationSummaryDTO };

/**
 * Same session targeting as Work Hub sticky-composer submit:
 * prefer a live (non-idle) open/composer summary; otherwise create a new task.
 *
 * Legacy `theia-chat` sessions are excluded: preview feedback submits through the backend
 * conversation API, and posting there with a Theia chat-session id fails. Falling back to a
 * fresh task keeps Send deterministic instead of intermittently erroring.
 */
export function resolvePreviewFeedbackSubmitTarget(
    openSummary: QaapAgentConversationSummaryDTO | undefined,
    composerSummary: QaapAgentConversationSummaryDTO | undefined,
): QaapPreviewFeedbackSubmitTarget {
    if (openSummary && isBackendConversationSummary(openSummary)) {
        return { kind: 'active', summary: openSummary };
    }
    if (composerSummary && isBackendConversationSummary(composerSummary)) {
        return { kind: 'active', summary: composerSummary };
    }
    return { kind: 'idle' };
}

function isBackendConversationSummary(summary: QaapAgentConversationSummaryDTO): boolean {
    return !isAgentsHubIdleConversationSummary(summary) && summary.source !== 'theia-chat';
}
