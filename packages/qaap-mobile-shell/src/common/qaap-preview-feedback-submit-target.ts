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
 */
export function resolvePreviewFeedbackSubmitTarget(
    openSummary: QaapAgentConversationSummaryDTO | undefined,
    composerSummary: QaapAgentConversationSummaryDTO | undefined,
): QaapPreviewFeedbackSubmitTarget {
    if (openSummary && !isAgentsHubIdleConversationSummary(openSummary)) {
        return { kind: 'active', summary: openSummary };
    }
    if (composerSummary && !isAgentsHubIdleConversationSummary(composerSummary)) {
        return { kind: 'active', summary: composerSummary };
    }
    return { kind: 'idle' };
}
