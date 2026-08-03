// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { normalizeAgentMessageContentForDisplay } from '../common/qaap-agent-message-content';
import { parseAgentLogForTranscript } from '../common/qaap-cli-transcript-stream';
import { dedupeAgentMessageTextSegments } from '../common/qaap-qaiq-stream';
import { resolveQaapTranscriptTrace, segmentsToTraceEvents, traceEventsToSegments, type QaapTranscriptTrace } from '../common/qaap-transcript-trace-model';
import { agentMessageHasStructuredTrace } from '../common/qaap-transcript-trace-lifecycle';
import { buildConversationTranscriptFingerprint, fingerprintTranscriptMessage, isStreamingTranscriptTailUnchanged, resolveStreamingTranscriptPatchDecision, resolveStreamingTranscriptPatchKind, TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, canStreamPatchAgentAppendTextSegment, canStreamPatchAgentAppendThinkingSegment, canStreamPatchAgentAppendToolSegment, canStreamPatchAgentSegmentsInPlace, canStreamPatchAgentSegmentsInPlaceWithAppend, canStreamPatchStdoutAgentContentOnly, type QaapTranscriptStreamingPatchNoneReason } from '../common/qaap-transcript-incremental-update';
import { TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS } from './qaap-transcript-inline-approval-ui';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { hasMobileExecutionEventTimeline, syncTranscriptStandaloneTurnProvenance } from './qaap-execution-event-timeline';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import {
    isTranscriptAgentTailStreaming,
    resolveTranscriptEffectiveStatus,
    shouldShowTranscriptEmptyQuickActions,
} from '../common/qaap-transcript-turn-status';
import {
    appendBeforeTranscriptLiveStatus,
    detachTranscriptLiveStatusFromScroller,
} from '../common/qaap-transcript-live-status';
import { recordTranscriptRenderMetric, type QaapTranscriptRenderMetricKind } from '../common/qaap-transcript-render-metrics';

/** Telemetry: attribute every patch-miss to the guard that rejected it. */
export const PATCH_NONE_REASON_METRIC: Record<QaapTranscriptStreamingPatchNoneReason, QaapTranscriptRenderMetricKind> = {
    'not-streaming': 'render_patch_none_not_streaming',
    'conversation-switched': 'render_patch_none_conversation_switched',
    'prior-diverged': 'render_patch_none_prior_diverged',
    'tail-empty': 'render_patch_none_tail_empty',
    'tail-unchanged': 'render_patch_none_tail_unchanged',
    'count-shrunk': 'render_patch_none_count_shrunk',
    'tail-role-unknown': 'render_patch_none_tail_role',
};

type TranscriptAgentPatchRejectReason = 'no_prev' | 'predicates' | 'applier' | 'thinking';

