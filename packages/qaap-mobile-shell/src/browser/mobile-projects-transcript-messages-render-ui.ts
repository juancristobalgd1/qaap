// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { resolveStreamingTranscriptPatchKind, TRANSCRIPT_ACTIVITY_ROW_ATTR, type QaapTranscriptStreamingPatchNoneReason } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-incremental-update';
import { type QaapTranscriptRenderMetricKind } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-render-metrics';

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

export const AGENT_REPLACE_REASON_METRIC: Record<TranscriptAgentPatchRejectReason, QaapTranscriptRenderMetricKind> = {
    no_prev: 'render_patch_last_agent_replace_no_prev',
    predicates: 'render_patch_last_agent_replace_predicates',
    applier: 'render_patch_last_agent_replace_applier',
    thinking: 'render_patch_last_agent_replace_thinking',
};
import {
    ensureTranscriptScrollController,
    type TranscriptScrollController,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-scroll-controller';
import { type QaapAgentConversationDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO, type QaapPendingUserMessageDTO, cancelQueuedConversationMessage, dispatchQueuedConversationMessage, conversationToSummary } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesUserUi } from './mobile-projects-transcript-messages-user-ui';
import type { WorkHubTranscriptBridge } from '@theia/qaap-transcript-overlay/lib/browser/work-hub-transcript-bridge';
import { buildTranscriptAgentFailureDialogOptionsExtracted, clearTranscriptEmptyQuickActionsExtracted, createTranscriptAgentFailureRowExtracted, createTranscriptMessageRowExtracted, ensureLiveStatusBeforeRemovingActivityRowExtracted, syncTranscriptActivityRowExtracted, tryPatchStreamingAgentTextContentExtracted } from './mobile-projects-transcript-messages-render-ui-activity';
import { applyTranscriptScrollAfterMutationExtracted, buildTranscriptVirtualFooterExtracted, createTranscriptContextCompactionRowExtracted, createTranscriptMessageRowAtIndexExtracted, findAppendedUserMessageIndexExtracted, findLastUserMessageIndexExtracted, normalizeConversationFailuresCachedExtracted, positionTranscriptVirtualListAtUserTurnExtracted, resolveTranscriptAgentSegmentsExtracted, resolveTranscriptMessageHostExtracted, restoreTranscriptOpeningPositionVirtualExtracted, restoreTranscriptScrollAnchorExtracted, scheduleTranscriptScrollAfterMutationExtracted, scrollTranscriptTurnStartIntoReadingPositionExtracted, scrollTranscriptVirtualListToIndexExtracted, setTranscriptAgentSegmentsCacheEntryExtracted, shouldFollowTranscriptTailExtracted, syncTranscriptAgentSegmentsCacheExtracted, transcriptAgentSegmentsCacheKeyExtracted, transcriptContextCompactionBoundaryIndexExtracted, transcriptRowRenderKeyExtracted, transcriptSegmentsSignatureExtracted, transcriptTextSignatureExtracted, withDerivedTranscriptSegmentsExtracted } from './mobile-projects-transcript-messages-render-ui-render';
import { createTranscriptEmptyWelcomeExtracted, prepareTranscriptReadingAnchorWindowExtracted, renderTranscriptMessagesExtracted, renderTranscriptMessagesVirtualExtracted, restoreTranscriptOpeningPositionExtracted, scrollTranscriptToLastUserTurnExtracted } from './mobile-projects-transcript-messages-render-ui-streaming';
import { attachTranscriptScrollChromeExtracted, markTranscriptMessageRowExtracted, settleVisuallySettledAgentTranscriptExtracted, tryPatchStreamingTranscriptMessagesExtracted, tryPatchStreamingTranscriptVirtualExtracted } from './mobile-projects-transcript-messages-render-ui-timeline';

/** Options accepted by {@link MobileProjectsTranscriptMessagesToolUi.createTranscriptAgentFailureDialog}. */
export type TranscriptAgentFailureDialogOptions = NonNullable<Parameters<MobileProjectsTranscriptMessagesToolUi['createTranscriptAgentFailureDialog']>[2]>;

