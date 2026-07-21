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
/** Poll GET /conversation while streaming when SSE is quiet (iOS Safari often drops EventSource). */
const STREAMING_FALLBACK_POLL_MS = 3_000;

/**
 * SSE-first live transcript coordinator. Message chunks are merged in the panel via
 * {@link applyConversationMessageDelta}; this class debounces refetches and applies lightweight
 * summary updates from SSE `updated` events. A fallback poll runs while streaming so mobile
 * browsers still advance the transcript when EventSource reconnects slowly or stalls.
 */
export class QaapTranscriptLiveController implements Disposable {

    protected refreshTimer: number | undefined;
    protected streamingPollTimer: number | undefined;
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

    watch(conversationId: string): void {
        this.watchedConversationId = conversationId;
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
            }
        });
        this.installVisibilityResume(conversationId, scheduleRefresh);
        this.startStreamingFallbackPoll(conversationId, scheduleRefresh);
        void this.refreshNow();
    }

    stopWatch(): void {
        this.watchedConversationId = undefined;
        this.scheduleRefresh = undefined;
        this.clearRefreshTimer();
        this.clearStreamingFallbackPoll();
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

    protected startStreamingFallbackPoll(
        conversationId: string,
        scheduleRefresh: () => void,
    ): void {
        const setIntervalFn = typeof window !== 'undefined' ? window.setInterval.bind(window) : globalThis.setInterval;
        if (typeof setIntervalFn !== 'function') {
            return;
        }
        this.clearStreamingFallbackPoll();
        this.streamingPollTimer = setIntervalFn(() => {
            if (!this.deps.isWatching(conversationId)) {
                this.clearStreamingFallbackPoll();
                return;
            }
            if (!this.isDocumentVisible()) {
                return;
            }
            const last = this.deps.getLastConv();
            if (last?.status !== 'streaming') {
                this.clearStreamingFallbackPoll();
                return;
            }
            const sseAt = this.deps.getLastSseDeltaAt();
            if (sseAt !== undefined && Date.now() - sseAt < REFRESH_DEBOUNCE_MS) {
                return;
            }
            if (sseAt === undefined || Date.now() - sseAt >= STREAMING_FALLBACK_POLL_MS) {
                void this.refreshNow({ forcePoll: true });
                return;
            }
            scheduleRefresh();
        }, STREAMING_FALLBACK_POLL_MS);
    }

    protected clearStreamingFallbackPoll(): void {
        if (this.streamingPollTimer !== undefined) {
            const clearIntervalFn = typeof window !== 'undefined' ? window.clearInterval.bind(window) : globalThis.clearInterval;
            clearIntervalFn(this.streamingPollTimer);
            this.streamingPollTimer = undefined;
        }
    }

    /** Resume debounced refetch + fallback poll when the tab returns to the foreground. */
    protected installVisibilityResume(
        conversationId: string,
        scheduleRefresh: () => void,
    ): void {
        if (this.visibilityListenerInstalled || typeof document === 'undefined') {
            return;
        }
        this.visibilityListenerInstalled = true;
        const onVisible = (): void => {
            if (!this.isDocumentVisible() || !this.deps.isWatching(conversationId)) {
                return;
            }
            const last = this.deps.getLastConv();
            if (last?.status === 'streaming') {
                scheduleRefresh();
                void this.refreshNow({ forcePoll: true });
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
