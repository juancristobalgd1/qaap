// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
    type QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task-client';
import { resolveTranscriptToolRowParts, type QaapTranscriptActivityStats } from '../common/qaap-agent-transcript-segments';
import { resolveTranscriptTurnStartMs } from '../common/qaap-transcript-stream-status';
import { type TranscriptStreamTimeoutCause } from '../common/qaap-transcript-stream-health';
import type { TranscriptActivityNavigationItem, TranscriptActivityNavigationOptions } from '../common/qaap-transcript-activity-navigation';
import { type TranscriptActivityStepState } from '../common/qaap-transcript-activity-step-state';
import { TranscriptActivityTimingStore } from '../common/qaap-transcript-activity-timing';
import { resolveTranscriptTimelineItemTier } from '../common/qaap-transcript-timeline-tier';
import { resolveTranscriptTimelineVisibilityPolicy } from '../common/qaap-transcript-timeline-visibility';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    type TranscriptActivityExpandContent,
    type TranscriptActivityExpandDeps,
} from '../common/qaap-transcript-activity-expand-core';
import { type ToolUmbrella } from '../common/qaap-tool-umbrella';
import { getFileIconClass } from '../common/qaap-file-icon-utils';
import { type TranscriptActivityTimelineItem } from './mobile-projects-transcript-timeline-utils';
import {
    destroyThinkingOrbHosts as destroyThinkingOrbHostsHelper,
    queueExecutionTimelineRefresh as queueExecutionTimelineRefreshHelper,
    skipExecutionTimelineRefresh as skipExecutionTimelineRefreshHelper,
    consumeExecutionTimelineRefresh as consumeExecutionTimelineRefreshHelper,
    consumeSkippedExecutionTimelineRefresh as consumeSkippedExecutionTimelineRefreshHelper,
    isConversationWorking as isConversationWorkingHelper,
    isConversationFinalResponseCommitted as isConversationFinalResponseCommittedHelper,
    isConversationError as isConversationErrorHelper,
    isAgentMessageCancelled as isAgentMessageCancelledHelper,
    shouldShowPinnedTranscriptLiveStatus as shouldShowPinnedTranscriptLiveStatusHelper,
    resolveTranscriptThoughtBriefIconClass as resolveTranscriptThoughtBriefIconClassHelper,
    isLobeWorkflowProcessText as isLobeWorkflowProcessTextHelper,
    resolveConversationElapsedMs as resolveConversationElapsedMsHelper,
    scrollTranscriptStreamingTraceIntoView as scrollTranscriptStreamingTraceIntoViewHelper,
} from './mobile-projects-transcript-messages-artifacts-helpers';
import { appendFreeModelTimeoutHint as appendFreeModelTimeoutHintHelper } from './mobile-projects-transcript-messages-artifacts-helpers';
import { bindMobileExecutionEventTimelineFileOpenExtracted, collectMobileClosingNarrativeTextsBeforeExtracted, createTranscriptAgentSegmentsRowExtracted, didExecutionToolSegmentsChangeExtracted, isClosingNarrativeSegmentSkippedExtracted, removeTranscriptLiveStatusWithOrbExtracted, renderMobileExecutionEventTimelineExtracted, resolveLastAgentMessageExtracted, resolveMobileClosingErrorCardRetryExtracted, resolveMobileClosingNarrativeActionExtracted, resolveRunStopHandlerExtracted, resolveTranscriptRowAgentMessageExtracted, resolveTurnProvenanceExtracted, shouldShowMobileDiffSummaryExtracted } from './mobile-projects-transcript-messages-artifacts-ui-render';
import { appendMobileDiffSummaryExtracted, attachTranscriptActivityItemActionExtracted, bindTranscriptActivityListActionsExtracted, enrichChangedFilesWithComposerGitStatsExtracted, finalizeStreamingAgentTraceExtracted, handleTranscriptActivityNavigationExtracted, refreshMobileClosingNarrativeBlocksExtracted, resolveLobeVisibleTextSegmentIndexesExtracted, resolveTranscriptActivityExecutionContextExtracted, shouldRenderLobeTextSegmentExtracted, syncRowProcessAccordionExtracted, upgradeToMobileExecutionEventTimelineExtracted } from './mobile-projects-transcript-messages-artifacts-ui-streaming';
import { ensureTranscriptStreamStallWatchExtracted, patchStreamingAgentTextSegmentsExtracted, patchStreamingAgentToolSegmentsExtracted, resolvePendingTranscriptToolUseIdsExtracted, resolveTranscriptActivityItemsForDisplayExtracted, resolveTranscriptActivityRowContextExtracted, resolveTranscriptStreamHealthExtracted, resolveTranscriptStreamStallLabelExtracted, resolveTranscriptStreamTimeoutDetailExtracted, resolveTranscriptStreamVisualIdleExtracted, syncTranscriptStreamStallChromeExtracted, syncTranscriptStreamTimeoutBannerExtracted } from './mobile-projects-transcript-messages-artifacts-ui-timeline';
import { createTranscriptStreamTimeoutBannerExtracted, ensureTranscriptLiveStatusForStreamingRowExtracted, patchStreamingActivityTimelineExtracted, resolveTranscriptLiveStatusChatHostExtracted, resolveTranscriptRowSegmentsExtracted, shouldHoldPinnedTranscriptLiveStatusExtracted, syncTranscriptStreamingActivityLineExtracted, syncTranscriptStreamingActivityRowExtracted } from './mobile-projects-transcript-messages-artifacts-ui-activity';
import { ensurePinnedTranscriptLiveStatusExtracted, patchStreamingThoughtBriefExtracted, refreshTranscriptThoughtBriefTitleExtracted, syncTranscriptActivityTimelineElementExtracted, syncTranscriptThoughtBriefElementExtracted } from './mobile-projects-transcript-messages-artifacts-ui-tool-pills';
import { appendStreamingAgentTextSegmentExtracted, appendStreamingAgentToolSegmentExtracted, bindTranscriptActivityTimelineGapHandlersExtracted, bindTranscriptActivityTimelineStickyBarExtracted, bindTranscriptActivityTimelineToggleExtracted, clearPinnedTranscriptStreamFooterExtracted, ensureAndSyncTranscriptLiveStatusFooterExtracted, ensureLobeTranscriptWorkflowClassesExtracted, handleTranscriptActivityTimelineGapClickExtracted, handleTranscriptActivityTimelineGapKeydownExtracted, syncTranscriptActivityHistoryGapExtracted, syncTranscriptActivityTimelineSummaryElementExtracted, syncTranscriptSummaryIconsExtracted, syncTranscriptTraceStatusExtracted } from './mobile-projects-transcript-messages-artifacts-ui-live-status';
import { createTranscriptThoughtBriefBlockExtracted, createTranscriptThoughtBriefIconExtracted, createTranscriptToolPillsStripExtracted, formatTranscriptToolGroupLabelExtracted, patchTranscriptToolPillExtracted, refreshTranscriptToolGroupSummaryExtracted, resolveToolRowPartsExtracted, syncTranscriptThoughtBriefIconExtracted, wrapTranscriptToolGroupExtracted } from './mobile-projects-transcript-messages-artifacts-ui-thought-brief';
import { attachLazyTranscriptToolPillHydrationExtracted, buildTranscriptToolPillBodyExtracted, createTranscriptActivityTimelineExtracted, createTranscriptToolApprovalActionsExtracted, createTranscriptToolPillExtracted, resolveTranscriptActivityTimelineSummaryExtracted, resolveTranscriptTurnDurationMsExtracted, shouldLazyHydrateTranscriptToolPillBodyExtracted } from './mobile-projects-transcript-messages-artifacts-ui-diff';
import { applyTranscriptActivityItemChromeExtracted, applyTranscriptActivityItemClassNameExtracted, applyTranscriptActivityStepShimmerExtracted, guardTranscriptActivityExpandCloseExtracted, restoreTranscriptCheckpointExtracted, syncTranscriptActivityItemElementExtracted, syncTranscriptCheckpointRestoreActionExtracted, syncTranscriptExecutionNarrativeItemElementExtracted } from './mobile-projects-transcript-messages-artifacts-ui-activity-chrome';
import { appendTranscriptActivityEditDiffTailExtracted, enrichTranscriptActivityEditExpandEntryExtracted, enrichTranscriptActivityExpandContentExtracted, enrichTranscriptActivityReadExpandEntryExtracted, ensureTranscriptActivityVerbDetailSpacingExtracted, renderTranscriptActivityExpandBodyExtracted, resolveTranscriptActivityExpandContentExtracted, resolveTranscriptActivityExpandDepsExtracted, shouldShowTranscriptActivityItemExpandExtracted, syncTranscriptActivityDiffPeekExtracted, syncTranscriptActivityExpandCopyExtracted, syncTranscriptActivityStepCopyCursorTraceExtracted, unwrapTranscriptActivityExpandCopyExtracted } from './mobile-projects-transcript-messages-artifacts-ui-activity-expand';
import { createTranscriptActivityFileChipExtracted, createTranscriptActivityIconExtracted, createTranscriptActivityLabelExtracted, createTranscriptPremiumHeadExtracted, populateTranscriptActivityStepCopyExtracted, shouldRenderTranscriptActivityDetailAsPillExtracted, syncTranscriptActivityErrorCopyExtracted, syncTranscriptActivityRunningBadgeExtracted, syncTranscriptActivityThinkingCopyExtracted } from './mobile-projects-transcript-messages-artifacts-ui-activity-content';
import { appendTranscriptChangedFileDiffStatsExtracted, createTranscriptChangedFileMiniDiffPreviewExtracted, createTranscriptChangedFileRowExtracted, createTranscriptChangedFilesReviewButtonExtracted, createTranscriptStreamMetaExtracted, createTranscriptStreamingActivityRowExtracted, createTranscriptTechnicalDetailsCardExtracted, resolveTranscriptStreamDurationLabelExtracted, resolveTranscriptStreamingActivityExtracted } from './mobile-projects-transcript-messages-artifacts-ui-activity-summary';