export class MobileProjectsTranscriptMessagesRenderUi {
    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public readonly transcriptAgentSegmentsCache = new Map<string, readonly QaapAgentMessageSegmentDTO[]>();
    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public transcriptAgentSegmentsCacheConversationId: string | undefined;
    /**
     * Tracks the most recent cache key inserted per message (`${conv.id}|${msg.id}`).
     * The cache key embeds a content signature that changes every streamed token, so
     * without this, a streaming tail message would insert a brand-new entry on every
     * tick — unbounded growth until the 1000-entry cap wipes the whole cache. Deleting
     * the message's previous entry before inserting the new one caps live growth at one
     * entry per message while still caching finished messages across re-renders.
     */
    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public readonly transcriptAgentSegmentsCacheKeyByMessage = new Map<string, string>();
    /**
     * Tracks which conversation the full scroll chrome (scroll-to-bottom button, scroll pin,
     * intent observer, inline search, read position, activity timeline, row defer observer) is
     * currently bound to. Re-creating this chrome on every render tick — especially the
     * scroll-to-bottom button, which starts hidden and needs a rAF + 100ms debounce to show
     * again — causes visible flicker during streaming. Only rebuild on conversation switch.
     */
    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public transcriptScrollChromeBoundConversationId: string | undefined;

    constructor(
        /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
        public readonly host: MobileProjectsTranscriptMessagesHost,
        /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
        public readonly workHub: WorkHubTranscriptBridge,
        /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
        public readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
        public readonly userUi: MobileProjectsTranscriptMessagesUserUi,
        /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
        public readonly artifactsUi: MobileProjectsTranscriptMessagesArtifactsUi,
        /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
        public readonly toolUi: MobileProjectsTranscriptMessagesToolUi,
    ) { }

    resolveTranscriptMessageHost(host: HTMLElement): HTMLElement {
        return resolveTranscriptMessageHostExtracted(this, host);
    }

