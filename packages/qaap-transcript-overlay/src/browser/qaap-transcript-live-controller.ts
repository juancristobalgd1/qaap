// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { Event } from '@theia/core/lib/common/event';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '../common/qaap-transcript-agent-types';
import { buildConversationTranscriptFingerprint } from '../common/qaap-transcript-incremental-update';
import {
    applyConversationSummaryDelta,
    shouldSkipStreamingTranscriptRefetch,
} from '../common/qaap-transcript-sse-delta';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';

export interface QaapTranscriptLiveRefreshOptions {
    readonly forceStatusSettle?: boolean;
    /** Bypass SSE grace skip — used by the streaming fallback poll when EventSource is silent. */
    readonly forcePoll?: boolean;
}

export interface QaapTranscriptLiveControllerDeps {
    readonly isDocumentVisible?: () => boolean;
    readonly isWatching: (conversationId: string) => boolean;
    readonly getOpenSummary: () => QaapAgentConversationSummaryDTO | undefined;
    readonly setOpenSummary: (summary: QaapAgentConversationSummaryDTO) => void;
    readonly getLastConv: () => QaapAgentConversationDTO | undefined;
    readonly setLastConv: (conv: QaapAgentConversationDTO | undefined) => void;
    readonly getLastSseDeltaAt: () => number | undefined;
    readonly setLastSseDeltaAt: (at: number | undefined) => void;
    readonly findSummaryById: (conversationId: string) => QaapAgentConversationSummaryDTO | undefined;
    readonly refreshConversation: (options?: QaapTranscriptLiveRefreshOptions) => Promise<void>;
    readonly renderConversation: (conv: QaapAgentConversationDTO) => void;
    readonly onApprovalRefresh: () => void;
    readonly onStatusSettled?: () => void;
    readonly conversationsOnDidChange: Event<void>;
}

const REFRESH_DEBOUNCE_MS = 320;
/**
 * Poll GET /conversation while a turn is active and live events are quiet (iOS Safari drops
 * EventSource, the WebSocket can reconnect or miss deltas). First poll after 3s of silence,
 * then back off by 1s per silent poll up to 5s.
 */
const ACTIVE_POLL_INITIAL_MS = 3_000;
const ACTIVE_POLL_STEP_MS = 1_000;
const ACTIVE_POLL_MAX_MS = 5_000;
/**
 * After a submit the local copy can still read `idle` until the server reports `streaming`;
 * keep polling this long so that flip is never missed.
 */
const ACTIVE_POLL_SUBMIT_GRACE_MS = 15_000;

/**
 * SSE-first live transcript coordinator. Message chunks are merged in the panel via
 * {@link applyConversationMessageDelta}; this class debounces refetches and applies lightweight
 * summary updates from SSE `updated` events. One fallback poll per watched conversation runs while
 * its turn is active so the transcript still advances when the live channel drops, reconnects
 * slowly or never delivers; it stops once the turn settles.
 */
export class QaapTranscriptLiveController implements Disposable {

    protected refreshTimer: number | undefined;
    protected activePollTimer: number | undefined;
    protected activePollDelayMs = ACTIVE_POLL_INITIAL_MS;
    protected activePollGraceUntil = 0;
    protected refreshInFlight = false;
    protected pendingForceSettle = false;
    protected scheduleRefresh: (() => void) | undefined;
    protected watchedConversationId: string | undefined;
    protected liveUpdatesDispose: Disposable = Disposable.NULL;
    protected visibilityListenerInstalled = false;
    /**
     * Cache of the last computed transcript fingerprint, keyed by exact object
     * identity of the conversation it was computed from. `handleSummaryUpdated`
     * recomputes `next`'s fingerprint every tick and that same object becomes
     * `last` on the following tick — reusing the cached value instead of
     * rebuilding avoids hashing every message twice per tick.
     */
    protected lastTranscriptFingerprintConv: QaapAgentConversationDTO | undefined;
    protected lastTranscriptFingerprint: string | undefined;

    constructor(protected readonly deps: QaapTranscriptLiveControllerDeps) { }

    protected isDocumentVisible(): boolean {
        return this.deps.isDocumentVisible?.() ?? (
            typeof document === 'undefined' || document.visibilityState === 'visible'
        );
    }

    get onScheduleRefresh(): (() => void) | undefined {
        return this.scheduleRefresh;
    }

    /** Whether {@link watch} is currently bound to `conversationId` (not a stale placeholder id). */
    isWatchingConversation(conversationId: string): boolean {
        return this.watchedConversationId === conversationId;
    }