/** Leading "Error: " marker prepended by {@link traceEventsToSegments} when it
 *  converts an `error` trace event into a plain text segment. Stripped before
 *  comparing closing-narrative text against `msg.error` (which never carries
 *  the prefix) so identical content is recognized as a duplicate regardless
 *  of which side added the marker. */

export interface TranscriptActivityTimelineOptions {
    /** Last N steps in chat; omit or ≤0 to show the full trace. */
    readonly maxVisibleItems?: number;
    readonly variant?: 'inline';
    readonly streaming?: boolean;
    readonly stalled?: boolean;
    readonly timedOut?: boolean;
    /** When set, controls collapsible inline timeline open state. */
    readonly expanded?: boolean;
    readonly segments?: readonly QaapAgentMessageSegmentDTO[];
    readonly row?: HTMLElement;
    readonly conv?: QaapAgentConversationDTO;
    readonly cursorTrace?: boolean;
}

// Re-exported for helper modules that need the type.
export type { TranscriptActivityTimelineOptions as TranscriptActivityTimelineOptionsType };

/**
 * How a closing-narrative text segment should be rendered — shared between
 * the full render path ({@link MobileProjectsTranscriptMessagesArtifactsUi.renderMobileExecutionEventTimeline})
 * and the streaming fast-path ({@link MobileProjectsTranscriptMessagesArtifactsUi.appendStreamingAgentTextSegment})
 * so duplicate/failure-dialog-covered error text is suppressed consistently
 * regardless of which path first observes the segment.
 */
