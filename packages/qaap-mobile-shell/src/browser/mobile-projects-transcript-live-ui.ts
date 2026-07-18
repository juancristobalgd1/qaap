// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Event as TheiaEvent } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    conversationToSummary,
    getConversation,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
    type QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import {
    fetchAgentApprovals,
    type QaapAgentApprovalRequestDTO,
} from '../common/qaap-agent-approval-client';
import { resolveMessagePreviewText } from '../common/qaap-agent-message-content';
import { excerptTranscriptThought } from '../common/qaap-agent-transcript-segments';
import { applyAgentMessageWireDelta } from '../common/qaap-agent-message-wire-delta';
import {
    advanceTranscriptSemanticProgressClock,
    resolveTranscriptStreamingAgentSegments,
    seedTranscriptSemanticProgressClock,
} from '../common/qaap-transcript-semantic-progress';
import type { ConversationLiveMessageEvent } from './mobile-projects-conversations';
import {
    applyConversationMessageDelta,
    canApplySseMessageDelta,
    shouldSkipStreamingTranscriptRefetch,
} from '../common/qaap-transcript-sse-delta';
import { findTranscriptToolApproval, isPendingTranscriptToolSegment, resolveTranscriptInlineApproval } from '../common/qaap-transcript-approval-inline';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import {
    clearTranscriptPendingApprovalBar,
    mountTranscriptPendingApprovalBar,
    removeTranscriptPendingApprovalHosts,
    scrollTranscriptPendingApprovalIntoView,
} from './qaap-transcript-inline-approval-ui';
import { respondToTranscriptApproval } from './qaap-transcript-approval-respond';
import {
    conversationAwaitingDevPreview,
    conversationMayAutoOpenTranscriptPreview,
    conversationRequestsDevPreview,
    conversationShouldKickoffDevPreviewBootstrap,
    conversationShouldWatchDevPreview,
    messageRequestsDevPreview,
    resolveReadyTranscriptPreviewUrlFromProbe,
} from '../common/qaap-transcript-preview-offer';
import {
    buildTranscriptPreviewBootstrapFailureReason,
    shouldReportTranscriptPreviewBootstrapFailure,
    toTranscriptPreviewBootstrapSnapshot,
} from '../common/qaap-transcript-preview-bootstrap-failure';
import { reportPreviewBootstrapFailure } from '../common/qaap-agent-conversation-client';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { probeQaapDevPreviewPort } from './qaap-dev-preview-client';
import { ensureTranscriptDevPreview } from './qaap-transcript-preview-bootstrap';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import {
    buildConversationTranscriptFingerprint,
    mergeConversationTranscriptFingerprint,
    shouldForceTranscriptRenderOnStatusSettle,
    TRANSCRIPT_TOOL_USE_ID_ATTR,
} from '../common/qaap-transcript-incremental-update';
import { warmAgentTurnPath } from '../common/qaap-agent-turn-warm';
import { isTranscriptDocumentVisible } from '../common/qaap-transcript-document-visibility';
import { scheduleTranscriptIdleWork, type TranscriptIdleWorkHandle } from '../common/qaap-transcript-idle-scheduler';
import { resolveTranscriptStreamingCoalesceDelayMs } from '../common/qaap-transcript-streaming-coalesce';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';
import { isTranscriptScrollNearBottom } from '../common/qaap-transcript-user-scroll-pin';
import { isTranscriptAgentExecutionBusy, resolveTranscriptEffectiveStatus, isConversationTurnVisuallySettled } from '../common/qaap-transcript-turn-status';
import {
    QaapTranscriptLiveController,
    type QaapTranscriptLiveRefreshOptions,
} from './qaap-transcript-live-controller';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptUi } from './mobile-projects-transcript-ui';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import { QaapAgUiTranscriptLiveBridge } from './qaap-ag-ui-transcript-live-bridge';

/** Panel surface for SSE live watch, debounced refetch, and inline approval refresh. */
export interface MobileProjectsTranscriptLiveHost {
    transcriptOpenSummaryId: string | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
    transcriptConversationCache: Map<string, QaapAgentConversationDTO>;
    transcriptLastFingerprint: string | undefined;
    transcriptLastStreamProgressAt: number | undefined;
    transcriptLastSemanticProgressKey: string | undefined;
    transcriptLastTransportEventAt: number | undefined;
    transcriptLastSseDeltaAt: number | undefined;
    transcriptLastStatus: QaapAgentConversationSummaryDTO['status'] | undefined;
    transcriptScheduleRefresh: (() => void) | undefined;
    transcriptSheet: HTMLElement | undefined;
    agentsHubInlineActive: boolean;
    transcriptChatHost: HTMLElement | undefined;
    agentsHubInlineChatHost: HTMLElement | undefined;
    transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptComposerHost: HTMLElement | undefined;
    transcriptComposerPrefsConvId: string | undefined;
    transcriptComposerSendRefresh: (() => void) | undefined;
    transcriptPreviewRequestPending: boolean;
    transcriptPreviewRequestRunning: boolean;
    transcriptApprovalRefreshTimer: number | undefined;
    cachedAgentApprovals: import('../common/qaap-agent-approval-client').QaapAgentApprovalRequestDTO[];
    projectsService: MobileProjectsService;
    conversations: MobileProjectsConversations | undefined;
    transcriptMessagesUi: MobileProjectsTranscriptMessagesUi;
    transcriptUi: MobileProjectsTranscriptUi;
    transcriptStickyComposerUi: MobileProjectsTranscriptStickyComposerUi;
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;
    executionSurfaceTabsUi: MobileProjectsExecutionSurfaceTabsUi;

    conversationsForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[];
    findConversationSummaryById(id: string): QaapAgentConversationSummaryDTO | undefined;
    readonly conversationsOnDidChange: TheiaEvent<void>;
    syncTranscriptPreviewFromConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,
    ): Promise<void>;
    beginTranscriptDevPreviewRequest(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void;
    stageTranscriptPreviewReadyUrl(readyUrl: string): void;
    projectBootstrap?: QaapProjectBootstrapService;
    agUiFrontendTools?: import('./qaap-ag-ui-frontend-tool-service').QaapAgUiFrontendToolService;
    handleTranscriptStatusForAutoVerify(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        status: QaapAgentConversationSummaryDTO['status'],
    ): void;
    isPendingNewChatSummary(summary: QaapAgentConversationSummaryDTO): boolean;
    ensureTranscriptConversationRefresh(): void;
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    getChatServiceConversation(summary: QaapAgentConversationSummaryDTO): Promise<QaapAgentConversationDTO | undefined>;
}

/** Poll pending VPS tool approvals while an interactive agent turn is streaming. */
const TRANSCRIPT_APPROVAL_REFRESH_MS = 320;
/** Coalesce bursty SSE token deltas into one paint per frame on mobile. */
const TRANSCRIPT_SSE_COALESCE_RAF = true;
/** Debounce composer activity stack scans while the agent is still streaming. */
const TRANSCRIPT_COMPOSER_ACTIVITY_DEBOUNCE_MS = 450;
const TRANSCRIPT_PREVIEW_POLL_BASE_MS = 900;
const TRANSCRIPT_PREVIEW_POLL_MAX_MS = 5_000;
/** While server-side capture runs, poll the open transcript until evidence lands. */
const TRANSCRIPT_VISUAL_VERIFICATION_POLL_MS = 3_000;
const TRANSCRIPT_VISUAL_VERIFICATION_POLL_BUDGET_MS = 120_000;

/** SSE-first live transcript watch, debounced refetch, and inline approval bar. */
export class MobileProjectsTranscriptLiveUi {