    watch(conversationId: string): void {
        this.watchedConversationId = conversationId;
        this.activePollGraceUntil = 0;
        this.clearRefreshTimer();
        const scheduleRefresh = (): void => {
            if (!this.deps.isWatching(conversationId)) {
                return;
            }
            if (!this.isDocumentVisible()) {
                return;
            }
            this.clearRefreshTimer();
            this.refreshTimer = window.setTimeout(() => {
                this.refreshTimer = undefined;
                void this.refreshNow();
            }, REFRESH_DEBOUNCE_MS);
        };
        this.scheduleRefresh = scheduleRefresh;
        this.liveUpdatesDispose.dispose();
        this.liveUpdatesDispose = this.deps.conversationsOnDidChange(() => {
            if (!this.deps.isWatching(conversationId)) {
                this.stopWatch();
                return;
            }
            if (!this.isDocumentVisible()) {
                return;
            }
            const summary = this.deps.findSummaryById(conversationId);
            if (summary) {
                this.handleSummaryUpdated(summary);
            }
            const last = this.deps.getLastConv();
            if (last?.status === 'streaming') {
                scheduleRefresh();
                this.armActivePoll();
            }
        });
        this.installVisibilityResume(conversationId);
        this.clearActivePoll();
        this.armActivePoll();
        void this.refreshNow();
    }

    stopWatch(): void {
        this.watchedConversationId = undefined;
        this.scheduleRefresh = undefined;
        this.clearRefreshTimer();
        this.clearActivePoll();
        this.liveUpdatesDispose.dispose();
        this.liveUpdatesDispose = Disposable.NULL;
        this.visibilityListenerInstalled = false;
    }

    dispose(): void {
        this.stopWatch();
    }

    markSseDeltaApplied(): void {
        this.deps.setLastSseDeltaAt(Date.now());
    }

    handleSummaryUpdated(summary: QaapAgentConversationSummaryDTO): void {
        if (!this.deps.isWatching(summary.id)) {
            return;
        }
        const last = this.deps.getLastConv();
        if (!last || last.id !== summary.id) {
            return;
        }
        const previousSummary = this.deps.getOpenSummary();
        const wasStreaming = last.status === 'streaming';
        const visualVerificationCleared = previousSummary?.id === summary.id
            && previousSummary.visualVerificationPending === true
            && !summary.visualVerificationPending;
        const next = applyConversationSummaryDelta(last, summary);
        this.deps.setLastConv(next);
        this.deps.setOpenSummary(summary);
        if (next.status === 'streaming') {
            this.armActivePoll();
        }
        if (wasStreaming && next.status !== 'streaming') {
            this.deps.setLastSseDeltaAt(undefined);
            this.deps.onApprovalRefresh();
            this.deps.onStatusSettled?.();
            void this.refreshNow({ forceStatusSettle: true });
            return;
        }
        // Capture finished while already idle — poll/SSE cleared the pending flag but the
        // open transcript may still show the "Processing screenshot…" chip until a GET.
        if (visualVerificationCleared) {
            this.deps.setLastSseDeltaAt(undefined);
            void this.refreshNow({ forcePoll: true });
            return;
        }
        if (next.status === 'streaming' && shouldSkipStreamingTranscriptRefetch(next, this.deps.getLastSseDeltaAt())) {
            if (this.canSkipStreamingSummaryRenderWithoutFingerprint(last, summary)) {
                this.lastTranscriptFingerprintConv = undefined;
                this.lastTranscriptFingerprint = undefined;
                recordTranscriptRenderMetric('sse_summary_metadata_skip');
                return;
            }
            recordTranscriptRenderMetric('sse_summary_fingerprint_check');
            // `last` was `next` on the previous tick — if its fingerprint is
            // still cached under the same object identity, reuse it instead
            // of rebuilding (exact `===` identity guard, not a value compare).
            const previousFingerprint = this.lastTranscriptFingerprintConv === last && this.lastTranscriptFingerprint !== undefined
                ? this.lastTranscriptFingerprint
                : buildConversationTranscriptFingerprint(last);
            const nextFingerprint = buildConversationTranscriptFingerprint(next);
            this.lastTranscriptFingerprintConv = next;
            this.lastTranscriptFingerprint = nextFingerprint;
            if (previousFingerprint !== nextFingerprint) {
                this.deps.renderConversation(next);
            }
        }
    }

    protected canSkipStreamingSummaryRenderWithoutFingerprint(
        last: QaapAgentConversationDTO,
        summary: QaapAgentConversationSummaryDTO,
    ): boolean {
        if (last.status !== 'streaming' || summary.status !== 'streaming') {
            return false;
        }
        if (summary.messageCount !== last.messages.length) {
            return false;
        }
        const lastMessage = last.messages[last.messages.length - 1];
        if (summary.lastMessageRole && summary.lastMessageRole !== lastMessage?.role) {
            return false;
        }
        return true;
    }

