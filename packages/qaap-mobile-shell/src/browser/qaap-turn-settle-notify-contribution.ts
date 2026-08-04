// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { nls } from '@theia/core/lib/common/nls';
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
    /** Parallel-run IDs already notified as "all variants complete" — dedupe per run. */
    protected readonly notifiedParallelRuns = new Set<string>();
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
        // Optimization D: parallel-run-aware notifications. A parallel-run variant
        // (identified by `parallelRunId`) that settles while the user is on a different
        // conversation should notify without interrupting the foreground task. The
        // notification body distinguishes "parallel variant completed" from a regular
        // turn completion so the user knows it's a background result, not the task
        // they're currently looking at.
        const isParallelVariant = !!latest.parallelRunId;
        const title = isParallelVariant
            ? nls.localize('qaap/turnSettle/parallelVariantTitle', 'Parallel variant: {0}', latest.title)
            : latest.title;
        // Route activation to the Work Hub panel via a window event: this summary-layer
        // contribution has no reference to the panel/navigation UI, so a direct callback isn't
        // available. The panel listens for `QAAP_NAVIGATE_TO_CONVERSATION_EVENT` and opens the
        // originating conversation's transcript sheet. The notifier still focuses the window
        // unconditionally on click before invoking onActivate.
        this.notifier.notifyTurnSettled(latest.id, {
            title,
            outcome,
            onActivate: () => window.dispatchEvent(new CustomEvent(QAAP_NAVIGATE_TO_CONVERSATION_EVENT, {
                detail: { conversationId: latest.id },
            })),
        });
        // When a parallel variant settles, also check if ALL variants in the run have
        // completed — if so, fire an additional "all variants done" notification.
        if (isParallelVariant) {
            this.maybeNotifyParallelRunComplete(latest.parallelRunId!);
        }
    }

    /**
     * Check if all parallel-run variants for the given run have settled (not streaming).
     * If so, fire a single "all variants completed" notification so the user knows the
     * entire parallel experiment is done and can compare results.
     */
    protected maybeNotifyParallelRunComplete(parallelRunId: string): void {
        const variants = this.conversations.listAllSummaries()
            .filter(s => s.parallelRunId === parallelRunId);
        if (variants.length === 0) {
            return;
        }
        // Only notify when ALL variants have settled.
        const allSettled = variants.every(v => v.status !== 'streaming');
        if (!allSettled) {
            return;
        }
        // Dedupe per run — only notify once.
        if (this.notifiedParallelRuns.has(parallelRunId)) {
            return;
        }
        this.notifiedParallelRuns.add(parallelRunId);
        const completed = variants.filter(v => !isFailedRunSummary(v)).length;
        const failed = variants.length - completed;
        const runTitle = nls.localize(
            'qaap/turnSettle/parallelRunComplete',
            'Parallel run complete ({0}/{1} succeeded)',
            String(completed),
            String(variants.length),
        );
        this.notifier.notifyTurnSettled(`parallel-run-${parallelRunId}`, {
            title: runTitle,
            outcome: failed > 0 ? 'failed' : 'completed',
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