    protected transcriptLiveController: QaapTranscriptLiveController | undefined;
    /** Avoid remounting the sticky composer on every SSE patch once a turn looks visually idle. */
    protected transcriptTurnVisuallySettledActive = false;
    protected transcriptPreviewOfferTimer: number | undefined;
    protected transcriptPreviewOfferAnnouncedUrl: string | undefined;
    protected transcriptPreviewSettlePollUntil: number | undefined;
    protected transcriptDevPreviewBootstrapConversationId: string | undefined;
    protected bootstrapPreviewListenerInitialized = false;
    protected pendingSseRenderConv: QaapAgentConversationDTO | undefined;
    protected threadStoreSummaryDispose: Disposable = Disposable.NULL;
    protected sseRenderRafId = 0;
    protected sseRenderTimer: number | undefined;
    protected lastMountedApprovalId: string | undefined;
    protected lastInlineApprovalSyncKey: string | undefined;
    protected transcriptComposerActivityTimer: number | undefined;
    protected transcriptComposerActivityIdleHandle: TranscriptIdleWorkHandle | undefined;
    protected transcriptPreviewPollIntervalMs = TRANSCRIPT_PREVIEW_POLL_BASE_MS;
    protected transcriptPreviewPollMisses = 0;
    protected transcriptVisualVerificationPollTimer: number | undefined;
    protected transcriptVisualVerificationPollUntil: number | undefined;
    protected refreshInFlight: Promise<void> | undefined;
    protected refreshInFlightConversationId: string | undefined;
    protected readonly transcriptPreviewFailureReportedFor = new Set<string>();
    protected visibilityResumeListenerInstalled = false;
    protected readonly agUiLiveBridge: QaapAgUiTranscriptLiveBridge;

    constructor(protected readonly host: MobileProjectsTranscriptLiveHost) {
        this.agUiLiveBridge = new QaapAgUiTranscriptLiveBridge(() => this.host.agUiFrontendTools);
        this.ensureBootstrapPreviewListener();
        this.ensureVisibilityResumeListener();
    }

    touchTranscriptTransportEvent(): void {
        this.host.transcriptLastTransportEventAt = Date.now();
    }

    protected touchTranscriptSemanticProgressFromConversation(conv: QaapAgentConversationDTO): void {
        const segments = resolveTranscriptStreamingAgentSegments(conv);
        const next = advanceTranscriptSemanticProgressClock(segments, {
            at: this.host.transcriptLastStreamProgressAt,
            key: this.host.transcriptLastSemanticProgressKey,
        });
        this.host.transcriptLastStreamProgressAt = next.at;
        this.host.transcriptLastSemanticProgressKey = next.key;
    }

    clearTranscriptSemanticProgressClock(): void {
        this.host.transcriptLastStreamProgressAt = undefined;
        this.host.transcriptLastSemanticProgressKey = undefined;
        this.host.transcriptLastTransportEventAt = undefined;
    }

    seedTranscriptSemanticProgressClock(): void {
        const seeded = seedTranscriptSemanticProgressClock();
        this.host.transcriptLastStreamProgressAt = seeded.at;
        this.host.transcriptLastSemanticProgressKey = seeded.key;
        this.host.transcriptLastTransportEventAt = seeded.at;
    }

    /** Deep-enough copy of the open transcript for rollback after an optimistic retry. */
    readOpenTranscriptRollbackSnapshot(conversationId: string): QaapAgentConversationDTO | undefined {
        const conv = this.host.transcriptLastConv;
        const source = conv?.id === conversationId
            ? conv
            : this.peekCachedOpenTranscript(conversationId);
        if (!source) {
            return undefined;
        }
        return { ...source, messages: [...source.messages] };
    }

    restoreOpenTranscriptSnapshot(conv: QaapAgentConversationDTO): void {
        this.host.transcriptLastConv = conv;
        this.host.transcriptLastFingerprint = undefined;
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (chatHost) {
            this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
        }
        this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
    }