export type MobileClosingNarrativeAction =
    | { readonly kind: 'skip' }
    | { readonly kind: 'error-card'; readonly message: string }
    | { readonly kind: 'text' };

export class MobileProjectsTranscriptMessagesArtifactsUi {
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public readonly activityTiming = new TranscriptActivityTimingStore();

    constructor(
        /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
        public readonly host: MobileProjectsTranscriptMessagesHost,
        /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
        public readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
        public readonly resolversUi: MobileProjectsTranscriptMessagesResolversUi,
        /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
        public readonly toolUi: MobileProjectsTranscriptMessagesToolUi,
        /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
        public readonly onConversationMutation?: (conv: QaapAgentConversationDTO) => void,
    ) { }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public removeTranscriptLiveStatusWithOrb(root: ParentNode): void {
        removeTranscriptLiveStatusWithOrbExtracted(this, root);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public destroyThinkingOrbHosts(root: ParentNode): void {
        destroyThinkingOrbHostsHelper(root);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public queueExecutionTimelineRefresh(row: HTMLElement, segments: readonly QaapAgentMessageSegmentDTO[]): void {
        queueExecutionTimelineRefreshHelper(row, segments);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public skipExecutionTimelineRefresh(row: HTMLElement): void {
        skipExecutionTimelineRefreshHelper(row);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public consumeExecutionTimelineRefresh(row: HTMLElement): readonly QaapAgentMessageSegmentDTO[] | undefined {
        return consumeExecutionTimelineRefreshHelper(row);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public consumeSkippedExecutionTimelineRefresh(row: HTMLElement): boolean {
        return consumeSkippedExecutionTimelineRefreshHelper(row);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public didExecutionToolSegmentsChange(previousSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],): boolean {
        return didExecutionToolSegmentsChangeExtracted(this, previousSegments, nextSegments);
    }

    createTranscriptAgentSegmentsRow(segments: QaapAgentMessageSegmentDTO[],
        error?: string,
        conv?: QaapAgentConversationDTO,
        options?: {
            readonly deferHeavyContent?: boolean;
            readonly streaming?: boolean;
            /** The specific agent message being rendered, if known -- lets
             *  cancellation be derived from THIS message rather than
             *  whichever agent message happens to be last in the
             *  conversation (which mislabels historical accordions once a
             *  later turn has run). */
            readonly message?: QaapAgentMessageDTO;
        },): HTMLElement {
        return createTranscriptAgentSegmentsRowExtracted(this, segments, error, conv, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public renderMobileExecutionEventTimeline(body: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: {
            readonly streaming: boolean;
            readonly defer?: boolean;
            readonly conv?: QaapAgentConversationDTO;
            /** The failure reason recorded on the message being rendered (`msg.error`), if any. */
            readonly error?: string;
            /** The specific agent message being rendered, if known -- see
             *  {@link createTranscriptAgentSegmentsRow}'s `options.message`. Falls
             *  back to the conversation's last agent message when omitted (e.g.
             *  benchmark/test callers that only have a `conv`). */
            readonly message?: QaapAgentMessageDTO;
        },): void {
        renderMobileExecutionEventTimelineExtracted(this, body, segments, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public shouldShowMobileDiffSummary(conv: QaapAgentConversationDTO | undefined,
        renderStreaming: boolean,): boolean {
        return shouldShowMobileDiffSummaryExtracted(this, conv, renderStreaming);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveRunStopHandler(conv: QaapAgentConversationDTO | undefined,
        message: QaapAgentMessageDTO | undefined,
        isWorking: boolean,): (() => void) | undefined {
        return resolveRunStopHandlerExtracted(this, conv, message, isWorking);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public bindMobileExecutionEventTimelineFileOpen(root: HTMLElement): void {
        bindMobileExecutionEventTimelineFileOpenExtracted(this, root);
    }

    /** True when the conversation is still actively streaming/working. */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public isConversationWorking(conv: QaapAgentConversationDTO | undefined, renderStreaming = false): boolean {
        return isConversationWorkingHelper(conv, renderStreaming);
    }

    /**
     * Rendering can switch to non-streaming before the agent lifecycle is complete
     * (visually settled/finalizing). Collapse process chrome only once the backend
     * is actually ready/idle, not merely because this render pass is non-streaming.
     */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public isConversationFinalResponseCommitted(conv: QaapAgentConversationDTO | undefined, renderStreaming: boolean): boolean {
        return isConversationFinalResponseCommittedHelper(conv, renderStreaming);
    }

    /** True when the conversation ended in a failure. */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public isConversationError(conv: QaapAgentConversationDTO | undefined): boolean {
        return isConversationErrorHelper(conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveLastAgentMessage(conv: QaapAgentConversationDTO | undefined): QaapAgentMessageDTO | undefined {
        return resolveLastAgentMessageExtracted(this, conv);
    }

    /** The failure reason recorded on the conversation's last agent message, if any. */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveLastAgentMessageError(conv: QaapAgentConversationDTO | undefined): string | undefined {
        return this.resolveLastAgentMessage(conv)?.error;
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptRowAgentMessage(row: HTMLElement | undefined,
        conv: QaapAgentConversationDTO | undefined,): QaapAgentMessageDTO | undefined {
        return resolveTranscriptRowAgentMessageExtracted(this, row, conv);
    }

    /**
     * True when `message` (a specific agent message, not necessarily the
     * conversation's last one) was manually stopped by the user rather than
     * ending in a genuine failure. There is no dedicated conversation
     * `status` for this — the backend's `cancel()` resets `status` to
     * `'idle'` — so the only reliable signal is the `run_cancelled` AG-UI
     * trace event recorded on the message itself. Mirrors the
     * `messageCancelled` detection in {@link resolveTranscriptActivityRowContext}.
     *
     * Callers must resolve the specific message being rendered (see
     * {@link resolveTranscriptRowAgentMessage}) rather than passing whichever
     * message happens to be last in the conversation -- each agent message
     * renders its own process accordion, and in a multi-turn conversation a
     * historical (already-settled) turn's accordion would otherwise be
     * mislabeled whenever a later turn happened to end up cancelled.
     */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public isAgentMessageCancelled(message: QaapAgentMessageDTO | undefined): boolean {
        return isAgentMessageCancelledHelper(message);
    }

    resolveTurnProvenance(conv: QaapAgentConversationDTO | undefined,
        message: QaapAgentMessageDTO | undefined,): { readonly turnAgentId?: string; readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel } {
        return resolveTurnProvenanceExtracted(this, conv, message);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveMobileClosingNarrativeAction(text: string,
        seenClosingNarrativeTexts: ReadonlySet<string>,
        normalizedFailureReason: string | undefined,
        isError: boolean,): MobileClosingNarrativeAction {
        return resolveMobileClosingNarrativeActionExtracted(this, text, seenClosingNarrativeTexts, normalizedFailureReason, isError);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveMobileClosingErrorCardRetry(): (() => void) | undefined {
        return resolveMobileClosingErrorCardRetryExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public collectMobileClosingNarrativeTextsBefore(segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        beforeIndex: number,): Set<string> {
        return collectMobileClosingNarrativeTextsBeforeExtracted(this, segments, lastToolIndex, beforeIndex);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public isClosingNarrativeSegmentSkipped(segment: QaapAgentMessageSegmentDTO,
        segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        segmentIndex: number,
        conv: QaapAgentConversationDTO | undefined,): boolean {
        return isClosingNarrativeSegmentSkippedExtracted(this, segment, segments, lastToolIndex, segmentIndex, conv);
    }

    /**
     * Resolves the elapsed execution time for the CURRENT TURN, if available.
     * Turn start is the last user message's timestamp
     * ({@link resolveTranscriptTurnStartMs}), not the whole conversation's
     * `createdAt` — a conversation can span many turns, and using its
     * `createdAt` would report the age of the entire conversation instead of
     * how long this turn took. Falls back to `conv.createdAt` when the turn
     * start can't be resolved (e.g. no user message recorded).
     *
     * While the turn is still working, the end bound is "now" so the elapsed
     * time keeps growing live; once settled, it's `conv.updatedAt` (falling
     * back to the last agent message's `createdAt` when `updatedAt` hasn't
     * advanced yet, e.g. mid-stream).
     */
    protected resolveConversationElapsedMs(conv: QaapAgentConversationDTO | undefined): number | undefined {
        return resolveConversationElapsedMsHelper(conv, c => this.isConversationWorking(c));
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncRowProcessAccordion(row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        streaming: boolean,): void {
        syncRowProcessAccordionExtracted(this, row, segments, conv, streaming);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public upgradeToMobileExecutionEventTimeline(row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: { readonly streaming: boolean; readonly conv?: QaapAgentConversationDTO },): void {
        upgradeToMobileExecutionEventTimelineExtracted(this, row, segments, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveLobeVisibleTextSegmentIndexes(segments: readonly QaapAgentMessageSegmentDTO[],
        activityTimelineShown: boolean,): ReadonlySet<number> {
        return resolveLobeVisibleTextSegmentIndexesExtracted(this, segments, activityTimelineShown);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public shouldRenderLobeTextSegment(segments: readonly QaapAgentMessageSegmentDTO[],
        segmentIndex: number,
        activityTimelineShown: boolean,): boolean {
        return shouldRenderLobeTextSegmentExtracted(this, segments, segmentIndex, activityTimelineShown);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public isLobeWorkflowProcessText(content: string): boolean {
        return isLobeWorkflowProcessTextHelper(content, text => this.contentUi.cleanTranscriptDisplayText(text));
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public refreshMobileClosingNarrativeBlocks(segmentsBody: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],): void {
        refreshMobileClosingNarrativeBlocksExtracted(this, segmentsBody, segments);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public enrichChangedFilesWithComposerGitStats(files: ReadonlyArray<{
        readonly path: string;
        readonly kind: 'edited' | 'created';
        readonly added?: number;
        readonly removed?: number;
    }>,): Array<{
        readonly path: string;
        readonly kind: 'edited' | 'created';
        readonly added?: number;
        readonly removed?: number;
    }> {
        return enrichChangedFilesWithComposerGitStatsExtracted(this, files);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public appendMobileDiffSummary(segmentsBody: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],): void {
        appendMobileDiffSummaryExtracted(this, segmentsBody, segments);
    }

    finalizeStreamingAgentTrace(row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO,): void {
        finalizeStreamingAgentTraceExtracted(this, row, segments, conv);
    }

    scrollTranscriptStreamingTraceIntoView(options?: { readonly expandTimeline?: boolean }): void {
        scrollTranscriptStreamingTraceIntoViewHelper(this.host.transcriptChatHost, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public handleTranscriptActivityNavigation(item: TranscriptActivityNavigationItem,
        ownerRow: HTMLElement,): void {
        handleTranscriptActivityNavigationExtracted(this, item, ownerRow);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptActivityExecutionContext(): {
        project: MobileProjectEntry | undefined;
        summary: QaapAgentConversationSummaryDTO | undefined;
    } {
        return resolveTranscriptActivityExecutionContextExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public attachTranscriptActivityItemAction(li: HTMLElement,
        item: TranscriptActivityNavigationItem,
        _ownerRow: HTMLElement,): void {
        attachTranscriptActivityItemActionExtracted(this, li, item, _ownerRow);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public bindTranscriptActivityListActions(list: HTMLElement, ownerRow: HTMLElement): void {
        bindTranscriptActivityListActionsExtracted(this, list, ownerRow);
    }

    patchStreamingAgentTextSegments(row: HTMLElement,
        prevSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        return patchStreamingAgentTextSegmentsExtracted(this, row, prevSegments, nextSegments, conv);
    }

    patchStreamingAgentToolSegments(row: HTMLElement,
        prevSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        return patchStreamingAgentToolSegmentsExtracted(this, row, prevSegments, nextSegments, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptStreamHealth(conv?: QaapAgentConversationDTO) {
        return resolveTranscriptStreamHealthExtracted(this, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptStreamStalled(conv?: QaapAgentConversationDTO): boolean {
        return this.resolveTranscriptStreamHealth(conv).stalled;
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptStreamTimedOut(conv?: QaapAgentConversationDTO): boolean {
        return this.resolveTranscriptStreamHealth(conv).timedOut;
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptStreamVisualIdle(segments: readonly QaapAgentMessageSegmentDTO[],
        streaming: boolean,): boolean {
        return resolveTranscriptStreamVisualIdleExtracted(this, segments, streaming);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptStreamStallLabel(): string {
        return resolveTranscriptStreamStallLabelExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptActivityItemsForDisplay(segments: readonly QaapAgentMessageSegmentDTO[],
        options?: {
            readonly stalled?: boolean;
            readonly timedOut?: boolean;
            readonly includeThinkingSteps?: boolean;
            readonly row?: HTMLElement;
            readonly conv?: QaapAgentConversationDTO;
            readonly streaming?: boolean;
        },): readonly TranscriptActivityTimelineItem[] {
        return resolveTranscriptActivityItemsForDisplayExtracted(this, segments, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptActivityRowContext(row: HTMLElement | undefined,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean; readonly streaming?: boolean },): {
            readonly navigationOptions: TranscriptActivityNavigationOptions;
            readonly message: QaapAgentMessageDTO | undefined;
            readonly resolveDurationMs: (
                segmentIndex: number,
                segment: QaapAgentMessageSegmentDTO,
            ) => number | undefined;
            readonly resolveTimestamp: (
                segmentIndex: number,
                segment: QaapAgentMessageSegmentDTO,
            ) => number | undefined;
        } {
        return resolveTranscriptActivityRowContextExtracted(this, row, segments, conv, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolvePendingTranscriptToolUseIds(conv: QaapAgentConversationDTO | undefined,
        segments: readonly QaapAgentMessageSegmentDTO[],): ReadonlySet<string> | undefined {
        return resolvePendingTranscriptToolUseIdsExtracted(this, conv, segments);
    }

    ensureTranscriptStreamStallWatch(row: HTMLElement): void {
        ensureTranscriptStreamStallWatchExtracted(this, row);
    }

    syncTranscriptStreamStallChrome(row: HTMLElement, conv: QaapAgentConversationDTO): void {
        syncTranscriptStreamStallChromeExtracted(this, row, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptStreamTimeoutBanner(segmentsBody: ParentNode,
        timedOut: boolean,
        cause?: TranscriptStreamTimeoutCause,
        conv?: QaapAgentConversationDTO,): void {
        syncTranscriptStreamTimeoutBannerExtracted(this, segmentsBody, timedOut, cause, conv);
    }

    /**
     * Free-tier models (OpenRouter `:free`, `openrouter/free`, …) are historically the top cause
     * of "didn't respond in time": the PROVIDER stalls, not the IDE. Say so on the timeout card,
     * so users stop debugging the app when the fix is switching models.
     */
    protected appendFreeModelTimeoutHint(detail: string | undefined, conv?: QaapAgentConversationDTO): string | undefined {
        return appendFreeModelTimeoutHintHelper(detail, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptStreamTimeoutDetail(cause?: TranscriptStreamTimeoutCause,): string | undefined {
        return resolveTranscriptStreamTimeoutDetailExtracted(this, cause);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public createTranscriptStreamTimeoutBanner(cause?: TranscriptStreamTimeoutCause,): HTMLElement {
        return createTranscriptStreamTimeoutBannerExtracted(this, cause);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptRowSegments(conv: QaapAgentConversationDTO, row: HTMLElement): QaapAgentMessageSegmentDTO[] {
        return resolveTranscriptRowSegmentsExtracted(this, conv, row);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptStreamingActivityLine(line: Element,
        conv: QaapAgentConversationDTO,
        stalled: boolean,
        timedOut = false,): void {
        syncTranscriptStreamingActivityLineExtracted(this, line, conv, stalled, timedOut);
    }

    syncTranscriptStreamingActivityRow(row: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        return syncTranscriptStreamingActivityRowExtracted(this, row, conv);
    }

    patchStreamingActivityTimeline(row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        return patchStreamingActivityTimelineExtracted(this, row, nextSegments, conv);
    }

    ensureTranscriptLiveStatusForStreamingRow(row: HTMLElement, conv: QaapAgentConversationDTO): void {
        ensureTranscriptLiveStatusForStreamingRowExtracted(this, row, conv);
    }

    /** Suppress clear/remount flicker when status dips for a frame mid-turn. */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public pinnedLiveStatusHoldUntil = 0;
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public pinnedLiveStatusConvId: string | undefined;
    /** High-water mark so the token meter never blinks away mid-turn. */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public pinnedLiveStatusPeakTokens = 0;
    /**
     * Conversation turn the peak-token meter belongs to; a new turn resets the peak. Previously
     * assigned by the extracted tool-pills module without being declared on the class.
     */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public pinnedLiveStatusTurnKey: string | undefined;

    /**
     * True while the live-status row should stay pinned for the whole backend turn.
     * Backend `streaming` / `settled` only — never hide on mid-stream "visually settled".
     */
    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public shouldShowPinnedTranscriptLiveStatus(conv: QaapAgentConversationDTO): boolean {
        return shouldShowPinnedTranscriptLiveStatusHelper(conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public shouldHoldPinnedTranscriptLiveStatus(conv: QaapAgentConversationDTO): boolean {
        return shouldHoldPinnedTranscriptLiveStatusExtracted(this, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptLiveStatusChatHost(hint?: HTMLElement): HTMLElement | undefined {
        return resolveTranscriptLiveStatusChatHostExtracted(this, hint);
    }

    ensurePinnedTranscriptLiveStatus(conv: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean; readonly timedOut?: boolean; readonly chatHost?: HTMLElement },): void {
        ensurePinnedTranscriptLiveStatusExtracted(this, conv, options);
    }

    patchStreamingThoughtBrief(row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        streaming: boolean,): boolean {
        return patchStreamingThoughtBriefExtracted(this, row, segments, conv, streaming);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptThoughtBriefElement(block: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: { readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO },): void {
        syncTranscriptThoughtBriefElementExtracted(this, block, segments, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public refreshTranscriptThoughtBriefTitle(title: HTMLElement,
        block: HTMLElement,
        options: {
            readonly thinking: string | undefined;
            readonly thinkingActive: boolean;
            readonly streaming: boolean;
            readonly turnStartMs: number | undefined;
            readonly segments?: readonly QaapAgentMessageSegmentDTO[];
        },): void {
        refreshTranscriptThoughtBriefTitleExtracted(this, title, block, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityTimelineElement(timeline: HTMLElement,
        items: readonly TranscriptActivityTimelineItem[],
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityTimelineElementExtracted(this, timeline, items, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public ensureLobeTranscriptWorkflowClasses(timeline: HTMLDetailsElement): void {
        ensureLobeTranscriptWorkflowClassesExtracted(this, timeline);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityTimelineSummaryElement(timeline: HTMLDetailsElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        visibleItems: readonly TranscriptActivityTimelineItem[],
        policy: ReturnType<typeof resolveTranscriptTimelineVisibilityPolicy>,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityTimelineSummaryElementExtracted(this, timeline, segments, visibleItems, policy, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptSummaryIcons(timeline: HTMLElement, streaming: boolean): void {
        syncTranscriptSummaryIconsExtracted(this, timeline, streaming);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public bindTranscriptActivityTimelineToggle(timeline: HTMLDetailsElement): void {
        bindTranscriptActivityTimelineToggleExtracted(this, timeline);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public bindTranscriptActivityTimelineStickyBar(timeline: HTMLDetailsElement): void {
        bindTranscriptActivityTimelineStickyBarExtracted(this, timeline);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public bindTranscriptActivityTimelineGapHandlers(timeline: HTMLElement): void {
        bindTranscriptActivityTimelineGapHandlersExtracted(this, timeline);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public handleTranscriptActivityTimelineGapClick(event: Event): void {
        handleTranscriptActivityTimelineGapClickExtracted(this, event);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public handleTranscriptActivityTimelineGapKeydown(event: KeyboardEvent): void {
        handleTranscriptActivityTimelineGapKeydownExtracted(this, event);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public clearPinnedTranscriptStreamFooter(chatHost?: HTMLElement): void {
        clearPinnedTranscriptStreamFooterExtracted(this, chatHost);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public ensureAndSyncTranscriptLiveStatusFooter(segmentsBody: HTMLElement,
        _segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        options?: { readonly streaming?: boolean; readonly stalled?: boolean; readonly timedOut?: boolean },): void {
        ensureAndSyncTranscriptLiveStatusFooterExtracted(this, segmentsBody, _segments, conv, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptTraceStatus(row: HTMLElement | null,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptTraceStatusExtracted(this, row, segments, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityHistoryGap(li: HTMLElement,
        hiddenCount: number,
        position: 'before' | 'after',): void {
        syncTranscriptActivityHistoryGapExtracted(this, li, hiddenCount, position);
    }

    appendStreamingAgentTextSegment(row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        return appendStreamingAgentTextSegmentExtracted(this, row, nextSegments, conv);
    }

    appendStreamingAgentToolSegment(row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        return appendStreamingAgentToolSegmentExtracted(this, row, nextSegments, conv);
    }

    patchTranscriptToolPill(pill: HTMLDetailsElement,
        previous: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv?: QaapAgentConversationDTO,): void {
        patchTranscriptToolPillExtracted(this, pill, previous, segment, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public createTranscriptThoughtBriefIcon(active: boolean): HTMLElement {
        return createTranscriptThoughtBriefIconExtracted(this, active);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptThoughtBriefIconClass(active: boolean): string {
        return resolveTranscriptThoughtBriefIconClassHelper(active);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptThoughtBriefIcon(icon: HTMLElement, active: boolean): void {
        syncTranscriptThoughtBriefIconExtracted(this, icon, active);
    }

    createTranscriptThoughtBriefBlock(segments: QaapAgentMessageSegmentDTO[],
        options?: { readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO },): HTMLElement | undefined {
        return createTranscriptThoughtBriefBlockExtracted(this, segments, options);
    }

    createTranscriptToolPillsStrip(segments: QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },): HTMLElement | undefined {
        return createTranscriptToolPillsStripExtracted(this, segments, conv, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public wrapTranscriptToolGroup(strip: HTMLElement,
        umbrella?: ToolUmbrella,
        items?: ReadonlyArray<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>>,): HTMLDetailsElement {
        return wrapTranscriptToolGroupExtracted(this, strip, umbrella, items);
    }

    refreshTranscriptToolGroupSummary(group: HTMLElement): void {
        refreshTranscriptToolGroupSummaryExtracted(this, group);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public formatTranscriptToolGroupLabel(stats: QaapTranscriptActivityStats): string {
        return formatTranscriptToolGroupLabelExtracted(this, stats);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveToolRowParts(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        kind: string,): ReturnType<typeof resolveTranscriptToolRowParts> {
        return resolveToolRowPartsExtracted(this, segment, kind);
    }

    createTranscriptToolPill(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },): HTMLDetailsElement {
        return createTranscriptToolPillExtracted(this, segment, conv, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public shouldLazyHydrateTranscriptToolPillBody(options: {
        readonly segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
        readonly finished: boolean;
        readonly failed: boolean;
        readonly pendingApproval: boolean;
        readonly todoChecklist: boolean;
        readonly deferHeavyContent: boolean;
        readonly open: boolean;
    }): boolean {
        return shouldLazyHydrateTranscriptToolPillBodyExtracted(this, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public attachLazyTranscriptToolPillHydration(pill: HTMLDetailsElement): void {
        attachLazyTranscriptToolPillHydrationExtracted(this, pill);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public buildTranscriptToolPillBody(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv: QaapAgentConversationDTO | undefined,
        kind: string,
        options: {
            readonly pendingApproval: boolean;
            readonly finished: boolean;
            readonly todoChecklist: boolean;
        },): HTMLElement {
        return buildTranscriptToolPillBodyExtracted(this, segment, conv, kind, options);
    }

    createTranscriptToolApprovalActions(conversationId: string,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): HTMLElement {
        return createTranscriptToolApprovalActionsExtracted(this, conversationId, segment);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptActivityTimelineSummary(segments: readonly QaapAgentMessageSegmentDTO[],
        hiddenCount = 0,
        options?: { readonly streaming?: boolean; readonly row?: HTMLElement },): string {
        return resolveTranscriptActivityTimelineSummaryExtracted(this, segments, hiddenCount, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptTurnDurationMs(segments: readonly QaapAgentMessageSegmentDTO[],
        row: HTMLElement | undefined,): number | undefined {
        return resolveTranscriptTurnDurationMsExtracted(this, segments, row);
    }

    createTranscriptActivityTimeline(segments: QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions & { readonly includeThinkingSteps?: boolean },): HTMLElement | undefined {
        return createTranscriptActivityTimelineExtracted(this, segments, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityItemElement(li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier> = isActive ? 'current' : 'recent',
        subagentCardChild = false,): void {
        syncTranscriptActivityItemElementExtracted(this, li, item, isActive, options, tier, subagentCardChild);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptExecutionNarrativeItemElement(li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier>,): void {
        syncTranscriptExecutionNarrativeItemElementExtracted(this, li, item, tier);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptCheckpointRestoreAction(li: HTMLElement,
        item: TranscriptActivityTimelineItem,): void {
        syncTranscriptCheckpointRestoreActionExtracted(this, li, item);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public guardTranscriptActivityExpandClose(host: HTMLElement | null | undefined): void {
        guardTranscriptActivityExpandCloseExtracted(this, host);
    }

    async restoreTranscriptCheckpoint(checkpointId: string, checkpointLabel?: string): Promise<void> {
        return restoreTranscriptCheckpointExtracted(this, checkpointId, checkpointLabel);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public applyTranscriptActivityItemClassName(li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        tierClass: string,
        chrome: {
            readonly expandableThinking: boolean;
            readonly expandableStep: boolean;
            readonly subagentCardChild?: boolean;
        },): void {
        applyTranscriptActivityItemClassNameExtracted(this, li, item, isActive, tierClass, chrome);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public applyTranscriptActivityItemChrome(li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options: TranscriptActivityTimelineOptions | undefined,
        tierClass: string,
        shimmerActive: boolean,
        subagentCardChild = false,): void {
        applyTranscriptActivityItemChromeExtracted(this, li, item, isActive, options, tierClass, shimmerActive, subagentCardChild);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public applyTranscriptActivityStepShimmer(copy: HTMLElement,
        isActive: boolean,
        shimmerActive: boolean,
        stalled: boolean,): void {
        applyTranscriptActivityStepShimmerExtracted(this, copy, isActive, shimmerActive, stalled);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityStepCopyCursorTrace(rowEl: HTMLElement,
        item: TranscriptActivityTimelineItem,): boolean {
        return syncTranscriptActivityStepCopyCursorTraceExtracted(this, rowEl, item);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityDiffPeek(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityDiffPeekExtracted(this, copy, item, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public ensureTranscriptActivityVerbDetailSpacing(rowEl: HTMLElement): void {
        ensureTranscriptActivityVerbDetailSpacingExtracted(this, rowEl);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public appendTranscriptActivityEditDiffTail(rowEl: HTMLElement,
        added: number,
        removed: number,): void {
        appendTranscriptActivityEditDiffTailExtracted(this, rowEl, added, removed);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptActivityExpandDeps(): TranscriptActivityExpandDeps {
        return resolveTranscriptActivityExpandDepsExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptActivityExpandContent(item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): TranscriptActivityExpandContent | undefined {
        return resolveTranscriptActivityExpandContentExtracted(this, item, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public enrichTranscriptActivityExpandContent(content: TranscriptActivityExpandContent,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): TranscriptActivityExpandContent {
        return enrichTranscriptActivityExpandContentExtracted(this, content, item, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public enrichTranscriptActivityReadExpandEntry(entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry {
        return enrichTranscriptActivityReadExpandEntryExtracted(this, entry, segment);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public enrichTranscriptActivityEditExpandEntry(entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,
        options?: TranscriptActivityTimelineOptions,): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry {
        return enrichTranscriptActivityEditExpandEntryExtracted(this, entry, segment, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public shouldShowTranscriptActivityItemExpand(item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): boolean {
        return shouldShowTranscriptActivityItemExpandExtracted(this, item, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public unwrapTranscriptActivityExpandCopy(copy: HTMLElement): void {
        unwrapTranscriptActivityExpandCopyExtracted(this, copy);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityExpandCopy(copy: HTMLElement, content: TranscriptActivityExpandContent): void {
        syncTranscriptActivityExpandCopyExtracted(this, copy, content);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public renderTranscriptActivityExpandBody(body: HTMLElement, content: TranscriptActivityExpandContent): void {
        renderTranscriptActivityExpandBodyExtracted(this, body, content);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityRunningBadge(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityRunningBadgeExtracted(this, copy, item, isActive, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityErrorCopy(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityErrorCopyExtracted(this, copy, item, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public syncTranscriptActivityThinkingCopy(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityThinkingCopyExtracted(this, copy, item, isActive, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public populateTranscriptActivityStepCopy(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        populateTranscriptActivityStepCopyExtracted(this, copy, item, isActive, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public shouldRenderTranscriptActivityDetailAsPill(detail: string | undefined,
        toolKind?: string,): boolean {
        return shouldRenderTranscriptActivityDetailAsPillExtracted(this, detail, toolKind);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public createTranscriptActivityFileChip(detail: string, toolKind?: string, fullPath?: string): HTMLElement {
        return createTranscriptActivityFileChipExtracted(this, detail, toolKind, fullPath);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public readonly activityToolKindIconMap: Record<string, string> = {
        reading: 'codicon-book',
        editing: 'codicon-pencil',
        terminal: 'codicon-terminal',
        searching: 'codicon-search',
        todo: 'codicon-tasklist',
        mcp: 'codicon-puzzle',
        writing: 'codicon-comment',
        thinking: 'codicon-thinking',
        planning: 'codicon-lightbulb',
        file: 'codicon-file-code',
        webfetch: 'codicon-globe',
        task: 'codicon-list-tree',
        delegate: 'codicon-person-add',
    };

    createTranscriptActivityIcon(state: TranscriptActivityStepState,
        active: boolean,
        toolKind?: string,
        streaming?: boolean,
        options?: { readonly subagentRoot?: boolean },): HTMLElement {
        return createTranscriptActivityIconExtracted(this, state, active, toolKind, streaming, options);
    }

    createTranscriptActivityLabel(text: string, active = false): HTMLElement {
        return createTranscriptActivityLabelExtracted(this, text, active);
    }

    createTranscriptPremiumHead(iconClass: string,
        label: string,
        options?: { readonly count?: number; readonly variant?: 'default' | 'todos' },): HTMLElement {
        return createTranscriptPremiumHeadExtracted(this, iconClass, label, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public createTranscriptChangedFileMiniDiffPreview(segments: readonly QaapAgentMessageSegmentDTO[],
        file: { readonly path: string },): HTMLElement | undefined {
        return createTranscriptChangedFileMiniDiffPreviewExtracted(this, segments, file);
    }

    createTranscriptChangedFilesReviewButton(): HTMLButtonElement {
        return createTranscriptChangedFilesReviewButtonExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public appendTranscriptChangedFileDiffStats(parent: HTMLElement,
        added: number,
        removed: number,): void {
        appendTranscriptChangedFileDiffStatsExtracted(this, parent, added, removed);
    }

    createTranscriptChangedFileRow(file: { readonly path: string; readonly kind: 'edited' | 'created'; readonly added?: number; readonly removed?: number },
        options?: { readonly compact?: boolean },): HTMLElement {
        return createTranscriptChangedFileRowExtracted(this, file, options);
    }

    /** Codicon for a changed-file row, derived from the file extension. */

    transcriptFileIconClass(path: string): string {
        return getFileIconClass(path);
    }

    createTranscriptTechnicalDetailsCard(segments: QaapAgentMessageSegmentDTO[],
        options?: { readonly activityTimelineShown?: boolean },): HTMLElement | undefined {
        return createTranscriptTechnicalDetailsCardExtracted(this, segments, options);
    }

    createTranscriptStreamingActivityRow(conv: QaapAgentConversationDTO): HTMLElement | undefined {
        return createTranscriptStreamingActivityRowExtracted(this, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public createTranscriptStreamMeta(conv: QaapAgentConversationDTO, ownerRow?: HTMLElement): HTMLElement | undefined {
        return createTranscriptStreamMetaExtracted(this, conv, ownerRow);
    }

    /** @internal Used by the extracted mobile-projects-transcript-messages-artifacts-ui-* modules. */
    public resolveTranscriptStreamDurationLabel(conv: QaapAgentConversationDTO): string {
        return resolveTranscriptStreamDurationLabelExtracted(this, conv);
    }

    resolveTranscriptStreamingActivity(conv: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean; readonly timedOut?: boolean },): { kind: string; title: string; detail: string } {
        return resolveTranscriptStreamingActivityExtracted(this, conv, options);
    }
}