    async refreshNow(options?: QaapTranscriptLiveRefreshOptions): Promise<void> {
        const conversationId = this.watchedConversationId;
        if (!conversationId || !this.deps.isWatching(conversationId)) {
            return;
        }
        if (!this.isDocumentVisible()) {
            return;
        }
        if (this.refreshInFlight) {
            if (options?.forceStatusSettle) {
                this.pendingForceSettle = true;
            }
            return;
        }
        const last = this.deps.getLastConv();
        if (!options?.forcePoll
            && shouldSkipStreamingTranscriptRefetch(last, this.deps.getLastSseDeltaAt())
            && !options?.forceStatusSettle) {
            return;
        }
        this.refreshInFlight = true;
        try {
            await this.deps.refreshConversation(options);
        } finally {
            this.refreshInFlight = false;
            if (this.deps.getLastConv()?.status === 'streaming') {
                this.armActivePoll();
            }
            if (this.pendingForceSettle) {
                this.pendingForceSettle = false;
                void this.refreshNow({ forceStatusSettle: true });
            }
        }
    }

    protected clearRefreshTimer(): void {
        if (this.refreshTimer !== undefined) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    /**
     * Re-arm the active-task poll after a submit / retry / transport reconnect. Polling continues
     * for a short grace period even while the local copy still reads idle.
     */
    ensureActivePoll(): void {
        if (!this.watchedConversationId) {
            return;
        }
        this.activePollGraceUntil = Date.now() + ACTIVE_POLL_SUBMIT_GRACE_MS;
        this.armActivePoll();
    }

    /** Tab back in the foreground: always rehydrate from the server, the live channel may have missed events. */
    handleDocumentVisible(): void {
        const conversationId = this.watchedConversationId;
        if (!conversationId || !this.isDocumentVisible() || !this.deps.isWatching(conversationId)) {
            return;
        }
        this.scheduleRefresh?.();
        void this.refreshNow({ forcePoll: true });
        this.armActivePoll();
    }

    protected armActivePoll(): void {
        if (this.activePollTimer !== undefined || !this.watchedConversationId) {
            return;
        }
        this.activePollDelayMs = ACTIVE_POLL_INITIAL_MS;
        this.scheduleActivePollTick();
    }

    protected scheduleActivePollTick(): void {
        this.activePollTimer = window.setTimeout(() => {
            this.activePollTimer = undefined;
            this.runActivePollTick();
        }, this.activePollDelayMs);
    }

    /** Active = not loaded yet, streaming, or just submitted. Settled turns stop the poll. */
    protected isActivePollTarget(conversationId: string): boolean {
        const last = this.deps.getLastConv();
        if (!last || last.id !== conversationId) {
            return true;
        }
        return last.status === 'streaming' || Date.now() < this.activePollGraceUntil;
    }

    protected runActivePollTick(): void {
        const conversationId = this.watchedConversationId;
        if (!conversationId || !this.deps.isWatching(conversationId)) {
            return;
        }
        // Hidden tabs stop polling; the visibility handler rehydrates and re-arms on return.
        if (!this.isDocumentVisible() || !this.isActivePollTarget(conversationId)) {
            return;
        }
        const sseAt = this.deps.getLastSseDeltaAt();
        if (sseAt !== undefined && Date.now() - sseAt < ACTIVE_POLL_INITIAL_MS) {
            this.activePollDelayMs = ACTIVE_POLL_INITIAL_MS;
            this.scheduleActivePollTick();
            return;
        }
        void this.refreshNow({ forcePoll: true });
        this.activePollDelayMs = Math.min(this.activePollDelayMs + ACTIVE_POLL_STEP_MS, ACTIVE_POLL_MAX_MS);
        this.scheduleActivePollTick();
    }

    protected clearActivePoll(): void {
        if (this.activePollTimer !== undefined) {
            window.clearTimeout(this.activePollTimer);
            this.activePollTimer = undefined;
        }
    }

    /** Rehydrate + re-arm the active poll when the tab returns to the foreground. */
    protected installVisibilityResume(conversationId: string): void {
        if (this.visibilityListenerInstalled || typeof document === 'undefined') {
            return;
        }
        this.visibilityListenerInstalled = true;
        const onVisible = (): void => {
            if (this.watchedConversationId === conversationId) {
                this.handleDocumentVisible();
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        this.liveUpdatesDispose = new DisposableCollection(
            this.liveUpdatesDispose,
            Disposable.create(() => {
                document.removeEventListener('visibilitychange', onVisible);
                this.visibilityListenerInstalled = false;
            }),
        );
    }
}