const AGENT_REPLACE_REASON_METRIC: Record<TranscriptAgentPatchRejectReason, QaapTranscriptRenderMetricKind> = {
    no_prev: 'render_patch_last_agent_replace_no_prev',
    predicates: 'render_patch_last_agent_replace_predicates',
    applier: 'render_patch_last_agent_replace_applier',
    thinking: 'render_patch_last_agent_replace_thinking',
};
import { attachTranscriptScrollToBottomButton } from './qaap-transcript-scroll-to-bottom';
import {
    attachTranscriptScrollIntentObserver,
    transcriptHasActiveSelection,
    transcriptHasInteractiveFocus,
} from './qaap-transcript-scroll-intent';
import {
    ensureTranscriptScrollController,
    type TranscriptScrollController,
} from './qaap-transcript-scroll-controller';
import { attachTranscriptUserScrollPin } from './qaap-transcript-user-scroll-pin';
import { attachTranscriptInlineSearch } from './qaap-transcript-inline-search';
import {
    attachTranscriptReadPositionPersistence,
    resolveStoredTranscriptReadMessageIndex,
    restoreTranscriptReadPosition,
} from './qaap-transcript-read-position';
import { attachTranscriptActivityTimelineStickySummary } from './qaap-transcript-activity-timeline-sticky-summary';
import {
    attachTranscriptRowDeferObserver,
    shouldDeferTranscriptRowHeavyContent,
} from './qaap-transcript-row-defer';
import { normalizeAgentConversationFailures, type QaapAgentConversationDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import {
    extractLastFailedToolFromMessage,
    resolveAgentTurnFailureTechnicalContent,
} from '../common/qaap-agent-failure-message';
import type { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesUserUi } from './mobile-projects-transcript-messages-user-ui';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';
import { buildTranscriptAgentFailureDialogOptionsExtracted, clearTranscriptEmptyQuickActionsExtracted, createTranscriptAgentFailureRowExtracted, createTranscriptMessageRowExtracted, ensureLiveStatusBeforeRemovingActivityRowExtracted, syncTranscriptActivityRowExtracted, tryPatchStreamingAgentTextContentExtracted } from './mobile-projects-transcript-messages-render-ui-activity2';
import { applyTranscriptScrollAfterMutationExtracted, buildTranscriptVirtualFooterExtracted, createTranscriptContextCompactionRowExtracted, createTranscriptMessageRowAtIndexExtracted, findAppendedUserMessageIndexExtracted, findLastUserMessageIndexExtracted, normalizeConversationFailuresCachedExtracted, positionTranscriptVirtualListAtUserTurnExtracted, resolveTranscriptAgentSegmentsExtracted, resolveTranscriptMessageHostExtracted, restoreTranscriptOpeningPositionVirtualExtracted, restoreTranscriptScrollAnchorExtracted, scheduleTranscriptScrollAfterMutationExtracted, scrollTranscriptTurnStartIntoReadingPositionExtracted, scrollTranscriptVirtualListToIndexExtracted, setTranscriptAgentSegmentsCacheEntryExtracted, shouldFollowTranscriptTailExtracted, syncTranscriptAgentSegmentsCacheExtracted, transcriptAgentSegmentsCacheKeyExtracted, transcriptContextCompactionBoundaryIndexExtracted, transcriptRowRenderKeyExtracted, transcriptSegmentsSignatureExtracted, transcriptTextSignatureExtracted, withDerivedTranscriptSegmentsExtracted } from './mobile-projects-transcript-messages-render-ui-render2';
import { createTranscriptEmptyWelcomeExtracted, prepareTranscriptReadingAnchorWindowExtracted, renderTranscriptMessagesExtracted, renderTranscriptMessagesVirtualExtracted, restoreTranscriptOpeningPositionExtracted, scrollTranscriptToLastUserTurnExtracted } from './mobile-projects-transcript-messages-render-ui-streaming2';
import { attachTranscriptScrollChromeExtracted, markTranscriptMessageRowExtracted, settleVisuallySettledAgentTranscriptExtracted, tryPatchStreamingTranscriptMessagesExtracted, tryPatchStreamingTranscriptVirtualExtracted } from './mobile-projects-transcript-messages-render-ui-timeline2';

export class MobileProjectsTranscriptMessagesRenderUi {
    protected readonly transcriptAgentSegmentsCache = new Map<string, readonly QaapAgentMessageSegmentDTO[]>();
    protected transcriptAgentSegmentsCacheConversationId: string | undefined;
    /**
     * Tracks the most recent cache key inserted per message (`${conv.id}|${msg.id}`).
     * The cache key embeds a content signature that changes every streamed token, so
     * without this, a streaming tail message would insert a brand-new entry on every
     * tick — unbounded growth until the 1000-entry cap wipes the whole cache. Deleting
     * the message's previous entry before inserting the new one caps live growth at one
     * entry per message while still caching finished messages across re-renders.
     */
    protected readonly transcriptAgentSegmentsCacheKeyByMessage = new Map<string, string>();
    /**
     * Tracks which conversation the full scroll chrome (scroll-to-bottom button, scroll pin,
     * intent observer, inline search, read position, activity timeline, row defer observer) is
     * currently bound to. Re-creating this chrome on every render tick — especially the
     * scroll-to-bottom button, which starts hidden and needs a rAF + 100ms debounce to show
     * again — causes visible flicker during streaming. Only rebuild on conversation switch.
     */
    protected transcriptScrollChromeBoundConversationId: string | undefined;

    constructor(
        protected readonly host: MobileProjectsTranscriptMessagesHost,
        protected readonly workHub: WorkHubTranscriptBridge,
        protected readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        protected readonly userUi: MobileProjectsTranscriptMessagesUserUi,
        protected readonly artifactsUi: MobileProjectsTranscriptMessagesArtifactsUi,
        protected readonly toolUi: MobileProjectsTranscriptMessagesToolUi,
    ) { }

    resolveTranscriptMessageHost(host: HTMLElement): HTMLElement {
        return resolveTranscriptMessageHostExtracted(this, host);
    }

    resolveTranscriptAgentSegments(conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO,): QaapAgentMessageSegmentDTO[] | undefined {
        return resolveTranscriptAgentSegmentsExtracted(this, conv, msg);
    }

    protected syncTranscriptAgentSegmentsCache(conversationId: string): void {
        syncTranscriptAgentSegmentsCacheExtracted(this, conversationId);
    }

    protected setTranscriptAgentSegmentsCacheEntry(conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO, cacheKey: string, segments: readonly QaapAgentMessageSegmentDTO[],): void {
        setTranscriptAgentSegmentsCacheEntryExtracted(this, conv, msg, cacheKey, segments);
    }

    protected transcriptAgentSegmentsCacheKey(conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO): string {
        return transcriptAgentSegmentsCacheKeyExtracted(this, conv, msg);
    }

    protected transcriptTextSignature(text: string | undefined): string {
        return transcriptTextSignatureExtracted(this, text);
    }

    protected transcriptSegmentsSignature(segments: readonly QaapAgentMessageSegmentDTO[] | undefined): string {
        return transcriptSegmentsSignatureExtracted(this, segments);
    }

    protected withDerivedTranscriptSegments(msg: QaapAgentMessageDTO): QaapAgentMessageDTO {
        return withDerivedTranscriptSegmentsExtracted(this, msg);
    }

    /**
     * Failure normalization is O(messages); memoized per snapshot so the full
     * rebuild loop (which calls {@link createTranscriptMessageRowAtIndex} once
     * per row) stays O(N) instead of O(N²). Snapshots are immutable per tick,
     * so keying by object identity is safe.
     */
    private readonly normalizedFailuresCache = new WeakMap<QaapAgentConversationDTO, QaapAgentConversationDTO>();

    protected normalizeConversationFailuresCached(conv: QaapAgentConversationDTO): QaapAgentConversationDTO {
        return normalizeConversationFailuresCachedExtracted(this, conv);
    }

    protected transcriptRowRenderKey(conv: QaapAgentConversationDTO, index: number): string | undefined {
        return transcriptRowRenderKeyExtracted(this, conv, index);
    }

    createTranscriptMessageRowAtIndex(conv: QaapAgentConversationDTO, index: number): HTMLElement {
        return createTranscriptMessageRowAtIndexExtracted(this, conv, index);
    }

    protected transcriptContextCompactionBoundaryIndex(conv: QaapAgentConversationDTO): number | undefined {
        return transcriptContextCompactionBoundaryIndexExtracted(this, conv);
    }

    buildTranscriptVirtualFooter(conv: QaapAgentConversationDTO, options?: { readonly existingActivityRow?: HTMLElement | null },): HTMLElement[] {
        return buildTranscriptVirtualFooterExtracted(this, conv, options);
    }

    /** Activity row currently mounted in the transcript host or virtual footer. */
    protected findTranscriptStreamingActivityRow(messageHost: HTMLElement): HTMLElement | undefined {
        return messageHost.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`) ?? undefined;
    }

    protected createTranscriptContextCompactionRow(conv: QaapAgentConversationDTO): HTMLElement | undefined {
        return createTranscriptContextCompactionRowExtracted(this, conv);
    }

    protected resolveTranscriptScrollController(scroller: HTMLElement): TranscriptScrollController {
        return ensureTranscriptScrollController(scroller);
    }

    protected shouldFollowTranscriptTail(scroller: HTMLElement): boolean {
        return shouldFollowTranscriptTailExtracted(this, scroller);
    }

    protected captureTranscriptScrollAnchor(scroller: HTMLElement): ReturnType<TranscriptScrollController['captureAnchor']> {
        return this.resolveTranscriptScrollController(scroller).captureAnchor(scroller);
    }

    protected restoreTranscriptScrollAnchor(scroller: HTMLElement, anchor: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        restoreTranscriptScrollAnchorExtracted(this, scroller, anchor);
    }

    protected applyTranscriptScrollAfterMutation(messageHost: HTMLElement, anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        applyTranscriptScrollAfterMutationExtracted(this, messageHost, anchor);
    }

    protected scheduleTranscriptScrollAfterMutation(messageHost: HTMLElement, anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        scheduleTranscriptScrollAfterMutationExtracted(this, messageHost, anchor);
    }

    protected scrollTranscriptTurnStartIntoReadingPosition(messageHost: HTMLElement, row: HTMLElement): void {
        scrollTranscriptTurnStartIntoReadingPositionExtracted(this, messageHost, row);
    }

    protected scrollTranscriptFollowTail(scroller: HTMLElement): void {
        this.resolveTranscriptScrollController(scroller).onContentChanged(scroller);
    }

    protected findLastUserMessageRow(messageHost: HTMLElement): HTMLElement | undefined {
        return [...messageHost.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-user')].at(-1);
    }

    protected findLastUserMessageIndex(conv: QaapAgentConversationDTO): number {
        return findLastUserMessageIndexExtracted(this, conv);
    }

    protected findAppendedUserMessageIndex(previous: QaapAgentConversationDTO | undefined, next: QaapAgentConversationDTO,): number {
        return findAppendedUserMessageIndexExtracted(this, previous, next);
    }

    protected positionTranscriptVirtualListAtUserTurn(messageHost: HTMLElement, list: { scrollToIndex?: (index: number, contextPx?: number) => void }, userIndex: number,): void {
        positionTranscriptVirtualListAtUserTurnExtracted(this, messageHost, list, userIndex);
    }

    protected hasExplicitTranscriptMessageHash(): boolean {
        return typeof window !== 'undefined' && window.location.hash.startsWith('#qaap-transcript-message-');
    }

    protected scrollTranscriptVirtualListToIndex(list: { scrollToIndex?: (index: number, contextPx?: number) => void }, index: number, contextPx: number,): void {
        scrollTranscriptVirtualListToIndexExtracted(this, list, index, contextPx);
    }

    protected restoreTranscriptOpeningPositionVirtual(list: { scrollToIndex?: (index: number, contextPx?: number) => void }, conv: QaapAgentConversationDTO, contextPx: number,): boolean {
        return restoreTranscriptOpeningPositionVirtualExtracted(this, list, conv, contextPx);
    }

    protected createTranscriptEmptyWelcome(): HTMLElement {
        return createTranscriptEmptyWelcomeExtracted(this);
    }

    renderTranscriptMessagesVirtual(host: HTMLElement, conv: QaapAgentConversationDTO, options?: { readonly openingConversation?: boolean; readonly newTurnStarted?: boolean },): void {
        renderTranscriptMessagesVirtualExtracted(this, host, conv, options);
    }

    protected restoreTranscriptOpeningPosition(messageHost: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        return restoreTranscriptOpeningPositionExtracted(this, messageHost, conv);
    }

    protected scrollTranscriptToLastUserTurn(messageHost: HTMLElement, options?: { readonly asPositionTurn?: boolean }): void {
        scrollTranscriptToLastUserTurnExtracted(this, messageHost, options);
    }

    protected prepareTranscriptReadingAnchorWindow(messageHost: HTMLElement, userRow: HTMLElement): void {
        prepareTranscriptReadingAnchorWindowExtracted(this, messageHost, userRow);
    }

    renderTranscriptMessages(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        renderTranscriptMessagesExtracted(this, host, conv);
    }

    protected attachTranscriptScrollChrome(host: HTMLElement, messageHost: HTMLElement, conv: QaapAgentConversationDTO,): void {
        attachTranscriptScrollChromeExtracted(this, host, messageHost, conv);
    }

    tryPatchStreamingTranscriptMessages(host: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        return tryPatchStreamingTranscriptMessagesExtracted(this, host, conv);
    }

    settleVisuallySettledAgentTranscript(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        settleVisuallySettledAgentTranscriptExtracted(this, messageHost, conv);
    }

    tryPatchStreamingTranscriptVirtual(_host: HTMLElement, conv: QaapAgentConversationDTO, patchKind: ReturnType<typeof resolveStreamingTranscriptPatchKind>,): boolean {
        return tryPatchStreamingTranscriptVirtualExtracted(this, _host, conv, patchKind);
    }

    markTranscriptMessageRow(row: HTMLElement, messageId: string, streaming: boolean): void {
        markTranscriptMessageRowExtracted(this, row, messageId, streaming);
    }

    /** Why the last in-place patch attempt failed — read by the replace-site telemetry. */
    protected lastAgentPatchRejectReason: TranscriptAgentPatchRejectReason | undefined;

    tryPatchStreamingAgentTextContent(existingRow: HTMLElement, prevMsg: QaapAgentMessageDTO | undefined, nextMsg: QaapAgentMessageDTO, resolvedSegments: QaapAgentMessageSegmentDTO[] | undefined, conv?: QaapAgentConversationDTO,): boolean {
        return tryPatchStreamingAgentTextContentExtracted(this, existingRow, prevMsg, nextMsg, resolvedSegments, conv);
    }

    removeTranscriptActivityRow(messageHost: HTMLElement): void {
        messageHost.querySelector(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`)?.remove();
    }

    protected clearTranscriptEmptyQuickActions(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        clearTranscriptEmptyQuickActionsExtracted(this, messageHost, conv);
    }

    syncTranscriptActivityRow(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        syncTranscriptActivityRowExtracted(this, messageHost, conv);
    }

    protected ensureLiveStatusBeforeRemovingActivityRow(messageHost: HTMLElement, conv: QaapAgentConversationDTO,): void {
        ensureLiveStatusBeforeRemovingActivityRowExtracted(this, messageHost, conv);
    }

    createTranscriptAgentFailureRow(msg: QaapAgentMessageDTO, conv?: QaapAgentConversationDTO, options?: { readonly deferHeavyContent?: boolean },): HTMLElement {
        return createTranscriptAgentFailureRowExtracted(this, msg, conv, options);
    }

    protected buildTranscriptAgentFailureDialogOptions(input: { readonly failedToolName?: string; readonly canRetry: boolean; readonly agentId?: string; readonly error?: string; readonly technicalContent?: string; }): {
        readonly failedToolName?: string;
        readonly onRetry?: () => void | Promise<void>;
        readonly onOpenAuthUrl?: (url: string) => void;
        readonly onOpenAgentSignIn?: () => void | Promise<void>;
        readonly agentLabel?: string;
    } {
        return buildTranscriptAgentFailureDialogOptionsExtracted(this, input);
    }

    createTranscriptMessageRow(role: 'user' | 'agent', content: string, _error?: string, options?: { readonly deferHeavyContent?: boolean; readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO; readonly message?: QaapAgentMessageDTO; },): HTMLElement {
        return createTranscriptMessageRowExtracted(this, role, content, _error, options);
    }
}
