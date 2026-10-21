// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isAgentTurnInterruptedError } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/** One-tap recovery offered on a failed task row. */
export type QaapFailedRunAction = 'continue' | 'retry';

/**
 * A turn that was cut short rather than failing on its own (the watchdog's inactivity or task-limit
 * pause, an approval wait that expired, a backend restart, the legacy `Agent interrupted` copy) keeps
 * its work, so the row offers Continue instead of Retry. The decision is the one the failure copy
 * itself makes (`isAgentTurnInterruptedError`), so the chip never says Retry under a reason that
 * tells the user to Continue.
 */
export function resolveQaapFailedRunAction(
    summary: Pick<QaapAgentConversationSummaryDTO, 'lastMessageError'>,
): QaapFailedRunAction {
    return isAgentTurnInterruptedError(summary.lastMessageError) ? 'continue' : 'retry';
}
