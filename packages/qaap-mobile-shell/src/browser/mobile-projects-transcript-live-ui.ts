// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

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
import { agentMessageHasVisualVerificationMarker } from '../common/qaap-visual-verification';
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
import { applyCachedTranscriptOnOpenExtracted, doRefreshOpenTranscriptConversationExtracted, isTrustedOpenTranscriptCache, reconcileConversationListSummaryExtracted, refreshOpenTranscriptConversationExtracted, renderOpenTranscriptPlaceholderExtracted, resolveOpenTranscriptConversationExtracted, scheduleTranscriptConversationRefreshExtracted } from './mobile-projects-transcript-live-ui-activity2';
import { applyOptimisticConversationCancelExtracted, applyOptimisticFailedTaskRetryExtracted, applyOptimisticStreamTimeoutRetryExtracted, bindOpenTranscriptThreadStoreExtracted, clearTranscriptSemanticProgressClockExtracted, ensureVisibilityResumeListenerExtracted, flushPendingSseRenderExtracted, handleTranscriptSseMessageExtracted, isActiveTranscriptNearBottomExtracted, pauseTranscriptBackgroundRendersExtracted, readOpenTranscriptRollbackSnapshotExtracted, resolveLiveSseMessageExtracted, restoreOpenTranscriptSnapshotExtracted, resyncOpenTranscriptStreamAfterTimeoutExtracted, schedulePendingSseRenderExtracted, scheduleSseDeltaResyncExtracted, seedTranscriptSemanticProgressClockExtracted, touchTranscriptSemanticProgressFromConversationExtracted } from './mobile-projects-transcript-live-ui-render2';
import { applyTranscriptSseRenderExtracted, ensureBootstrapPreviewListenerExtracted, ensureTranscriptDevPreviewWatchExtracted, finalizeTranscriptDevPreviewAfterSettleExtracted, kickoffTranscriptDevPreviewBootstrapExtracted, maybeActivateTranscriptDevPreviewExtracted, maybeReportTranscriptPreviewBootstrapFailureExtracted, maybeSyncTranscriptVisuallySettledChromeExtracted, onTranscriptUserMessageSubmittedExtracted, openReadyTranscriptPreviewUrlExtracted, resolveTranscriptRefreshContextExtracted, scheduleTranscriptComposerActivityRefreshExtracted, stopTranscriptComposerActivityRefreshExtracted, syncTranscriptConversationSettledChromeExtracted } from './mobile-projects-transcript-live-ui-streaming2';
import { buildTranscriptApprovalSyncKeyExtracted, ensureTranscriptConversationRefreshExtracted, ensureTranscriptLiveControllerExtracted, findTranscriptToolSegmentExtracted, getPendingTranscriptToolApprovalExtracted, hasInlineToolApprovalCardExtracted, reconcileTranscriptInlineToolApprovalCardsExtracted, refreshTranscriptApprovalsExtracted, refreshTranscriptPreviewOfferExtracted, resolveReadyTranscriptPreviewUrlExtracted, resolveTranscriptPreviewPollIntervalMsExtracted, scheduleTranscriptApprovalRefreshExtracted, scheduleTranscriptPreviewOfferRefreshExtracted, scheduleTranscriptVisualVerificationPollExtracted, stopTranscriptApprovalRefreshExtracted, stopTranscriptLiveWatchExtracted, stopTranscriptPreviewOfferRefreshExtracted, stopTranscriptVisualVerificationPollExtracted, syncTranscriptPendingApprovalExtracted } from './mobile-projects-transcript-live-ui-timeline2';

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
    transcriptPreviewSuppressedByUser: boolean;
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
export const TRANSCRIPT_APPROVAL_REFRESH_MS = 320;
/** Coalesce bursty SSE token deltas into one paint per frame on mobile. */
export const TRANSCRIPT_SSE_COALESCE_RAF = true;
/** Debounce composer activity stack scans while the agent is still streaming. */
export const TRANSCRIPT_COMPOSER_ACTIVITY_DEBOUNCE_MS = 450;
export const TRANSCRIPT_PREVIEW_POLL_BASE_MS = 900;
export const TRANSCRIPT_PREVIEW_POLL_MAX_MS = 5_000;
/** While server-side capture runs, poll the open transcript until evidence lands. */
export const TRANSCRIPT_VISUAL_VERIFICATION_POLL_MS = 3_000;
// Cover a cold dev-server boot (up to ~180s) before the headless capture can run, so the
// skeleton chip still resolves in place on slow projects instead of stranding until reload.
export const TRANSCRIPT_VISUAL_VERIFICATION_POLL_BUDGET_MS = 180_000;

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
        touchTranscriptSemanticProgressFromConversationExtracted(this, conv);
    }

    clearTranscriptSemanticProgressClock(): void {
        clearTranscriptSemanticProgressClockExtracted(this);
    }

    seedTranscriptSemanticProgressClock(): void {
        seedTranscriptSemanticProgressClockExtracted(this);
    }

    readOpenTranscriptRollbackSnapshot(conversationId: string): QaapAgentConversationDTO | undefined {
        return readOpenTranscriptRollbackSnapshotExtracted(this, conversationId);
    }

    restoreOpenTranscriptSnapshot(conv: QaapAgentConversationDTO): void {
        restoreOpenTranscriptSnapshotExtracted(this, conv);
    }

    applyOptimisticConversationCancel(summary: QaapAgentConversationSummaryDTO): void {
        applyOptimisticConversationCancelExtracted(this, summary);
    }

    applyOptimisticStreamTimeoutRetry(summary: QaapAgentConversationSummaryDTO): void {
        applyOptimisticStreamTimeoutRetryExtracted(this, summary);
    }

    applyOptimisticFailedTaskRetry(summary: QaapAgentConversationSummaryDTO): void {
        applyOptimisticFailedTaskRetryExtracted(this, summary);
    }

    async resyncOpenTranscriptStreamAfterTimeout(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return resyncOpenTranscriptStreamAfterTimeoutExtracted(this, project, summary);
    }

    protected ensureVisibilityResumeListener(): void {
        ensureVisibilityResumeListenerExtracted(this);
    }

    conversationTranscriptFingerprint(conv: QaapAgentConversationDTO): string {
        return buildConversationTranscriptFingerprint(conv);
    }

    handleTranscriptSseMessage(event: ConversationLiveMessageEvent): void {
        handleTranscriptSseMessageExtracted(this, event);
    }

    protected sseDeltaResyncTimer: number | undefined;

    protected scheduleSseDeltaResync(): void {
        scheduleSseDeltaResyncExtracted(this);
    }

    protected resolveLiveSseMessage(event: ConversationLiveMessageEvent): QaapAgentMessageDTO | undefined {
        return resolveLiveSseMessageExtracted(this, event);
    }

    protected pauseTranscriptBackgroundRenders(): void {
        pauseTranscriptBackgroundRendersExtracted(this);
    }

    protected schedulePendingSseRender(): void {
        schedulePendingSseRenderExtracted(this);
    }

    protected isActiveTranscriptNearBottom(): boolean {
        return isActiveTranscriptNearBottomExtracted(this);
    }

    protected flushPendingSseRender(): void {
        flushPendingSseRenderExtracted(this);
    }

    protected cacheTranscriptConversation(document: QaapAgentConversationDTO): void {
        this.host.transcriptConversationCache.set(document.id, document);
        this.host.conversations?.cacheDocument(document);
    }

    protected bindOpenTranscriptThreadStore(conversationId: string): void {
        bindOpenTranscriptThreadStoreExtracted(this, conversationId);
    }

    protected unbindOpenTranscriptThreadStore(): void {
        this.threadStoreSummaryDispose.dispose();
        this.threadStoreSummaryDispose = Disposable.NULL;
    }

    protected readCachedTranscriptConversation(conversationId: string): QaapAgentConversationDTO | undefined {
        return this.host.conversations?.threadStore.getDocument(conversationId)
            ?? this.host.transcriptConversationCache.get(conversationId);
    }

    protected applyTranscriptSseRender(next: QaapAgentConversationDTO, eventMessage: QaapAgentMessageDTO,): void {
        applyTranscriptSseRenderExtracted(this, next, eventMessage);
    }

    protected scheduleTranscriptComposerActivityRefresh(conv: QaapAgentConversationDTO): void {
        scheduleTranscriptComposerActivityRefreshExtracted(this, conv);
    }

    stopTranscriptComposerActivityRefresh(): void {
        stopTranscriptComposerActivityRefreshExtracted(this);
    }

    syncTranscriptConversationSettledChrome(): void {
        syncTranscriptConversationSettledChromeExtracted(this);
    }

    ensureBootstrapPreviewListener(): void {
        ensureBootstrapPreviewListenerExtracted(this);
    }

    kickoffTranscriptDevPreviewBootstrap(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): void {
        kickoffTranscriptDevPreviewBootstrapExtracted(this, conv);
    }

    protected async maybeReportTranscriptPreviewBootstrapFailure(conv: QaapAgentConversationDTO, bootstrap: QaapProjectBootstrapService,): Promise<void> {
        return maybeReportTranscriptPreviewBootstrapFailureExtracted(this, conv, bootstrap);
    }

    protected async openReadyTranscriptPreviewUrl(readyUrl: string, _conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,): Promise<void> {
        return openReadyTranscriptPreviewUrlExtracted(this, readyUrl, _conv);
    }

    async finalizeTranscriptDevPreviewAfterSettle(): Promise<void> {
        return finalizeTranscriptDevPreviewAfterSettleExtracted(this);
    }

    protected maybeActivateTranscriptDevPreview(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): void {
        maybeActivateTranscriptDevPreviewExtracted(this, conv);
    }

    protected ensureTranscriptDevPreviewWatch(conv: QaapAgentConversationDTO, options?: { readonly restartPreviewPoll?: boolean },): void {
        ensureTranscriptDevPreviewWatchExtracted(this, conv, options);
    }

    onTranscriptUserMessageSubmitted(content: string, conv: QaapAgentConversationDTO): void {
        onTranscriptUserMessageSubmittedExtracted(this, content, conv);
    }

    maybeSyncTranscriptVisuallySettledChrome(conv: QaapAgentConversationDTO): void {
        maybeSyncTranscriptVisuallySettledChromeExtracted(this, conv);
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
        return resolveTranscriptRefreshContextExtracted(this);
    }

    stopTranscriptLiveWatch(): void {
        stopTranscriptLiveWatchExtracted(this);
    }

    stopTranscriptApprovalRefresh(): void {
        stopTranscriptApprovalRefreshExtracted(this);
    }

    scheduleTranscriptApprovalRefresh(): void {
        scheduleTranscriptApprovalRefreshExtracted(this);
    }

    async refreshTranscriptApprovals(): Promise<void> {
        return refreshTranscriptApprovalsExtracted(this);
    }

    ensureTranscriptLiveController(): QaapTranscriptLiveController {
        return ensureTranscriptLiveControllerExtracted(this);
    }

    renderTranscriptInlineApproval(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        removeTranscriptPendingApprovalHosts(host);
        this.syncTranscriptPendingApproval(conv);
    }

    /** Whether the backend reports a real, answerable approval for this tool call. */
    hasPendingTranscriptToolApproval(conversationId: string, toolUseId: string): boolean {
        return !!findTranscriptToolApproval(this.host.cachedAgentApprovals, conversationId, toolUseId);
    }

    getPendingTranscriptToolApproval(conversationId: string, toolUseId: string,): QaapAgentApprovalRequestDTO | undefined {
        return getPendingTranscriptToolApprovalExtracted(this, conversationId, toolUseId);
    }

    syncTranscriptPendingApproval(conv: QaapAgentConversationDTO): void {
        syncTranscriptPendingApprovalExtracted(this, conv);
    }

    protected buildTranscriptApprovalSyncKey(chatHost: HTMLElement | undefined, conv: QaapAgentConversationDTO, pendingId: string | undefined,): string {
        return buildTranscriptApprovalSyncKeyExtracted(this, chatHost, conv, pendingId);
    }

    protected reconcileTranscriptInlineToolApprovalCards(chatHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        reconcileTranscriptInlineToolApprovalCardsExtracted(this, chatHost, conv);
    }

    protected hasInlineToolApprovalCard(chatHost: HTMLElement | undefined, toolUseId: string): boolean {
        return hasInlineToolApprovalCardExtracted(this, chatHost, toolUseId);
    }

    protected findTranscriptToolSegment(conv: QaapAgentConversationDTO, toolUseId: string,): Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> | undefined {
        return findTranscriptToolSegmentExtracted(this, conv, toolUseId);
    }

    stopTranscriptPreviewOfferRefresh(): void {
        stopTranscriptPreviewOfferRefreshExtracted(this);
    }

    protected resolveTranscriptPreviewPollIntervalMs(): number {
        return resolveTranscriptPreviewPollIntervalMsExtracted(this);
    }

    scheduleTranscriptPreviewOfferRefresh(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv, options?: { readonly restart?: boolean },): void {
        scheduleTranscriptPreviewOfferRefreshExtracted(this, conv, options);
    }

    async refreshTranscriptPreviewOffer(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): Promise<void> {
        return refreshTranscriptPreviewOfferExtracted(this, conv);
    }

    protected async resolveReadyTranscriptPreviewUrl(conv: QaapAgentConversationDTO): Promise<string | undefined> {
        return resolveReadyTranscriptPreviewUrlExtracted(this, conv);
    }

    renderTranscriptInlinePreviewOffer(_host: HTMLElement, _previewUrl: string): void {
        /* Preview opens in the Preview tab via refreshTranscriptPreviewOffer. */
    }

    ensureTranscriptConversationRefresh(): void {
        ensureTranscriptConversationRefreshExtracted(this);
    }

    protected scheduleTranscriptVisualVerificationPoll(conversationId: string): void {
        scheduleTranscriptVisualVerificationPollExtracted(this, conversationId);
    }

    protected stopTranscriptVisualVerificationPoll(): void {
        stopTranscriptVisualVerificationPollExtracted(this);
    }

    scheduleTranscriptConversationRefresh(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, _chatHost: HTMLElement,): void {
        scheduleTranscriptConversationRefreshExtracted(this, project, summary, _chatHost);
    }

    renderOpenTranscriptPlaceholder(chatHost: HTMLElement, summary: QaapAgentConversationSummaryDTO,): void {
        renderOpenTranscriptPlaceholderExtracted(this, chatHost, summary);
    }

    applyCachedTranscriptOnOpen(summary: QaapAgentConversationSummaryDTO, chatHost: HTMLElement,): boolean {
        return applyCachedTranscriptOnOpenExtracted(this, summary, chatHost);
    }

    isTrustedOpenTranscriptCache(cached: QaapAgentConversationDTO, summary: QaapAgentConversationSummaryDTO): boolean {
        return isTrustedOpenTranscriptCache(cached, summary);
    }

    peekCachedOpenTranscript(conversationId: string): QaapAgentConversationDTO | undefined {
        return this.readCachedTranscriptConversation(conversationId);
    }

    reconcileConversationListSummary(full: QaapAgentConversationDTO): QaapAgentConversationSummaryDTO {
        return reconcileConversationListSummaryExtracted(this, full);
    }

    async resolveOpenTranscriptConversation(summary: QaapAgentConversationSummaryDTO,): Promise<QaapAgentConversationDTO | undefined> {
        return resolveOpenTranscriptConversationExtracted(this, summary);
    }

    async refreshOpenTranscriptConversation(options?: QaapTranscriptLiveRefreshOptions,): Promise<void> {
        return refreshOpenTranscriptConversationExtracted(this, options);
    }

    protected async doRefreshOpenTranscriptConversation(options?: QaapTranscriptLiveRefreshOptions,): Promise<void> {
        return doRefreshOpenTranscriptConversationExtracted(this, options);
    }

    isWatchingOpenTranscript(conversationId: string): boolean {
        return this.host.transcriptOpenSummaryId === conversationId
            && this.isActiveTranscriptConversation(conversationId);
    }
}
