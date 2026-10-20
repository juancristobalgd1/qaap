// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { localizeGenericAgentFailureMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/** One-tap recovery offered on a failed task row. */
export type QaapFailedRunAction = 'continue' | 'retry';

/**
 * Turns that stopped without failing on their own: the legacy `Agent interrupted` copy, the turn
 * watchdog stop (`Stopped automatically after …`) and a stop caused by a server restart. Their work
 * is kept, so the row offers Continue (a follow-up) instead of Retry (re-running the turn).
 */
const INTERRUPTED_RUN_ERROR = /^Agent\s+interrupted\b|^Stopped automatically after\b|\bserver restart\b/i;

export function resolveQaapFailedRunAction(
    summary: Pick<QaapAgentConversationSummaryDTO, 'lastMessageError'>,
): QaapFailedRunAction {
    const error = summary.lastMessageError?.trim();
    if (!error) {
        return 'retry';
    }
    return INTERRUPTED_RUN_ERROR.test(error) || error === localizeGenericAgentFailureMessage('interrupted')
        ? 'continue'
        : 'retry';
}