    /**
     * Zero-latency recovery when the client-side stream watchdog timed out but the backend turn
     * may still be running — hide the timeout chrome and restart the progress clock immediately.
     */
    applyOptimisticStreamTimeoutRetry(summary: QaapAgentConversationSummaryDTO): void {
        this.seedTranscriptSemanticProgressClock();
        this.transcriptTurnVisuallySettledActive = false;
        const conv = this.host.transcriptLastConv;
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (!chatHost || !conv || conv.id !== summary.id) {
            return;
        }
        const optimistic: QaapAgentConversationDTO = { ...conv, status: 'streaming' };
        this.host.transcriptLastConv = optimistic;
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, optimistic);
        this.scheduleTranscriptComposerActivityRefresh(optimistic);
        this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
    }

    /** Paint a failed task as streaming again before the VPS retry round-trip completes. */
    applyOptimisticFailedTaskRetry(summary: QaapAgentConversationSummaryDTO): void {
        this.seedTranscriptSemanticProgressClock();
        this.transcriptTurnVisuallySettledActive = false;
        const conv = this.readOpenTranscriptRollbackSnapshot(summary.id);
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (!chatHost || !conv) {
            return;
        }
        const optimistic: QaapAgentConversationDTO = {
            ...conv,
            status: 'streaming',
            updatedAt: Date.now(),
        };
        this.host.transcriptLastConv = optimistic;
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, optimistic);
        this.scheduleTranscriptComposerActivityRefresh(optimistic);
        this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
    }

    async resyncOpenTranscriptStreamAfterTimeout(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (chatHost) {
            this.scheduleTranscriptConversationRefresh(project, summary, chatHost);
        }
        await this.refreshOpenTranscriptConversation({ forcePoll: true });
    }

    protected ensureVisibilityResumeListener(): void {
        if (this.visibilityResumeListenerInstalled || typeof document === 'undefined') {
            return;
        }
        this.visibilityResumeListenerInstalled = true;
        document.addEventListener('visibilitychange', () => {
            if (!isTranscriptDocumentVisible()) {
                this.pauseTranscriptBackgroundRenders();
                return;
            }
            const conv = this.host.transcriptLastConv;
            if (!conv || !this.isActiveTranscriptConversation(conv.id)) {
                return;
            }
            if (conv.status === 'streaming') {
                this.scheduleTranscriptComposerActivityRefresh(conv);
                this.scheduleTranscriptPreviewOfferRefresh(conv, { restart: true });
                if (this.pendingSseRenderConv) {
                    this.schedulePendingSseRender();
                }
            }
        });
    }

    conversationTranscriptFingerprint(conv: QaapAgentConversationDTO): string {
        return buildConversationTranscriptFingerprint(conv);
    }

    handleTranscriptSseMessage(event: ConversationLiveMessageEvent): void {
        if (!this.isActiveTranscriptConversation(event.conversationId)) {
            return;
        }
        this.touchTranscriptTransportEvent();
        this.agUiLiveBridge.onLiveMessage(event);
        const message = this.resolveLiveSseMessage(event);
        if (!message) {
            // Wire delta against a message the local snapshot never received (e.g. its
            // message_start was dropped) — silently skipping would wedge the transcript
            // for the rest of the turn, so re-sync once via GET instead.
            this.scheduleSseDeltaResync();
            return;
        }
        const base = this.host.transcriptLastConv;
        if (!canApplySseMessageDelta(base, event.conversationId, message)) {
            this.scheduleSseDeltaResync();
            return;
        }
        const next = applyConversationMessageDelta(base, message);
        if (next === base) {
            return;
        }
        this.ensureTranscriptLiveController().markSseDeltaApplied();
        this.agUiLiveBridge.afterMessageUpdated(event.conversationId, message);
        if (TRANSCRIPT_SSE_COALESCE_RAF) {
            this.pendingSseRenderConv = next;
            this.schedulePendingSseRender();
            return;
        }
        this.applyTranscriptSseRender(next, message);
    }

    protected sseDeltaResyncTimer: number | undefined;

    /**
     * A live delta arrived that cannot merge into the local snapshot (divergent base,
     * missing message, stale status). One debounced GET re-syncs the open transcript so
     * the stream recovers instead of staying frozen until the user reloads.
     */
    protected scheduleSseDeltaResync(): void {
        if (this.sseDeltaResyncTimer !== undefined) {
            return;
        }
        this.sseDeltaResyncTimer = window.setTimeout(() => {
            this.sseDeltaResyncTimer = undefined;
            void this.refreshOpenTranscriptConversation({ forcePoll: true });
        }, 250);
    }

    protected resolveLiveSseMessage(event: ConversationLiveMessageEvent): QaapAgentMessageDTO | undefined {
        if (event.type === 'message') {
            return event.message;
        }
        const base = this.host.transcriptLastConv;
        if (!base) {
            return undefined;
        }
        if (event.delta.kind === 'message_start' || event.delta.kind === 'replace') {
            return event.delta.message;
        }
        const patched = applyAgentMessageWireDelta(base, event.delta);
        return patched;
    }

    protected pauseTranscriptBackgroundRenders(): void {
        if (this.sseRenderRafId) {
            cancelAnimationFrame(this.sseRenderRafId);
            this.sseRenderRafId = 0;
        }
        if (this.sseRenderTimer !== undefined) {
            window.clearTimeout(this.sseRenderTimer);
            this.sseRenderTimer = undefined;
        }
        this.transcriptComposerActivityIdleHandle?.cancel();
        this.transcriptComposerActivityIdleHandle = undefined;
    }

    protected schedulePendingSseRender(): void {
        if (!isTranscriptDocumentVisible()) {
            return;
        }
        recordTranscriptRenderMetric('sse_scheduled');
        const nearBottom = this.isActiveTranscriptNearBottom();
        const delayMs = resolveTranscriptStreamingCoalesceDelayMs(nearBottom);
        if (delayMs === 0) {
            if (this.sseRenderTimer !== undefined) {
                window.clearTimeout(this.sseRenderTimer);
                this.sseRenderTimer = undefined;
            }
            if (!this.sseRenderRafId) {
                this.sseRenderRafId = requestAnimationFrame(() => this.flushPendingSseRender());
            }
            return;
        }
        if (this.sseRenderRafId) {
            cancelAnimationFrame(this.sseRenderRafId);
            this.sseRenderRafId = 0;
        }
        if (this.sseRenderTimer === undefined) {
            this.sseRenderTimer = window.setTimeout(() => {
                this.sseRenderTimer = undefined;
                this.flushPendingSseRender();
            }, delayMs);
        }
    }

    protected isActiveTranscriptNearBottom(): boolean {
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (!chatHost) {
            return true;
        }
        const list = this.host.transcriptUi.activeList;
        if (list?.active) {
            return list.isNearBottom();
        }
        const messageHost = this.host.transcriptMessagesUi.resolveTranscriptMessageHost(chatHost);
        return isTranscriptScrollNearBottom(
            messageHost.scrollTop,
            messageHost.clientHeight,
            messageHost.scrollHeight,
        );
    }

    protected flushPendingSseRender(): void {
        this.sseRenderRafId = 0;
        if (this.sseRenderTimer !== undefined) {
            window.clearTimeout(this.sseRenderTimer);
            this.sseRenderTimer = undefined;
        }
        if (!isTranscriptDocumentVisible()) {
            return;
        }
        const next = this.pendingSseRenderConv;
        if (!next) {
            return;
        }
        recordTranscriptRenderMetric('sse_flushed');
        this.pendingSseRenderConv = undefined;
        const lastMessage = next.messages.at(-1);
        if (!lastMessage) {
            return;
        }
        this.applyTranscriptSseRender(next, lastMessage);
    }

    protected cacheTranscriptConversation(document: QaapAgentConversationDTO): void {
        this.host.transcriptConversationCache.set(document.id, document);
        this.host.conversations?.cacheDocument(document);
    }

    protected bindOpenTranscriptThreadStore(conversationId: string): void {
        this.threadStoreSummaryDispose.dispose();
        const conversations = this.host.conversations;
        if (!conversations) {
            this.threadStoreSummaryDispose = Disposable.NULL;
            return;
        }
        const summaryDispose = conversations.threadStore.subscribe<QaapAgentConversationSummaryDTO | undefined>(
            summary => {
                if (this.host.transcriptOpenSummary?.id !== conversationId) {
                    return;
                }
                if (summary) {
                    this.host.transcriptOpenSummary = { ...this.host.transcriptOpenSummary, ...summary };
                    if (this.host.transcriptComposerSummary?.id === conversationId) {
                        this.host.transcriptComposerSummary = { ...this.host.transcriptComposerSummary, ...summary };
                    }
                }
            },
            snapshot => snapshot.summariesById.get(conversationId),
            conversationId,
        );
        const documentDispose = conversations.threadStore.subscribe<QaapAgentConversationDTO | undefined>(
            document => {
                if (!document || document.id !== conversationId || !this.isActiveTranscriptConversation(conversationId)) {
                    return;
                }
                const fingerprint = this.conversationTranscriptFingerprint(document);
                if (this.host.transcriptLastFingerprint === fingerprint) {
                    this.host.transcriptLastConv = document;
                    return;
                }
                const chatHost = this.resolveActiveTranscriptChatHost();
                if (!chatHost) {
                    return;
                }
                this.host.transcriptLastFingerprint = fingerprint;
                this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, document);
                if (document.status === 'streaming') {
                    this.touchTranscriptSemanticProgressFromConversation(document);
                    this.scheduleTranscriptComposerActivityRefresh(document);
                    this.scheduleTranscriptApprovalRefresh();
                    this.maybeActivateTranscriptDevPreview(document);
                } else {
                    this.clearTranscriptSemanticProgressClock();
                }
            },
            snapshot => snapshot.document,
            conversationId,
        );
        this.threadStoreSummaryDispose = new DisposableCollection(summaryDispose, documentDispose);
    }

    protected unbindOpenTranscriptThreadStore(): void {
        this.threadStoreSummaryDispose.dispose();
        this.threadStoreSummaryDispose = Disposable.NULL;
    }

    protected readCachedTranscriptConversation(conversationId: string): QaapAgentConversationDTO | undefined {
        return this.host.conversations?.threadStore.getDocument(conversationId)
            ?? this.host.transcriptConversationCache.get(conversationId);
    }

    protected applyTranscriptSseRender(
        next: QaapAgentConversationDTO,
        eventMessage: QaapAgentMessageDTO,
    ): void {
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (!chatHost) {
            return;
        }
        const prevConv = this.host.transcriptLastConv;
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, next);
        this.host.conversations?.recordSubmitLatencyMark(next.id, 'first_transcript_delta_rendered');
        this.host.executionSurfaceTabsUi.syncPlanTabDuringStreaming();
        this.host.transcriptLastConv = next;
        this.cacheTranscriptConversation(next);
        this.host.transcriptLastFingerprint = mergeConversationTranscriptFingerprint(prevConv, next);
        if (next.status === 'streaming') {
            this.touchTranscriptSemanticProgressFromConversation(next);
        } else {
            this.clearTranscriptSemanticProgressClock();
        }
        if (conversationUsesInteractiveApprovals(next) && this.host.transcriptApprovalRefreshTimer === undefined) {
            this.syncTranscriptPendingApproval(next);
        }
        this.ensureTranscriptDevPreviewWatch(next);
        this.maybeSyncTranscriptVisuallySettledChrome(next);
        if (this.host.transcriptOpenSummary) {
            this.host.transcriptOpenSummary = {
                ...this.host.transcriptOpenSummary,
                status: next.status,
                updatedAt: next.updatedAt,
                lastMessageRole: eventMessage.role,
                lastMessagePreview: excerptTranscriptThought(
                    resolveMessagePreviewText(eventMessage),
                    160,
                ),
            };
        }
        if (next.status === 'streaming') {
            this.scheduleTranscriptComposerActivityRefresh(next);
        }
    }

    protected scheduleTranscriptComposerActivityRefresh(conv: QaapAgentConversationDTO): void {
        if (!isTranscriptDocumentVisible()) {
            return;
        }
        if (this.transcriptComposerActivityTimer !== undefined) {
            return;
        }
        this.transcriptComposerActivityTimer = window.setTimeout(() => {
            this.transcriptComposerActivityTimer = undefined;
            if (!isTranscriptDocumentVisible()) {
                return;
            }
            this.transcriptComposerActivityIdleHandle?.cancel();
            this.transcriptComposerActivityIdleHandle = scheduleTranscriptIdleWork(() => {
                this.transcriptComposerActivityIdleHandle = undefined;
                const latest = this.host.transcriptLastConv;
                if (latest?.id === conv.id) {
                    this.host.transcriptStickyComposerUi.refreshTranscriptComposerActivityIfNeeded(latest);
                }
            }, { when: isTranscriptDocumentVisible });
        }, TRANSCRIPT_COMPOSER_ACTIVITY_DEBOUNCE_MS);
    }

    stopTranscriptComposerActivityRefresh(): void {
        if (this.transcriptComposerActivityTimer !== undefined) {
            window.clearTimeout(this.transcriptComposerActivityTimer);
            this.transcriptComposerActivityTimer = undefined;
        }
        this.transcriptComposerActivityIdleHandle?.cancel();
        this.transcriptComposerActivityIdleHandle = undefined;
    }

    /** Header, composer stop/queue controls, and follow-up drain after streaming → idle. */
    syncTranscriptConversationSettledChrome(): void {
        const project = this.host.transcriptOpenProject;
        const summary = this.host.transcriptOpenSummary;
        if (!project || !summary || !this.isActiveTranscriptConversation(summary.id)) {
            return;
        }
        if (this.host.transcriptLastConv?.id === summary.id) {
            this.host.transcriptOpenSummary = this.reconcileConversationListSummary(this.host.transcriptLastConv);
        }
        const backendStreaming = this.host.transcriptLastConv?.status === 'streaming';
        const effectivelyStreaming = this.host.transcriptLastConv
            ? resolveTranscriptEffectiveStatus(this.host.transcriptLastConv) === 'streaming'
            : backendStreaming;
        const previousStatus = this.host.transcriptLastStatus;
        if (backendStreaming) {
            if (effectivelyStreaming) {
                this.host.transcriptComposerSendRefresh?.();
            } else {
                this.host.transcriptStickyComposerUi.refreshComposerActivityStack();
                this.host.transcriptComposerSendRefresh?.();
            }
            this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
        } else if (previousStatus === 'streaming') {
            this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
        } else {
            this.host.transcriptComposerSendRefresh?.();
            this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
        }
        if (this.host.transcriptLastConv?.id === summary.id) {
            this.host.transcriptLastStatus = resolveTranscriptEffectiveStatus(this.host.transcriptLastConv);
        }
        const settled = this.host.transcriptOpenSummary;
        const activeConv = this.host.transcriptLastConv?.id === settled?.id ? this.host.transcriptLastConv : undefined;
        if (settled && !isTranscriptAgentExecutionBusy(settled, activeConv)) {
            void this.host.transcriptStickyComposerUi.flushTranscriptFollowUpQueue(project, settled);
        }
        void this.finalizeTranscriptDevPreviewAfterSettle();
    }

    ensureBootstrapPreviewListener(): void {
        if (this.bootstrapPreviewListenerInitialized || !this.host.projectBootstrap) {
            return;
        }
        this.bootstrapPreviewListenerInitialized = true;
        // While the watched conversation is still streaming, bootstrap-level auto-opens (port
        // detected / warmup / attach) must stage the "Open preview" pill instead of yanking the
        // user out of the live transcript into the mini-browser mid-turn.
        this.host.projectBootstrap.setPreviewAutoOpenGate(() => {
            const conv = this.host.transcriptLastConv;
            if (!conv || this.host.transcriptOpenSummaryId !== conv.id) {
                return true;
            }
            if (!conversationShouldWatchDevPreview(conv, window.location.origin)) {
                return true;
            }
            return conversationMayAutoOpenTranscriptPreview(conv);
        });
        this.host.projectBootstrap.onStateChange(state => {
            // Composer preview visibility follows the live bootstrap phase/dependency snapshot,
            // even when the active conversation is not currently watching for preview offers.
            this.host.transcriptStickyComposerUi.refreshComposerActivityStack();
            const conv = this.host.transcriptLastConv;
            if (!conv || !this.host.transcriptOpenSummaryId || this.host.transcriptOpenSummaryId !== conv.id) {
                return;
            }
            if (!conversationShouldWatchDevPreview(conv, window.location.origin)) {
                return;
            }
            if (state.previewUrl && state.phase === 'running') {
                void this.openReadyTranscriptPreviewUrl(state.previewUrl, conv);
            }
        });
    }

    kickoffTranscriptDevPreviewBootstrap(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): void {
        const bootstrap = this.host.projectBootstrap;
        if (!bootstrap || !conv || !conversationRequestsDevPreview(conv)
            || !conversationShouldKickoffDevPreviewBootstrap(conv)) {
            return;
        }
        if (this.transcriptDevPreviewBootstrapConversationId === conv.id) {
            return;
        }
        this.transcriptDevPreviewBootstrapConversationId = conv.id;
        const project = this.host.transcriptOpenProject;
        void ensureTranscriptDevPreview(bootstrap, {
            conversation: conv,
            projectId: project?.id,
            workspaceRoot: project ? this.host.projectsService.getProjectCwd(project) ?? conv.cwd : conv.cwd,
        }).then(readyUrl => {
            if (readyUrl && this.host.transcriptOpenSummaryId === conv.id) {
                void this.openReadyTranscriptPreviewUrl(readyUrl, conv);
                return;
            }
            void this.maybeReportTranscriptPreviewBootstrapFailure(conv, bootstrap);
        }).catch(() => undefined);
    }

    protected async maybeReportTranscriptPreviewBootstrapFailure(
        conv: QaapAgentConversationDTO,
        bootstrap: QaapProjectBootstrapService,
    ): Promise<void> {
        if (!conversationRequestsDevPreview(conv) && !this.host.transcriptPreviewRequestPending) {
            return;
        }
        if (this.transcriptPreviewFailureReportedFor.has(conv.id)) {
            return;
        }
        const snapshot = toTranscriptPreviewBootstrapSnapshot(bootstrap.getStateSnapshot());
        if (!shouldReportTranscriptPreviewBootstrapFailure(snapshot, this.transcriptPreviewPollMisses)) {
            return;
        }
        const reason = buildTranscriptPreviewBootstrapFailureReason(snapshot);
        if (!reason) {
            return;
        }
        this.transcriptPreviewFailureReportedFor.add(conv.id);
        this.host.transcriptPreviewRequestPending = false;
        this.host.transcriptPreviewRequestRunning = false;
        this.stopTranscriptPreviewOfferRefresh();
        try {
            const updated = await reportPreviewBootstrapFailure(conv.id, reason);
            if (updated && this.host.transcriptOpenSummaryId === conv.id) {
                this.host.transcriptLastConv = updated;
                this.host.transcriptLastStatus = resolveTranscriptEffectiveStatus(updated);
                if (this.host.transcriptOpenSummary?.id === conv.id) {
                    this.host.transcriptOpenSummary = this.reconcileConversationListSummary(updated);
                }
                const chatHost = this.resolveActiveTranscriptChatHost();
                if (chatHost) {
                    this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, updated);
                }
            }
        } catch {
            /* best-effort */
        }
        this.host.transcriptStickyComposerUi.refreshComposerActivityStack();
        this.host.transcriptComposerSendRefresh?.();
        this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
        MobileSnackbar.show(reason, { duration: 8000, kind: 'warning' });
    }

    protected async openReadyTranscriptPreviewUrl(
        readyUrl: string,
        conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,
    ): Promise<void> {
        const normalized = normalizePreviewUrlForSameOrigin(readyUrl);
        if (this.transcriptPreviewOfferAnnouncedUrl === normalized) {
            return;
        }
        if (!conversationMayAutoOpenTranscriptPreview(conv)) {
            this.host.stageTranscriptPreviewReadyUrl(normalized);
            return;
        }
        const opened = await this.host.transcriptMessagesUi.openTranscriptPreviewUrlFromLink(normalized);
        if (opened) {
            this.transcriptPreviewOfferAnnouncedUrl = normalized;
        }
    }

    async finalizeTranscriptDevPreviewAfterSettle(): Promise<void> {
        const conv = this.host.transcriptLastConv;
        if (!conv || !conversationShouldWatchDevPreview(conv, window.location.origin)) {
            return;
        }
        this.transcriptPreviewSettlePollUntil = Date.now() + 45_000;
        this.kickoffTranscriptDevPreviewBootstrap(conv);
        await this.refreshTranscriptPreviewOffer(conv);
    }

    protected maybeActivateTranscriptDevPreview(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): void {
        if (!conv) {
            return;
        }
        this.ensureTranscriptDevPreviewWatch(conv);
    }

    /** Start preview bootstrap/poll once — do not reset the poll timer on every SSE token. */
    protected ensureTranscriptDevPreviewWatch(
        conv: QaapAgentConversationDTO,
        options?: { readonly restartPreviewPoll?: boolean },
    ): void {
        if (conversationRequestsDevPreview(conv) || conversationAwaitingDevPreview(conv)) {
            this.kickoffTranscriptDevPreviewBootstrap(conv);
        }
        if (conversationShouldWatchDevPreview(conv, window.location.origin) || this.host.transcriptPreviewRequestPending) {
            this.scheduleTranscriptPreviewOfferRefresh(conv, { restart: options?.restartPreviewPoll });
        }
    }

    onTranscriptUserMessageSubmitted(content: string, conv: QaapAgentConversationDTO): void {
        this.transcriptPreviewSettlePollUntil = Date.now() + 120_000;
        this.transcriptDevPreviewBootstrapConversationId = undefined;
        this.transcriptPreviewOfferAnnouncedUrl = undefined;
        this.transcriptPreviewFailureReportedFor.delete(conv.id);
        this.transcriptPreviewPollMisses = 0;
        const project = this.host.transcriptOpenProject;
        const summary = this.host.transcriptOpenSummary;
        if (messageRequestsDevPreview(content) && project && summary) {
            this.host.transcriptPreviewRequestPending = true;
            this.host.beginTranscriptDevPreviewRequest(project, summary);
        }
        this.ensureTranscriptDevPreviewWatch(conv, { restartPreviewPoll: true });
    }

    maybeSyncTranscriptVisuallySettledChrome(conv: QaapAgentConversationDTO): void {
        if (!this.isActiveTranscriptConversation(conv.id)) {
            this.transcriptTurnVisuallySettledActive = false;
            return;
        }
        if (conv.status === 'streaming') {
            if (conv.messages.at(-1)?.role !== 'agent' || !isConversationTurnVisuallySettled(conv)) {
                this.transcriptTurnVisuallySettledActive = false;
                return;
            }
            const becameVisuallySettled = !this.transcriptTurnVisuallySettledActive;
            if (becameVisuallySettled) {
                this.transcriptTurnVisuallySettledActive = true;
                const chatHost = this.resolveActiveTranscriptChatHost();
                if (chatHost) {
                    const messageHost = this.host.transcriptMessagesUi.resolveTranscriptMessageHost(chatHost);
                    this.host.transcriptMessagesUi.settleVisuallySettledAgentTranscript(messageHost, conv);
                }
                if (this.host.transcriptOpenSummary?.id === conv.id) {
                    this.host.transcriptOpenSummary = this.reconcileConversationListSummary(conv);
                }
            }
            this.host.transcriptStickyComposerUi.refreshComposerActivityStack();
            this.host.transcriptComposerSendRefresh?.();
            this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
            return;
        }
        if (conv.messages.at(-1)?.role !== 'agent' || !isConversationTurnVisuallySettled(conv)) {
            this.transcriptTurnVisuallySettledActive = false;
            return;
        }
        if (this.transcriptTurnVisuallySettledActive) {
            return;
        }
        this.transcriptTurnVisuallySettledActive = true;
        this.syncTranscriptConversationSettledChrome();
    }

    isActiveTranscriptConversation(summaryId: string): boolean {
        return this.host.transcriptOpenSummaryId === summaryId
            && (this.host.transcriptSheet !== undefined || this.host.agentsHubInlineActive);
    }

    resolveActiveTranscriptChatHost(): HTMLElement | undefined {
        const host = this.host.agentsHubInlineChatHost ?? this.host.transcriptChatHost;
        return host?.isConnected ? host : undefined;
    }

    resolveTranscriptRefreshContext(): {
        project: MobileProjectEntry;
        summary: QaapAgentConversationSummaryDTO;
        chatHost: HTMLElement;
    } | undefined {
        const project = this.host.transcriptOpenProject;
        const summaryId = this.host.transcriptOpenSummaryId;
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (!project || !summaryId || !chatHost) {
            return undefined;
        }
        const summary = this.host.conversationIndexUi.conversationsForProject(project).find(c => c.id === summaryId)
            ?? this.host.transcriptOpenSummary;
        if (!summary) {
            return undefined;
        }
        return { project, summary, chatHost };
    }

    stopTranscriptLiveWatch(): void {
        this.transcriptTurnVisuallySettledActive = false;
        if (this.sseDeltaResyncTimer !== undefined) {
            window.clearTimeout(this.sseDeltaResyncTimer);
            this.sseDeltaResyncTimer = undefined;
        }
        if (this.sseRenderRafId) {
            cancelAnimationFrame(this.sseRenderRafId);
            this.sseRenderRafId = 0;
        }
        if (this.sseRenderTimer !== undefined) {
            window.clearTimeout(this.sseRenderTimer);
            this.sseRenderTimer = undefined;
        }
        this.pendingSseRenderConv = undefined;
        this.lastMountedApprovalId = undefined;
        this.lastInlineApprovalSyncKey = undefined;
        this.transcriptPreviewPollIntervalMs = TRANSCRIPT_PREVIEW_POLL_BASE_MS;
        this.transcriptPreviewPollMisses = 0;
        this.stopTranscriptVisualVerificationPoll();
        this.stopTranscriptComposerActivityRefresh();
        this.transcriptLiveController?.stopWatch();
        this.host.transcriptScheduleRefresh = undefined;
        this.stopTranscriptApprovalRefresh();
        this.stopTranscriptPreviewOfferRefresh();
    }

    stopTranscriptApprovalRefresh(): void {
        if (this.host.transcriptApprovalRefreshTimer !== undefined) {
            window.clearTimeout(this.host.transcriptApprovalRefreshTimer);
            this.host.transcriptApprovalRefreshTimer = undefined;
        }
    }

    scheduleTranscriptApprovalRefresh(): void {
        this.stopTranscriptApprovalRefresh();
        if (!this.host.transcriptOpenSummaryId || !this.host.transcriptLastConv
            || !conversationUsesInteractiveApprovals(this.host.transcriptLastConv)) {
            return;
        }
        this.host.transcriptApprovalRefreshTimer = window.setTimeout(() => {
            this.host.transcriptApprovalRefreshTimer = undefined;
            void this.refreshTranscriptApprovals();
        }, TRANSCRIPT_APPROVAL_REFRESH_MS);
    }

    async refreshTranscriptApprovals(): Promise<void> {
        if (!this.host.transcriptOpenSummaryId) {
            return;
        }
        try {
            this.host.cachedAgentApprovals = await fetchAgentApprovals(this.host.transcriptOpenProject
                ? this.host.projectsService.getProjectCwd(this.host.transcriptOpenProject)
                : this.host.transcriptOpenSummary?.cwd);
            if (this.host.transcriptLastConv) {
                this.syncTranscriptPendingApproval(this.host.transcriptLastConv);
            }
        } catch {
            /* best-effort */
        } finally {
            if (this.host.transcriptLastConv?.status === 'streaming'
                && conversationUsesInteractiveApprovals(this.host.transcriptLastConv)) {
                this.scheduleTranscriptApprovalRefresh();
            }
        }
    }

    ensureTranscriptLiveController(): QaapTranscriptLiveController {
        if (!this.transcriptLiveController) {
            this.transcriptLiveController = new QaapTranscriptLiveController({
                isDocumentVisible: () => isTranscriptDocumentVisible(),
                isWatching: id => this.isWatchingOpenTranscript(id),
                getOpenSummary: () => this.host.transcriptOpenSummary,
                setOpenSummary: summary => { this.host.transcriptOpenSummary = summary; },
                getLastConv: () => this.host.transcriptLastConv,
                setLastConv: conv => { this.host.transcriptLastConv = conv; },
                getLastSseDeltaAt: () => this.host.transcriptLastSseDeltaAt,
                setLastSseDeltaAt: at => {
                    this.host.transcriptLastSseDeltaAt = at;
                },
                findSummaryById: id => this.host.conversations?.findSummaryById(id),
                refreshConversation: options => this.refreshOpenTranscriptConversation(options),
                renderConversation: conv => {
                    const chatHost = this.resolveActiveTranscriptChatHost();
                    if (chatHost) {
                        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
                    }
                },
                onApprovalRefresh: () => this.scheduleTranscriptApprovalRefresh(),
                onStatusSettled: () => this.syncTranscriptConversationSettledChrome(),
                conversationsOnDidChange: this.host.conversations?.onDidChange ?? TheiaEvent.None,
            });
        }
        return this.transcriptLiveController;
    }

    renderTranscriptInlineApproval(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        removeTranscriptPendingApprovalHosts(host);
        this.syncTranscriptPendingApproval(conv);
    }

    /** Whether the backend reports a real, answerable approval for this tool call. */
    hasPendingTranscriptToolApproval(conversationId: string, toolUseId: string): boolean {
        return !!findTranscriptToolApproval(this.host.cachedAgentApprovals, conversationId, toolUseId);
    }

    getPendingTranscriptToolApproval(
        conversationId: string,
        toolUseId: string,
    ): QaapAgentApprovalRequestDTO | undefined {
        return findTranscriptToolApproval(this.host.cachedAgentApprovals, conversationId, toolUseId);
    }

    syncTranscriptPendingApproval(conv: QaapAgentConversationDTO): void {
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (!conversationUsesInteractiveApprovals(conv)) {
            if (chatHost && this.lastInlineApprovalSyncKey !== undefined) {
                removeTranscriptPendingApprovalHosts(chatHost);
                this.lastInlineApprovalSyncKey = undefined;
            }
            if (this.lastMountedApprovalId !== undefined) {
                clearTranscriptPendingApprovalBar(this.host.transcriptComposerHost);
                this.lastMountedApprovalId = undefined;
            }
            return;
        }
        const pending = resolveTranscriptInlineApproval(this.host.cachedAgentApprovals, conv.id);
        const pendingId = pending?.id;
        const syncKey = this.buildTranscriptApprovalSyncKey(chatHost, conv, pendingId);
        if (syncKey === this.lastInlineApprovalSyncKey && pendingId === this.lastMountedApprovalId) {
            recordTranscriptRenderMetric('approval_sync_skipped');
            return;
        }
        recordTranscriptRenderMetric('approval_sync');
        this.lastInlineApprovalSyncKey = syncKey;
        if (chatHost) {
            this.reconcileTranscriptInlineToolApprovalCards(chatHost, conv);
        }
        if (pendingId === this.lastMountedApprovalId) {
            return;
        }
        this.lastMountedApprovalId = pendingId;
        const onSettled = (): void => {
            this.stopTranscriptApprovalRefresh();
            void this.refreshTranscriptApprovals();
            this.ensureTranscriptConversationRefresh();
        };
        mountTranscriptPendingApprovalBar(
            this.host.transcriptComposerHost,
            pending,
            {
                onApprove: () => {
                    if (!pending) {
                        return;
                    }
                    void respondToTranscriptApproval(pending.id, 'approve', { callbacks: { onSettled } });
                },
                onReject: () => {
                    if (!pending) {
                        return;
                    }
                    void respondToTranscriptApproval(pending.id, 'reject', { callbacks: { onSettled } });
                },
            },
        );
        if (pending) {
            scrollTranscriptPendingApprovalIntoView(this.host.transcriptComposerHost);
        }
    }

    protected buildTranscriptApprovalSyncKey(
        chatHost: HTMLElement | undefined,
        conv: QaapAgentConversationDTO,
        pendingId: string | undefined,
    ): string {
        const approvals = this.host.cachedAgentApprovals
            .filter(approval => approval.conversationId === conv.id)
            .map(approval => `${approval.id}:${approval.toolUseId ?? ''}:${approval.kind}`)
            .sort()
            .join(',');
        const visibleToolIds = chatHost
            ? [...chatHost.querySelectorAll<HTMLDetailsElement>(`details[${TRANSCRIPT_TOOL_USE_ID_ATTR}]`)]
                .map(pill => pill.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR) ?? '')
                .filter(Boolean)
                .sort()
                .join(',')
            : '';
        const mountedInlineCards = chatHost
            ? [...chatHost.querySelectorAll<HTMLElement>(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`)]
                .map(card => card.closest<HTMLDetailsElement>(`details[${TRANSCRIPT_TOOL_USE_ID_ATTR}]`)?.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR) ?? '')
                .filter(Boolean)
                .sort()
                .join(',')
            : '';
        return [
            conv.id,
            conv.status,
            pendingId ?? '',
            approvals,
            visibleToolIds,
            mountedInlineCards,
        ].join('|');
    }

    /**
     * Keep the per-pill "Allow <tool>?" cards in sync with the approvals the backend
     * actually reported: mount a card on the matching pill when a real approval is
     * pending and drop cards whose approval was answered or never existed. Without
     * this, every still-running tool segment looked like a permission prompt.
     */
    protected reconcileTranscriptInlineToolApprovalCards(chatHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        const pills = chatHost.querySelectorAll<HTMLDetailsElement>(`details[${TRANSCRIPT_TOOL_USE_ID_ATTR}]`);
        pills.forEach(pill => {
            const toolUseId = pill.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
            if (!toolUseId) {
                return;
            }
            const segment = this.findTranscriptToolSegment(conv, toolUseId);
            const shouldShow = !!segment
                && isPendingTranscriptToolSegment(segment)
                && this.hasPendingTranscriptToolApproval(conv.id, toolUseId);
            const card = pill.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`);
            if (shouldShow && !card && segment) {
                let body = pill.querySelector<HTMLElement>('.theia-mobile-agent-tool-pill-body');
                if (!body) {
                    body = document.createElement('div');
                    body.className = 'theia-mobile-agent-tool-pill-body';
                    pill.append(body);
                }
                body.prepend(this.host.transcriptMessagesUi.createTranscriptToolApprovalActions(conv.id, segment));
                pill.open = true;
            } else if (!shouldShow && card) {
                card.remove();
            }
        });
    }

    protected hasInlineToolApprovalCard(chatHost: HTMLElement | undefined, toolUseId: string): boolean {
        return !!chatHost?.querySelector(
            `details[${TRANSCRIPT_TOOL_USE_ID_ATTR}="${CSS.escape(toolUseId)}"] .${TRANSCRIPT_APPROVAL_CARD_CLASS}`,
        );
    }

    protected findTranscriptToolSegment(
        conv: QaapAgentConversationDTO,
        toolUseId: string,
    ): Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> | undefined {
        for (let i = conv.messages.length - 1; i >= 0; i--) {
            for (const segment of conv.messages[i].segments ?? []) {
                if (segment.type === 'tool' && segment.toolUseId === toolUseId) {
                    return segment;
                }
            }
        }
        return undefined;
    }

    stopTranscriptPreviewOfferRefresh(): void {
        if (this.transcriptPreviewOfferTimer !== undefined) {
            window.clearTimeout(this.transcriptPreviewOfferTimer);
            this.transcriptPreviewOfferTimer = undefined;
        }
    }

    protected resolveTranscriptPreviewPollIntervalMs(): number {
        return Math.min(
            TRANSCRIPT_PREVIEW_POLL_MAX_MS,
            TRANSCRIPT_PREVIEW_POLL_BASE_MS + this.transcriptPreviewPollMisses * 400,
        );
    }

    scheduleTranscriptPreviewOfferRefresh(
        conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,
        options?: { readonly restart?: boolean },
    ): void {
        if (!options?.restart && this.transcriptPreviewOfferTimer !== undefined) {
            return;
        }
        this.stopTranscriptPreviewOfferRefresh();
        if (!this.host.transcriptOpenSummaryId || !conv || !isTranscriptDocumentVisible()) {
            return;
        }
        const shouldWatch = conversationShouldWatchDevPreview(conv, window.location.origin)
            || this.host.transcriptPreviewRequestPending;
        const settlePollActive = conv.status !== 'streaming'
            && shouldWatch
            && (this.transcriptPreviewSettlePollUntil ?? 0) > Date.now();
        if (conv.status !== 'streaming' && !settlePollActive) {
            return;
        }
        if (!shouldWatch) {
            return;
        }
        this.transcriptPreviewOfferTimer = window.setTimeout(() => {
            this.transcriptPreviewOfferTimer = undefined;
            void this.refreshTranscriptPreviewOffer(conv);
        }, this.transcriptPreviewPollIntervalMs);
    }

    async refreshTranscriptPreviewOffer(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): Promise<void> {
        if (!conv || !this.host.transcriptOpenSummaryId || !isTranscriptDocumentVisible()) {
            return;
        }
        try {
            this.kickoffTranscriptDevPreviewBootstrap(conv);
            const readyUrl = await this.resolveReadyTranscriptPreviewUrl(conv);
            if (readyUrl) {
                this.transcriptPreviewPollMisses = 0;
                this.transcriptPreviewPollIntervalMs = TRANSCRIPT_PREVIEW_POLL_BASE_MS;
                await this.openReadyTranscriptPreviewUrl(readyUrl, conv);
                const project = this.host.transcriptOpenProject;
                if (project && project.previewUrl !== readyUrl) {
                    const updated = { ...project, previewUrl: readyUrl };
                    this.host.transcriptOpenProject = updated;
                    void this.host.projectsService.recordProjectPreviewUrl(updated, readyUrl).catch(() => undefined);
                }
            } else {
                this.transcriptPreviewPollMisses += 1;
                this.transcriptPreviewPollIntervalMs = this.resolveTranscriptPreviewPollIntervalMs();
                const bootstrap = this.host.projectBootstrap;
                if (bootstrap) {
                    void this.maybeReportTranscriptPreviewBootstrapFailure(conv, bootstrap);
                }
            }
        } catch {
            /* best-effort */
        } finally {
            const shouldWatch = conversationShouldWatchDevPreview(conv, window.location.origin)
                || this.host.transcriptPreviewRequestPending;
            const keepPolling = conv.status === 'streaming'
                ? shouldWatch
                : shouldWatch && (this.transcriptPreviewSettlePollUntil ?? 0) > Date.now();
            if (keepPolling) {
                this.scheduleTranscriptPreviewOfferRefresh(conv);
            }
        }
    }

    protected async resolveReadyTranscriptPreviewUrl(conv: QaapAgentConversationDTO): Promise<string | undefined> {
        const readyUrl = await resolveReadyTranscriptPreviewUrlFromProbe(
            conv,
            port => probeQaapDevPreviewPort(port),
            window.location.origin,
        );
        return readyUrl ? normalizePreviewUrlForSameOrigin(readyUrl) : undefined;
    }

    renderTranscriptInlinePreviewOffer(_host: HTMLElement, _previewUrl: string): void {
        /* Preview opens in the Preview tab via refreshTranscriptPreviewOffer. */
    }

    ensureTranscriptConversationRefresh(): void {
        const context = this.resolveTranscriptRefreshContext();
        if (!context || !this.isWatchingOpenTranscript(context.summary.id)) {
            this.stopTranscriptVisualVerificationPoll();
            return;
        }
        if (context.summary.visualVerificationPending) {
            this.scheduleTranscriptVisualVerificationPoll(context.summary.id);
        } else {
            this.stopTranscriptVisualVerificationPoll();
        }
        if (!this.host.transcriptScheduleRefresh) {
            this.scheduleTranscriptConversationRefresh(context.project, context.summary, context.chatHost);
            void this.refreshOpenTranscriptConversation({ forcePoll: true });
            return;
        }
        const liveStatus = this.host.transcriptLastConv?.status ?? context.summary.status;
        if (liveStatus !== 'streaming') {
            void this.refreshOpenTranscriptConversation({ forcePoll: true });
            return;
        }
        this.host.transcriptScheduleRefresh();
    }

    protected scheduleTranscriptVisualVerificationPoll(conversationId: string): void {
        if (this.transcriptVisualVerificationPollTimer !== undefined) {
            return;
        }
        this.transcriptVisualVerificationPollUntil = Date.now() + TRANSCRIPT_VISUAL_VERIFICATION_POLL_BUDGET_MS;
        const tick = (): void => {
            this.transcriptVisualVerificationPollTimer = undefined;
            if (!this.isWatchingOpenTranscript(conversationId)) {
                this.stopTranscriptVisualVerificationPoll();
                return;
            }
            const summary = this.host.transcriptOpenSummary;
            if (!summary || summary.id !== conversationId || !summary.visualVerificationPending) {
                this.stopTranscriptVisualVerificationPoll();
                return;
            }
            if ((this.transcriptVisualVerificationPollUntil ?? 0) <= Date.now()) {
                this.stopTranscriptVisualVerificationPoll();
                return;
            }
            void this.refreshOpenTranscriptConversation({ forcePoll: true });
            this.transcriptVisualVerificationPollTimer = window.setTimeout(tick, TRANSCRIPT_VISUAL_VERIFICATION_POLL_MS);
        };
        this.transcriptVisualVerificationPollTimer = window.setTimeout(tick, TRANSCRIPT_VISUAL_VERIFICATION_POLL_MS);
    }

    protected stopTranscriptVisualVerificationPoll(): void {
        if (this.transcriptVisualVerificationPollTimer !== undefined) {
            window.clearTimeout(this.transcriptVisualVerificationPollTimer);
            this.transcriptVisualVerificationPollTimer = undefined;
        }
        this.transcriptVisualVerificationPollUntil = undefined;
    }

    scheduleTranscriptConversationRefresh(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        _chatHost: HTMLElement,
    ): void {
        this.transcriptTurnVisuallySettledActive = false;
        warmAgentTurnPath(
            this.host.projectsService.getProjectCwd(project) ?? summary.cwd,
            { warmLiveTransport: () => this.host.conversations?.warmLiveTransport() },
        );
        const controller = this.ensureTranscriptLiveController();
        controller.watch(summary.id);
        this.bindOpenTranscriptThreadStore(summary.id);
        this.host.transcriptScheduleRefresh = controller.onScheduleRefresh;
        this.scheduleTranscriptApprovalRefresh();
    }

    renderOpenTranscriptPlaceholder(
        chatHost: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const preview = summary.lastMessagePreview?.trim();
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, {
            id: summary.id,
            cwd: summary.cwd,
            agentId: summary.agentId,
            title: summary.title,
            status: summary.status,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: preview && summary.lastMessageRole ? [{
                id: `${summary.id}:summary-preview`,
                role: summary.lastMessageRole,
                content: preview,
                createdAt: summary.updatedAt,
            }] : [],
        });
    }

    /** Paint cached messages immediately when opening a conversation (sidebar / hub). */
    applyCachedTranscriptOnOpen(
        summary: QaapAgentConversationSummaryDTO,
        chatHost: HTMLElement,
    ): boolean {
        const cached = this.readCachedTranscriptConversation(summary.id);
        if (!cached || (cached.messages.length === 0 && resolveTranscriptEffectiveStatus(cached) !== 'streaming')) {
            return false;
        }
        // Safety net: merge the fresh summary status into the cached document so
        // the transcript never shows a stale streaming/idle indicator on reopen.
        const synced = cached.status !== summary.status || cached.updatedAt < summary.updatedAt
            ? { ...cached, status: summary.status, updatedAt: Math.max(cached.updatedAt, summary.updatedAt) }
            : cached;
        this.host.transcriptLastConv = synced;
        this.host.transcriptLastFingerprint = this.conversationTranscriptFingerprint(synced);
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, synced);
        this.host.conversations?.cacheDocument(synced);
        return true;
    }

    peekCachedOpenTranscript(conversationId: string): QaapAgentConversationDTO | undefined {
        return this.readCachedTranscriptConversation(conversationId);
    }

    reconcileConversationListSummary(full: QaapAgentConversationDTO): QaapAgentConversationSummaryDTO {
        const snapshot = conversationToSummary(full);
        const stored = this.host.conversations?.findSummaryById(full.id);
        const shouldPersist = !stored
            || stored.status !== snapshot.status
            || snapshot.updatedAt > stored.updatedAt
            || stored.activityLabel !== snapshot.activityLabel;
        if (shouldPersist) {
            this.host.conversations?.recordSnapshot(snapshot);
        }
        return snapshot;
    }

    async resolveOpenTranscriptConversation(
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<QaapAgentConversationDTO | undefined> {
        if (summary.source === 'theia-chat' || summary.id.startsWith('theia-chat-service:')) {
            return this.host.getChatServiceConversation(summary);
        }
        try {
            return await getConversation(summary.id);
        } catch {
            if (summary.sessionId) {
                return this.host.getChatServiceConversation(summary);
            }
            return undefined;
        }
    }

    async refreshOpenTranscriptConversation(
        options?: QaapTranscriptLiveRefreshOptions,
    ): Promise<void> {
        const activeId = this.host.transcriptOpenSummaryId;
        if (this.refreshInFlight && this.refreshInFlightConversationId === activeId) {
            if (options?.forceStatusSettle) {
                return this.refreshInFlight.then(() => this.refreshOpenTranscriptConversation(options));
            }
            return this.refreshInFlight;
        }
        this.refreshInFlightConversationId = activeId;
        this.refreshInFlight = this.doRefreshOpenTranscriptConversation(options).finally(() => {
            this.refreshInFlight = undefined;
            this.refreshInFlightConversationId = undefined;
        });
        return this.refreshInFlight;
    }

    protected async doRefreshOpenTranscriptConversation(
        options?: QaapTranscriptLiveRefreshOptions,
    ): Promise<void> {
        const context = this.resolveTranscriptRefreshContext();
        if (!context) {
            return;
        }
        const { project: activeProject, summary: activeSummary, chatHost: activeChatHost } = context;
        if (this.host.transcriptHeaderUi.isPendingNewChatSummary(activeSummary)) {
            return;
        }
        if (!this.isActiveTranscriptConversation(activeSummary.id)) {
            return;
        }
        if (shouldSkipStreamingTranscriptRefetch(this.host.transcriptLastConv, this.host.transcriptLastSseDeltaAt)
            && !options?.forceStatusSettle
            && !options?.forcePoll) {
            return;
        }
        const localSnapshot = options?.forcePoll
            ? this.readCachedTranscriptConversation(activeSummary.id)
            : undefined;
        if (localSnapshot && localSnapshot.messages.length > 0) {
            this.host.transcriptLastConv = localSnapshot;
            const cacheFingerprint = this.conversationTranscriptFingerprint(localSnapshot);
            if (this.host.transcriptLastFingerprint !== cacheFingerprint) {
                this.host.transcriptLastFingerprint = cacheFingerprint;
                this.host.transcriptMessagesUi.renderTranscriptMessages(activeChatHost, localSnapshot);
            }
        }
        try {
            const full = await this.resolveOpenTranscriptConversation(activeSummary);
            if (!full) {
                throw new Error('Conversation not found');
            }
            if (!this.isActiveTranscriptConversation(activeSummary.id) || !activeChatHost.isConnected) {
                return;
            }
            const fingerprint = this.conversationTranscriptFingerprint(full);
            const fingerprintUnchanged = fingerprint === this.host.transcriptLastFingerprint;
            const forceStatusSettle = options?.forceStatusSettle
                || shouldForceTranscriptRenderOnStatusSettle(
                    this.host.transcriptLastConv,
                    full,
                    fingerprintUnchanged,
                );
            if (!fingerprintUnchanged || forceStatusSettle) {
                await this.host.syncTranscriptPreviewFromConversation(activeProject, activeSummary, full);
            }
            this.host.transcriptLastConv = full;
            this.cacheTranscriptConversation(full);
            const reconciledSummary = this.reconcileConversationListSummary(full);
            this.host.transcriptOpenSummary = reconciledSummary;
            if (this.host.transcriptComposerSummary?.id === full.id
                && this.host.transcriptComposerPrefsConvId !== full.id) {
                this.host.transcriptStickyComposerUi.applyTranscriptComposerPrefsFromConversation(full, activeProject, activeSummary);
                this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            }
            if (fingerprintUnchanged && !forceStatusSettle) {
                if (conversationUsesInteractiveApprovals(full)) {
                    this.syncTranscriptPendingApproval(full);
                }
                if (reconciledSummary.status !== 'streaming' && this.host.transcriptLastStatus === 'streaming') {
                    this.syncTranscriptConversationSettledChrome();
                }
                if (full.status !== 'streaming' && !this.host.transcriptPreviewRequestPending) {
                    this.host.transcriptLastSseDeltaAt = undefined;
                    this.clearTranscriptSemanticProgressClock();
                }
                return;
            }
            this.host.transcriptLastFingerprint = fingerprint;
            if (full.status === 'streaming') {
                this.touchTranscriptSemanticProgressFromConversation(full);
            }
            this.host.transcriptMessagesUi.renderTranscriptMessages(activeChatHost, full);
            if (conversationUsesInteractiveApprovals(full)) {
                this.syncTranscriptPendingApproval(full);
            }
            if (this.host.transcriptComposerSummary?.id === full.id) {
                this.host.transcriptStickyComposerUi.refreshTranscriptComposerActivityIfNeeded(full);
            }
            if (this.host.transcriptSheet) {
                const surfaceTab = this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(activeProject);
                this.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab(surfaceTab);
                this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(activeProject, activeSummary, surfaceTab);
                this.host.executionSurfaceTabsUi.syncExecutionSurfaceChrome(activeProject);
            }
            this.host.handleTranscriptStatusForAutoVerify(activeProject, activeSummary, full.status);
            if (full.status !== 'streaming') {
                this.host.transcriptLastSseDeltaAt = undefined;
                this.clearTranscriptSemanticProgressClock();
                this.syncTranscriptConversationSettledChrome();
            } else {
                this.host.transcriptLastStatus = full.status;
            }
            if (full.status === 'streaming') {
                this.scheduleTranscriptApprovalRefresh();
                this.maybeActivateTranscriptDevPreview(full);
            } else if (conversationShouldWatchDevPreview(full, window.location.origin)) {
                void this.finalizeTranscriptDevPreviewAfterSettle();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[qaap] transcript refresh failed:', message);
            MobileSnackbar.show(message, { kind: 'warning', duration: 3200 });
        }
    }

    isWatchingOpenTranscript(conversationId: string): boolean {
        return this.host.transcriptOpenSummaryId === conversationId
            && this.isActiveTranscriptConversation(conversationId);
    }
}