    resolveTranscriptAgentSegments(conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO,): QaapAgentMessageSegmentDTO[] | undefined {
        return resolveTranscriptAgentSegmentsExtracted(this, conv, msg);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public syncTranscriptAgentSegmentsCache(conversationId: string): void {
        syncTranscriptAgentSegmentsCacheExtracted(this, conversationId);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public setTranscriptAgentSegmentsCacheEntry(conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO, cacheKey: string, segments: readonly QaapAgentMessageSegmentDTO[],): void {
        setTranscriptAgentSegmentsCacheEntryExtracted(this, conv, msg, cacheKey, segments);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public transcriptAgentSegmentsCacheKey(conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO): string {
        return transcriptAgentSegmentsCacheKeyExtracted(this, conv, msg);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public transcriptTextSignature(text: string | undefined): string {
        return transcriptTextSignatureExtracted(this, text);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public transcriptSegmentsSignature(segments: readonly QaapAgentMessageSegmentDTO[] | undefined): string {
        return transcriptSegmentsSignatureExtracted(this, segments);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public withDerivedTranscriptSegments(msg: QaapAgentMessageDTO): QaapAgentMessageDTO {
        return withDerivedTranscriptSegmentsExtracted(this, msg);
    }

    /**
     * Failure normalization is O(messages); memoized per snapshot so the full
     * rebuild loop (which calls {@link createTranscriptMessageRowAtIndex} once
     * per row) stays O(N) instead of O(N²). Snapshots are immutable per tick,
     * so keying by object identity is safe.
     */
    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public readonly normalizedFailuresCache = new WeakMap<QaapAgentConversationDTO, QaapAgentConversationDTO>();

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public normalizeConversationFailuresCached(conv: QaapAgentConversationDTO): QaapAgentConversationDTO {
        return normalizeConversationFailuresCachedExtracted(this, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public transcriptRowRenderKey(conv: QaapAgentConversationDTO, index: number): string | undefined {
        return transcriptRowRenderKeyExtracted(this, conv, index);
    }

    createTranscriptMessageRowAtIndex(conv: QaapAgentConversationDTO, index: number): HTMLElement {
        return createTranscriptMessageRowAtIndexExtracted(this, conv, index);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public transcriptContextCompactionBoundaryIndex(conv: QaapAgentConversationDTO): number | undefined {
        return transcriptContextCompactionBoundaryIndexExtracted(this, conv);
    }

    buildTranscriptVirtualFooter(conv: QaapAgentConversationDTO, options?: { readonly existingActivityRow?: HTMLElement | null },): HTMLElement[] {
        return buildTranscriptVirtualFooterExtracted(this, conv, options);
    }

    /** Cancel a queued message — removes it from the server-side pending queue. */
    async cancelQueuedMessage(conversationId: string, queuedMessageId: string): Promise<void> {
        try {
            const updated = await cancelQueuedConversationMessage(conversationId, queuedMessageId);
            this.host.conversations?.recordSnapshot(conversationToSummary(updated));
            this.host.transcriptLastConv = updated;
            const chatHost = this.host.transcriptChatHost;
            if (chatHost) {
                this.renderTranscriptMessages(chatHost, updated);
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.host.messageService?.error(
                nls.localize('qaap/mobileProjects/cancelQueuedFailed', 'Could not cancel queued message: {0}', detail),
            );
        }
    }

    /** Dispatch a queued message immediately with the given delivery mode. */
    async dispatchQueuedMessage(
        conversationId: string,
        pending: QaapPendingUserMessageDTO,
        deliveryMode: 'queue' | 'parallel' | 'interrupt',
    ): Promise<void> {
        try {
            const updated = await dispatchQueuedConversationMessage(conversationId, pending.id, deliveryMode);
            this.host.conversations?.recordSnapshot(conversationToSummary(updated));
            this.host.transcriptLastConv = updated;
            const chatHost = this.host.transcriptChatHost;
            if (chatHost) {
                this.renderTranscriptMessages(chatHost, updated);
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.host.messageService?.error(
                nls.localize('qaap/mobileProjects/dispatchQueuedFailed', 'Could not send queued message: {0}', detail),
            );
        }
    }

    /** Activity row currently mounted in the transcript host or virtual footer. */
    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public findTranscriptStreamingActivityRow(messageHost: HTMLElement): HTMLElement | undefined {
        const rows = [...messageHost.querySelectorAll<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`)];
        const first = rows.shift();
        for (const duplicate of rows) {
            duplicate.remove();
        }
        return first;
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public createTranscriptContextCompactionRow(conv: QaapAgentConversationDTO): HTMLElement | undefined {
        return createTranscriptContextCompactionRowExtracted(this, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public resolveTranscriptScrollController(scroller: HTMLElement): TranscriptScrollController {
        return ensureTranscriptScrollController(scroller);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public shouldFollowTranscriptTail(scroller: HTMLElement): boolean {
        return shouldFollowTranscriptTailExtracted(this, scroller);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public captureTranscriptScrollAnchor(scroller: HTMLElement): ReturnType<TranscriptScrollController['captureAnchor']> {
        return this.resolveTranscriptScrollController(scroller).captureAnchor(scroller);
    }

    protected restoreTranscriptScrollAnchor(scroller: HTMLElement, anchor: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        restoreTranscriptScrollAnchorExtracted(this, scroller, anchor);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public applyTranscriptScrollAfterMutation(messageHost: HTMLElement, anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        applyTranscriptScrollAfterMutationExtracted(this, messageHost, anchor);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public scheduleTranscriptScrollAfterMutation(messageHost: HTMLElement, anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        scheduleTranscriptScrollAfterMutationExtracted(this, messageHost, anchor);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public scrollTranscriptTurnStartIntoReadingPosition(messageHost: HTMLElement, row: HTMLElement): void {
        scrollTranscriptTurnStartIntoReadingPositionExtracted(this, messageHost, row);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public scrollTranscriptFollowTail(scroller: HTMLElement): void {
        this.resolveTranscriptScrollController(scroller).onContentChanged(scroller);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public findLastUserMessageRow(messageHost: HTMLElement): HTMLElement | undefined {
        return [...messageHost.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-user')].at(-1);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public findLastUserMessageIndex(conv: QaapAgentConversationDTO): number {
        return findLastUserMessageIndexExtracted(this, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public findAppendedUserMessageIndex(previous: QaapAgentConversationDTO | undefined, next: QaapAgentConversationDTO,): number {
        return findAppendedUserMessageIndexExtracted(this, previous, next);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public positionTranscriptVirtualListAtUserTurn(messageHost: HTMLElement, list: { scrollToIndex?: (index: number, contextPx?: number) => void }, userIndex: number,): void {
        positionTranscriptVirtualListAtUserTurnExtracted(this, messageHost, list, userIndex);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public hasExplicitTranscriptMessageHash(): boolean {
        return typeof window !== 'undefined' && window.location.hash.startsWith('#qaap-transcript-message-');
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public scrollTranscriptVirtualListToIndex(list: { scrollToIndex?: (index: number, contextPx?: number) => void }, index: number, contextPx: number,): void {
        scrollTranscriptVirtualListToIndexExtracted(this, list, index, contextPx);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public restoreTranscriptOpeningPositionVirtual(list: { scrollToIndex?: (index: number, contextPx?: number) => void }, conv: QaapAgentConversationDTO, contextPx: number,): boolean {
        return restoreTranscriptOpeningPositionVirtualExtracted(this, list, conv, contextPx);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public createTranscriptEmptyWelcome(): HTMLElement {
        return createTranscriptEmptyWelcomeExtracted(this);
    }

    renderTranscriptMessagesVirtual(host: HTMLElement, conv: QaapAgentConversationDTO, options?: { readonly openingConversation?: boolean; readonly newTurnStarted?: boolean },): void {
        renderTranscriptMessagesVirtualExtracted(this, host, conv, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public restoreTranscriptOpeningPosition(messageHost: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        return restoreTranscriptOpeningPositionExtracted(this, messageHost, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public scrollTranscriptToLastUserTurn(messageHost: HTMLElement, options?: { readonly asPositionTurn?: boolean }): void {
        scrollTranscriptToLastUserTurnExtracted(this, messageHost, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public prepareTranscriptReadingAnchorWindow(messageHost: HTMLElement, userRow: HTMLElement): void {
        prepareTranscriptReadingAnchorWindowExtracted(this, messageHost, userRow);
    }

    renderTranscriptMessages(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        renderTranscriptMessagesExtracted(this, host, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public attachTranscriptScrollChrome(host: HTMLElement, messageHost: HTMLElement, conv: QaapAgentConversationDTO,): void {
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
    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public lastAgentPatchRejectReason: TranscriptAgentPatchRejectReason | undefined;

    tryPatchStreamingAgentTextContent(existingRow: HTMLElement, prevMsg: QaapAgentMessageDTO | undefined, nextMsg: QaapAgentMessageDTO, resolvedSegments: QaapAgentMessageSegmentDTO[] | undefined, conv?: QaapAgentConversationDTO,): boolean {
        return tryPatchStreamingAgentTextContentExtracted(this, existingRow, prevMsg, nextMsg, resolvedSegments, conv);
    }

    removeTranscriptActivityRow(messageHost: HTMLElement): void {
        messageHost.querySelectorAll(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`).forEach(row => row.remove());
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public clearTranscriptEmptyQuickActions(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        clearTranscriptEmptyQuickActionsExtracted(this, messageHost, conv);
    }

    syncTranscriptActivityRow(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        syncTranscriptActivityRowExtracted(this, messageHost, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public ensureLiveStatusBeforeRemovingActivityRow(messageHost: HTMLElement, conv: QaapAgentConversationDTO,): void {
        ensureLiveStatusBeforeRemovingActivityRowExtracted(this, messageHost, conv);
    }

    createTranscriptAgentFailureRow(msg: QaapAgentMessageDTO, conv?: QaapAgentConversationDTO, options?: { readonly deferHeavyContent?: boolean },): HTMLElement {
        return createTranscriptAgentFailureRowExtracted(this, msg, conv, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-render-ui-* modules. */
    public buildTranscriptAgentFailureDialogOptions(input: {
        readonly failedToolName?: string;
        readonly canRetry: boolean;
        readonly agentId?: string;
        readonly error?: string;
        readonly technicalContent?: string;
        readonly agentMessage?: TranscriptAgentFailureDialogOptions['agentMessage'];
    }): TranscriptAgentFailureDialogOptions {
        return buildTranscriptAgentFailureDialogOptionsExtracted(this, input);
    }

    createTranscriptMessageRow(role: 'user' | 'agent', content: string, _error?: string, options?: { readonly deferHeavyContent?: boolean; readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO; readonly message?: QaapAgentMessageDTO; },): HTMLElement {
        return createTranscriptMessageRowExtracted(this, role, content, _error, options);
    }
}
