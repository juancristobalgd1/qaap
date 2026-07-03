// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    isFailedRunSummary,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { QaapTurnSettleNotifier } from './qaap-turn-settle-notifier';

/**
 * Watches conversation summaries — the same live feed the Work Hub cards subscribe to — for a
 * streaming turn settling, and fires a Web Notification when it does. Deliberately hooked at the
 * summary layer (rather than the transcript widget) so it works even when no transcript view is
 * mounted: background agent turns can run 3-19 minutes and users routinely switch tabs or apps
 * while waiting.
 */
@injectable()
export class QaapTurnSettleNotifyContribution implements FrontendApplicationContribution {

    @inject(MobileProjectsConversations)
    protected readonly conversations: MobileProjectsConversations;

    protected readonly notifier = new QaapTurnSettleNotifier();
    protected readonly priorStatus = new Map<string, QaapAgentConversationSummaryDTO['status']>();

    onStart(): void {
        this.conversations.start();
        this.conversations.onDidChangeDetail(event => {
            if (event.kind === 'snapshot' || event.kind === 'created' || event.kind === 'deleted') {
                this.scanConversationSettlements();
                return;
            }
            if (event.changedFields?.includes('status')) {
                this.scanConversationSettlements();
            }
        });
    }

    protected scanConversationSettlements(): void {
        for (const summary of this.conversations.listAllSummaries()) {
            const previous = this.priorStatus.get(summary.id);
            this.priorStatus.set(summary.id, summary.status);
            if (previous !== 'streaming' || summary.status === 'streaming') {
                continue;
            }
            // The `run_cancelled` marker is only carried on the full conversation's trace events,
            // not on the summary (see isFailedRunSummary's doc comment), so a clean user-cancelled
            // turn cannot be distinguished from a normal completion at this layer — it is reported
            // as 'completed' rather than over-engineering a fetch of the full document just for this.
            const outcome = isFailedRunSummary(summary) ? 'failed' : 'completed';
            // Opening the originating conversation isn't cheaply reachable from this summary-layer
            // contribution (no reference to the panel/navigation UI), so onActivate is omitted —
            // the notifier still focuses the window unconditionally on click.
            this.notifier.notifyTurnSettled(summary.id, { title: summary.title, outcome });
        }
    }
}
