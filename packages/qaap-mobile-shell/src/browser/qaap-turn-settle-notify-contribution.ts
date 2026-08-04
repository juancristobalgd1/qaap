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
import { canonicalModelStatsKey, recordModelTurnDuration } from '../common/qaap-model-latency-stats';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { QaapTurnSettleNotifier, QAAP_NAVIGATE_TO_CONVERSATION_EVENT } from './qaap-turn-settle-notifier';

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
    /** Wall-clock start of each conversation's current streaming phase (see recordModelTurnLatency). */
    protected readonly streamingSince = new Map<string, number>();
    /** Pending settle confirmations — a conversation's status can flicker to idle between messages. */
    protected readonly pendingSettle = new Map<string, ReturnType<typeof setTimeout>>();

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
            if (summary.status === 'streaming') {
                // A settle followed by more streaming within the confirmation
                // window is a mid-turn status flicker, not a real settlement —
                // cancel the pending confirmation and KEEP the original
                // streaming start so the recorded duration spans the whole turn.
                const pending = this.pendingSettle.get(summary.id);
                if (pending !== undefined) {
                    clearTimeout(pending);
                    this.pendingSettle.delete(summary.id);
                }
                if (!this.streamingSince.has(summary.id)) {
                    this.streamingSince.set(summary.id, Date.now());
                }
                continue;
            }
            if (previous !== 'streaming' || this.pendingSettle.has(summary.id)) {
                continue;
            }
            // Confirm the settle before acting: conversation status can flicker
            // to idle between a turn's messages (the same flicker the process
            // accordion guards against). Without this, latency samples get cut
            // into fragments and completion notifications fire mid-turn.
            this.pendingSettle.set(summary.id, setTimeout(() => {
                this.pendingSettle.delete(summary.id);
                this.confirmSettlement(summary);
            }, QaapTurnSettleNotifyContribution.SETTLE_CONFIRM_MS));
        }
    }

    protected static readonly SETTLE_CONFIRM_MS = 10_000;

    protected confirmSettlement(summary: QaapAgentConversationSummaryDTO): void {
        const latest = this.conversations.listAllSummaries().find(s => s.id === summary.id) ?? summary;
        if (latest.status === 'streaming') {
            return;
        }
        this.recordModelTurnLatency(latest);
        // The `run_cancelled` marker is only carried on the full conversation's trace events,
        // not on the summary (see isFailedRunSummary's doc comment), so a clean user-cancelled
        // turn cannot be distinguished from a normal completion at this layer — it is reported
        // as 'completed' rather than over-engineering a fetch of the full document just for this.
        const outcome = isFailedRunSummary(latest) ? 'failed' : 'completed';
        // Route activation to the Work Hub panel via a window event: this summary-layer
        // contribution has no reference to the panel/navigation UI, so a direct callback isn't
        // available. The panel listens for `QAAP_NAVIGATE_TO_CONVERSATION_EVENT` and opens the
        // originating conversation's transcript sheet. The notifier still focuses the window
        // unconditionally on click before invoking onActivate.
        this.notifier.notifyTurnSettled(latest.id, {
            title: latest.title,
            outcome,
            onActivate: () => window.dispatchEvent(new CustomEvent(QAAP_NAVIGATE_TO_CONVERSATION_EVENT, {
                detail: { conversationId: latest.id },
            })),
        });
    }

    /**
     * Feeds the observed-latency store (surfaced in the composer's model picker, see
     * `qaap-model-latency-stats.ts`). Duration source, in order of fidelity:
     * 1. Wall-clock time since this contribution saw the conversation ENTER 'streaming'
     *    (`streamingSince`) — the honest "how long did I wait" number.
     * 2. Fallback: `summary.lastTurnDurationMs` (gap between the last user and agent message
     *    timestamps). Measured live it approximates time-to-first-token, badly UNDERestimating
     *    models that think for a long time before emitting — only used when the streaming start
     *    was never observed (e.g. the tab was opened mid-turn).
     */
    protected recordModelTurnLatency(summary: QaapAgentConversationSummaryDTO): void {
        const model = summary.agentModel;
        if (!model) {
            return;
        }
        const startedAt = this.streamingSince.get(summary.id);
        this.streamingSince.delete(summary.id);
        const durationMs = startedAt !== undefined ? Date.now() - startedAt : summary.lastTurnDurationMs;
        if (!durationMs || durationMs <= 0) {
            return;
        }
        recordModelTurnDuration(canonicalModelStatsKey(model), durationMs);
    }
}
