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
import {
    extractTranscriptDiffCard,
    resolveTranscriptToolRowParts,
    type QaapTranscriptActivityStats,
} from '../common/qaap-agent-transcript-segments';
import { resolveTranscriptTurnStartMs } from '../common/qaap-transcript-stream-status';
import { type TranscriptStreamTimeoutCause } from '../common/qaap-transcript-stream-health';
import type { TranscriptActivityNavigationItem, TranscriptActivityNavigationOptions } from '../common/qaap-transcript-activity-navigation';
import { type TranscriptActivityStepState } from '../common/qaap-transcript-activity-step-state';
import { TranscriptActivityTimingStore } from '../common/qaap-transcript-activity-timing';
import { resolveTranscriptTimelineItemTier } from '../common/qaap-transcript-timeline-tier';
import { resolveTranscriptTimelineVisibilityPolicy } from '../common/qaap-transcript-timeline-visibility';
import { buildTranscriptDiffCardFromExtracted } from './qaap-transcript-rich-content-ui';
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
import { appendFreeModelTimeoutHint as appendFreeModelTimeoutHintHelper } from './mobile-projects-transcript-messages-artifacts-helpers2';
import { bindMobileExecutionEventTimelineFileOpenExtracted, collectMobileClosingNarrativeTextsBeforeExtracted, createTranscriptAgentSegmentsRowExtracted, didExecutionToolSegmentsChangeExtracted, isClosingNarrativeSegmentSkippedExtracted, removeTranscriptLiveStatusWithOrbExtracted, renderMobileExecutionEventTimelineExtracted, resolveLastAgentMessageExtracted, resolveMobileClosingErrorCardRetryExtracted, resolveMobileClosingNarrativeActionExtracted, resolveRunStopHandlerExtracted, resolveTranscriptRowAgentMessageExtracted, resolveTurnProvenanceExtracted, shouldShowMobileDiffSummaryExtracted } from './mobile-projects-transcript-messages-artifacts-ui-render2';
import { appendMobileDiffSummaryExtracted, attachTranscriptActivityItemActionExtracted, bindTranscriptActivityListActionsExtracted, enrichChangedFilesWithComposerGitStatsExtracted, finalizeStreamingAgentTraceExtracted, handleTranscriptActivityNavigationExtracted, refreshMobileClosingNarrativeBlocksExtracted, resolveLobeVisibleTextSegmentIndexesExtracted, resolveTranscriptActivityExecutionContextExtracted, shouldRenderLobeTextSegmentExtracted, syncRowProcessAccordionExtracted, upgradeToMobileExecutionEventTimelineExtracted } from './mobile-projects-transcript-messages-artifacts-ui-streaming2';
import { ensureTranscriptStreamStallWatchExtracted, patchStreamingAgentTextSegmentsExtracted, patchStreamingAgentToolSegmentsExtracted, resolvePendingTranscriptToolUseIdsExtracted, resolveTranscriptActivityItemsForDisplayExtracted, resolveTranscriptActivityRowContextExtracted, resolveTranscriptStreamHealthExtracted, resolveTranscriptStreamStallLabelExtracted, resolveTranscriptStreamTimeoutDetailExtracted, resolveTranscriptStreamVisualIdleExtracted, syncTranscriptStreamStallChromeExtracted, syncTranscriptStreamTimeoutBannerExtracted } from './mobile-projects-transcript-messages-artifacts-ui-timeline2';
import { createTranscriptStreamTimeoutBannerExtracted, ensureTranscriptLiveStatusForStreamingRowExtracted, patchStreamingActivityTimelineExtracted, resolveTranscriptLiveStatusChatHostExtracted, resolveTranscriptRowSegmentsExtracted, shouldHoldPinnedTranscriptLiveStatusExtracted, syncTranscriptStreamingActivityLineExtracted, syncTranscriptStreamingActivityRowExtracted } from './mobile-projects-transcript-messages-artifacts-ui-activity2';
import { ensurePinnedTranscriptLiveStatusExtracted, patchStreamingThoughtBriefExtracted, refreshTranscriptThoughtBriefTitleExtracted, syncTranscriptActivityTimelineElementExtracted, syncTranscriptThoughtBriefElementExtracted } from './mobile-projects-transcript-messages-artifacts-ui-tool-pills2';
import { appendStreamingAgentTextSegmentExtracted, appendStreamingAgentToolSegmentExtracted, bindTranscriptActivityTimelineGapHandlersExtracted, bindTranscriptActivityTimelineStickyBarExtracted, bindTranscriptActivityTimelineToggleExtracted, clearPinnedTranscriptStreamFooterExtracted, ensureAndSyncTranscriptLiveStatusFooterExtracted, ensureLobeTranscriptWorkflowClassesExtracted, handleTranscriptActivityTimelineGapClickExtracted, handleTranscriptActivityTimelineGapKeydownExtracted, syncTranscriptActivityHistoryGapExtracted, syncTranscriptActivityTimelineSummaryElementExtracted, syncTranscriptSummaryIconsExtracted, syncTranscriptTraceStatusExtracted } from './mobile-projects-transcript-messages-artifacts-ui-live-status2';
import { createTranscriptThoughtBriefBlockExtracted, createTranscriptThoughtBriefIconExtracted, createTranscriptToolPillsStripExtracted, formatTranscriptToolGroupLabelExtracted, patchTranscriptToolPillExtracted, refreshTranscriptToolGroupSummaryExtracted, resolveToolRowPartsExtracted, syncTranscriptThoughtBriefIconExtracted, wrapTranscriptToolGroupExtracted } from './mobile-projects-transcript-messages-artifacts-ui-thought-brief2';
import { attachLazyTranscriptToolPillHydrationExtracted, buildTranscriptToolPillBodyExtracted, createTranscriptActivityTimelineExtracted, createTranscriptToolApprovalActionsExtracted, createTranscriptToolPillExtracted, formatTranscriptActivityMetaExtracted, resolveTranscriptActivityTimelineSummaryExtracted, resolveTranscriptTurnDurationMsExtracted, shouldLazyHydrateTranscriptToolPillBodyExtracted } from './mobile-projects-transcript-messages-artifacts-ui-diff2';
import { applyTranscriptActivityItemChromeExtracted, applyTranscriptActivityItemClassNameExtracted, applyTranscriptActivityStepShimmerExtracted, guardTranscriptActivityExpandCloseExtracted, restoreTranscriptCheckpointExtracted, syncTranscriptActivityItemElementExtracted, syncTranscriptCheckpointRestoreActionExtracted, syncTranscriptExecutionNarrativeItemElementExtracted } from './mobile-projects-transcript-messages-artifacts-ui-misc';
import { appendTranscriptActivityEditDiffTailExtracted, enrichTranscriptActivityEditExpandEntryExtracted, enrichTranscriptActivityExpandContentExtracted, enrichTranscriptActivityReadExpandEntryExtracted, ensureTranscriptActivityVerbDetailSpacingExtracted, renderTranscriptActivityExpandBodyExtracted, resolveTranscriptActivityExpandContentExtracted, resolveTranscriptActivityExpandDepsExtracted, shouldShowTranscriptActivityItemExpandExtracted, syncTranscriptActivityDiffPeekExtracted, syncTranscriptActivityExpandCopyExtracted, syncTranscriptActivityStepCopyCursorTraceExtracted, unwrapTranscriptActivityExpandCopyExtracted } from './mobile-projects-transcript-messages-artifacts-ui-misc2';
import { createTranscriptActivityFileChipExtracted, createTranscriptActivityIconExtracted, createTranscriptActivityLabelExtracted, createTranscriptChangedFilesCardExtracted, createTranscriptDiffSummaryCardExtracted, createTranscriptPremiumHeadExtracted, populateTranscriptActivityStepCopyExtracted, shouldRenderTranscriptActivityDetailAsPillExtracted, syncTranscriptActivityErrorCopyExtracted, syncTranscriptActivityRunningBadgeExtracted, syncTranscriptActivityThinkingCopyExtracted } from './mobile-projects-transcript-messages-artifacts-ui-misc3';
import { appendTranscriptChangedFileDiffStatsExtracted, createTranscriptChangedFileMiniDiffPreviewExtracted, createTranscriptChangedFileRowExtracted, createTranscriptChangedFilesReviewButtonExtracted, createTranscriptStreamMetaExtracted, createTranscriptStreamingActivityRowExtracted, createTranscriptTechnicalDetailsCardExtracted, createTranscriptVerificationCardExtracted, resolveTranscriptStreamDurationLabelExtracted, resolveTranscriptStreamingActivityExtracted } from './mobile-projects-transcript-messages-artifacts-ui-misc11';

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
type MobileClosingNarrativeAction =
    | { readonly kind: 'skip' }
    | { readonly kind: 'error-card'; readonly message: string }
    | { readonly kind: 'text' };

export class MobileProjectsTranscriptMessagesArtifactsUi {
    protected readonly activityTiming = new TranscriptActivityTimingStore();

    constructor(
        protected readonly host: MobileProjectsTranscriptMessagesHost,
        protected readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        protected readonly resolversUi: MobileProjectsTranscriptMessagesResolversUi,
        protected readonly toolUi: MobileProjectsTranscriptMessagesToolUi,
        protected readonly onConversationMutation?: (conv: QaapAgentConversationDTO) => void,
    ) { }

    protected removeTranscriptLiveStatusWithOrb(root: ParentNode): void {
        removeTranscriptLiveStatusWithOrbExtracted(this, root);
    }

    protected destroyThinkingOrbHosts(root: ParentNode): void {
        destroyThinkingOrbHostsHelper(root);
    }

    protected queueExecutionTimelineRefresh(row: HTMLElement, segments: readonly QaapAgentMessageSegmentDTO[]): void {
        queueExecutionTimelineRefreshHelper(row, segments);
    }

    protected skipExecutionTimelineRefresh(row: HTMLElement): void {
        skipExecutionTimelineRefreshHelper(row);
    }

    protected consumeExecutionTimelineRefresh(row: HTMLElement): readonly QaapAgentMessageSegmentDTO[] | undefined {
        return consumeExecutionTimelineRefreshHelper(row);
    }

    protected consumeSkippedExecutionTimelineRefresh(row: HTMLElement): boolean {
        return consumeSkippedExecutionTimelineRefreshHelper(row);
    }

    protected didExecutionToolSegmentsChange(previousSegments: readonly QaapAgentMessageSegmentDTO[],
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

    protected renderMobileExecutionEventTimeline(body: HTMLElement,
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

    protected shouldShowMobileDiffSummary(conv: QaapAgentConversationDTO | undefined,
        renderStreaming: boolean,): boolean {
        return shouldShowMobileDiffSummaryExtracted(this, conv, renderStreaming);
    }

    protected resolveRunStopHandler(conv: QaapAgentConversationDTO | undefined,
        message: QaapAgentMessageDTO | undefined,
        isWorking: boolean,): (() => void) | undefined {
        return resolveRunStopHandlerExtracted(this, conv, message, isWorking);
    }

    protected bindMobileExecutionEventTimelineFileOpen(root: HTMLElement): void {
        bindMobileExecutionEventTimelineFileOpenExtracted(this, root);
    }

    /** True when the conversation is still actively streaming/working. */
    protected isConversationWorking(conv: QaapAgentConversationDTO | undefined, renderStreaming = false): boolean {
        return isConversationWorkingHelper(conv, renderStreaming);
    }

    /**
     * Rendering can switch to non-streaming before the agent lifecycle is complete
     * (visually settled/finalizing). Collapse process chrome only once the backend
     * is actually ready/idle, not merely because this render pass is non-streaming.
     */
    protected isConversationFinalResponseCommitted(conv: QaapAgentConversationDTO | undefined, renderStreaming: boolean): boolean {
        return isConversationFinalResponseCommittedHelper(conv, renderStreaming);
    }

    /** True when the conversation ended in a failure. */
    protected isConversationError(conv: QaapAgentConversationDTO | undefined): boolean {
        return isConversationErrorHelper(conv);
    }

    protected resolveLastAgentMessage(conv: QaapAgentConversationDTO | undefined): QaapAgentMessageDTO | undefined {
        return resolveLastAgentMessageExtracted(this, conv);
    }

    /** The failure reason recorded on the conversation's last agent message, if any. */
    protected resolveLastAgentMessageError(conv: QaapAgentConversationDTO | undefined): string | undefined {
        return this.resolveLastAgentMessage(conv)?.error;
    }

    protected resolveTranscriptRowAgentMessage(row: HTMLElement | undefined,
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
    protected isAgentMessageCancelled(message: QaapAgentMessageDTO | undefined): boolean {
        return isAgentMessageCancelledHelper(message);
    }

    resolveTurnProvenance(conv: QaapAgentConversationDTO | undefined,
        message: QaapAgentMessageDTO | undefined,): { readonly turnAgentId?: string; readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel } {
        return resolveTurnProvenanceExtracted(this, conv, message);
    }

    protected resolveMobileClosingNarrativeAction(text: string,
        seenClosingNarrativeTexts: ReadonlySet<string>,
        normalizedFailureReason: string | undefined,
        isError: boolean,): MobileClosingNarrativeAction {
        return resolveMobileClosingNarrativeActionExtracted(this, text, seenClosingNarrativeTexts, normalizedFailureReason, isError);
    }

    protected resolveMobileClosingErrorCardRetry(): (() => void) | undefined {
        return resolveMobileClosingErrorCardRetryExtracted(this);
    }

    protected collectMobileClosingNarrativeTextsBefore(segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        beforeIndex: number,): Set<string> {
        return collectMobileClosingNarrativeTextsBeforeExtracted(this, segments, lastToolIndex, beforeIndex);
    }

    protected isClosingNarrativeSegmentSkipped(segment: QaapAgentMessageSegmentDTO,
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

    protected syncRowProcessAccordion(row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        streaming: boolean,): void {
        syncRowProcessAccordionExtracted(this, row, segments, conv, streaming);
    }

    protected upgradeToMobileExecutionEventTimeline(row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: { readonly streaming: boolean; readonly conv?: QaapAgentConversationDTO },): void {
        upgradeToMobileExecutionEventTimelineExtracted(this, row, segments, options);
    }

    protected resolveLobeVisibleTextSegmentIndexes(segments: readonly QaapAgentMessageSegmentDTO[],
        activityTimelineShown: boolean,): ReadonlySet<number> {
        return resolveLobeVisibleTextSegmentIndexesExtracted(this, segments, activityTimelineShown);
    }

    protected shouldRenderLobeTextSegment(segments: readonly QaapAgentMessageSegmentDTO[],
        segmentIndex: number,
        activityTimelineShown: boolean,): boolean {
        return shouldRenderLobeTextSegmentExtracted(this, segments, segmentIndex, activityTimelineShown);
    }

    protected isLobeWorkflowProcessText(content: string): boolean {
        return isLobeWorkflowProcessTextHelper(content, text => this.contentUi.cleanTranscriptDisplayText(text));
    }

    protected refreshMobileClosingNarrativeBlocks(segmentsBody: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],): void {
        refreshMobileClosingNarrativeBlocksExtracted(this, segmentsBody, segments);
    }

    protected enrichChangedFilesWithComposerGitStats(files: ReadonlyArray<{
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

    protected appendMobileDiffSummary(segmentsBody: HTMLElement,
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

    protected handleTranscriptActivityNavigation(item: TranscriptActivityNavigationItem,
        ownerRow: HTMLElement,): void {
        handleTranscriptActivityNavigationExtracted(this, item, ownerRow);
    }

    protected resolveTranscriptActivityExecutionContext(): {
        project: MobileProjectEntry | undefined;
        summary: QaapAgentConversationSummaryDTO | undefined;
    } {
        return resolveTranscriptActivityExecutionContextExtracted(this);
    }

    protected attachTranscriptActivityItemAction(li: HTMLElement,
        item: TranscriptActivityNavigationItem,
        _ownerRow: HTMLElement,): void {
        attachTranscriptActivityItemActionExtracted(this, li, item, _ownerRow);
    }

    protected bindTranscriptActivityListActions(list: HTMLElement, ownerRow: HTMLElement): void {
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

    protected resolveTranscriptStreamHealth(conv?: QaapAgentConversationDTO) {
        return resolveTranscriptStreamHealthExtracted(this, conv);
    }

    protected resolveTranscriptStreamStalled(conv?: QaapAgentConversationDTO): boolean {
        return this.resolveTranscriptStreamHealth(conv).stalled;
    }

    protected resolveTranscriptStreamTimedOut(conv?: QaapAgentConversationDTO): boolean {
        return this.resolveTranscriptStreamHealth(conv).timedOut;
    }

    protected resolveTranscriptStreamVisualIdle(segments: readonly QaapAgentMessageSegmentDTO[],
        streaming: boolean,): boolean {
        return resolveTranscriptStreamVisualIdleExtracted(this, segments, streaming);
    }

    protected resolveTranscriptStreamStallLabel(): string {
        return resolveTranscriptStreamStallLabelExtracted(this);
    }

    protected resolveTranscriptActivityItemsForDisplay(segments: readonly QaapAgentMessageSegmentDTO[],
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

    protected resolveTranscriptActivityRowContext(row: HTMLElement | undefined,
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

    protected resolvePendingTranscriptToolUseIds(conv: QaapAgentConversationDTO | undefined,
        segments: readonly QaapAgentMessageSegmentDTO[],): ReadonlySet<string> | undefined {
        return resolvePendingTranscriptToolUseIdsExtracted(this, conv, segments);
    }

    ensureTranscriptStreamStallWatch(row: HTMLElement): void {
        ensureTranscriptStreamStallWatchExtracted(this, row);
    }

    syncTranscriptStreamStallChrome(row: HTMLElement, conv: QaapAgentConversationDTO): void {
        syncTranscriptStreamStallChromeExtracted(this, row, conv);
    }

    protected syncTranscriptStreamTimeoutBanner(segmentsBody: ParentNode,
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

    protected resolveTranscriptStreamTimeoutDetail(cause?: TranscriptStreamTimeoutCause,): string | undefined {
        return resolveTranscriptStreamTimeoutDetailExtracted(this, cause);
    }

    protected createTranscriptStreamTimeoutBanner(cause?: TranscriptStreamTimeoutCause,): HTMLElement {
        return createTranscriptStreamTimeoutBannerExtracted(this, cause);
    }

    protected resolveTranscriptRowSegments(conv: QaapAgentConversationDTO, row: HTMLElement): QaapAgentMessageSegmentDTO[] {
        return resolveTranscriptRowSegmentsExtracted(this, conv, row);
    }

    protected syncTranscriptStreamingActivityLine(line: Element,
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
    protected pinnedLiveStatusHoldUntil = 0;
    protected pinnedLiveStatusConvId: string | undefined;
    /** High-water mark so the token meter never blinks away mid-turn. */
    protected pinnedLiveStatusPeakTokens = 0;

    /**
     * True while the live-status row should stay pinned for the whole backend turn.
     * Backend `streaming` / `settled` only — never hide on mid-stream "visually settled".
     */
    protected shouldShowPinnedTranscriptLiveStatus(conv: QaapAgentConversationDTO): boolean {
        return shouldShowPinnedTranscriptLiveStatusHelper(conv);
    }

    protected shouldHoldPinnedTranscriptLiveStatus(conv: QaapAgentConversationDTO): boolean {
        return shouldHoldPinnedTranscriptLiveStatusExtracted(this, conv);
    }

    protected resolveTranscriptLiveStatusChatHost(hint?: HTMLElement): HTMLElement | undefined {
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

    protected syncTranscriptThoughtBriefElement(block: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: { readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO },): void {
        syncTranscriptThoughtBriefElementExtracted(this, block, segments, options);
    }

    protected refreshTranscriptThoughtBriefTitle(title: HTMLElement,
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

    protected syncTranscriptActivityTimelineElement(timeline: HTMLElement,
        items: readonly TranscriptActivityTimelineItem[],
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityTimelineElementExtracted(this, timeline, items, options);
    }

    protected ensureLobeTranscriptWorkflowClasses(timeline: HTMLDetailsElement): void {
        ensureLobeTranscriptWorkflowClassesExtracted(this, timeline);
    }

    protected syncTranscriptActivityTimelineSummaryElement(timeline: HTMLDetailsElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        visibleItems: readonly TranscriptActivityTimelineItem[],
        policy: ReturnType<typeof resolveTranscriptTimelineVisibilityPolicy>,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityTimelineSummaryElementExtracted(this, timeline, segments, visibleItems, policy, options);
    }

    protected syncTranscriptSummaryIcons(timeline: HTMLElement, streaming: boolean): void {
        syncTranscriptSummaryIconsExtracted(this, timeline, streaming);
    }

    protected bindTranscriptActivityTimelineToggle(timeline: HTMLDetailsElement): void {
        bindTranscriptActivityTimelineToggleExtracted(this, timeline);
    }

    protected bindTranscriptActivityTimelineStickyBar(timeline: HTMLDetailsElement): void {
        bindTranscriptActivityTimelineStickyBarExtracted(this, timeline);
    }

    protected bindTranscriptActivityTimelineGapHandlers(timeline: HTMLElement): void {
        bindTranscriptActivityTimelineGapHandlersExtracted(this, timeline);
    }

    protected handleTranscriptActivityTimelineGapClick(event: Event): void {
        handleTranscriptActivityTimelineGapClickExtracted(this, event);
    }

    protected handleTranscriptActivityTimelineGapKeydown(event: KeyboardEvent): void {
        handleTranscriptActivityTimelineGapKeydownExtracted(this, event);
    }

    protected clearPinnedTranscriptStreamFooter(chatHost?: HTMLElement): void {
        clearPinnedTranscriptStreamFooterExtracted(this, chatHost);
    }

    protected ensureAndSyncTranscriptLiveStatusFooter(segmentsBody: HTMLElement,
        _segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        options?: { readonly streaming?: boolean; readonly stalled?: boolean; readonly timedOut?: boolean },): void {
        ensureAndSyncTranscriptLiveStatusFooterExtracted(this, segmentsBody, _segments, conv, options);
    }

    protected syncTranscriptTraceStatus(row: HTMLElement | null,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptTraceStatusExtracted(this, row, segments, options);
    }

    protected syncTranscriptActivityHistoryGap(li: HTMLElement,
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

    protected createTranscriptThoughtBriefIcon(active: boolean): HTMLElement {
        return createTranscriptThoughtBriefIconExtracted(this, active);
    }

    protected resolveTranscriptThoughtBriefIconClass(active: boolean): string {
        return resolveTranscriptThoughtBriefIconClassHelper(active);
    }

    protected syncTranscriptThoughtBriefIcon(icon: HTMLElement, active: boolean): void {
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

    protected wrapTranscriptToolGroup(strip: HTMLElement,
        umbrella?: ToolUmbrella,
        items?: ReadonlyArray<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>>,): HTMLDetailsElement {
        return wrapTranscriptToolGroupExtracted(this, strip, umbrella, items);
    }

    refreshTranscriptToolGroupSummary(group: HTMLElement): void {
        refreshTranscriptToolGroupSummaryExtracted(this, group);
    }

    protected formatTranscriptToolGroupLabel(stats: QaapTranscriptActivityStats): string {
        return formatTranscriptToolGroupLabelExtracted(this, stats);
    }

    protected resolveToolRowParts(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        kind: string,): ReturnType<typeof resolveTranscriptToolRowParts> {
        return resolveToolRowPartsExtracted(this, segment, kind);
    }

    createTranscriptToolPill(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },): HTMLDetailsElement {
        return createTranscriptToolPillExtracted(this, segment, conv, options);
    }

    protected shouldLazyHydrateTranscriptToolPillBody(options: {
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

    protected attachLazyTranscriptToolPillHydration(pill: HTMLDetailsElement): void {
        attachLazyTranscriptToolPillHydrationExtracted(this, pill);
    }

    protected buildTranscriptToolPillBody(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
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

    /** Claude-Code-style diff card for the latest edit: "Edited <file> +N −N" header + numbered lines. */
    createTranscriptInlineDiffStrip(segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        const editSegment = [...segments].reverse().find(segment =>
            segment.type === 'tool'
            && this.resolversUi.resolveTranscriptToolKind(segment.name) === 'editing'
            && !!segment.result?.trim(),
        );
        if (!editSegment || editSegment.type !== 'tool') {
            return undefined;
        }
        const card = extractTranscriptDiffCard(this.resolversUi.formatTranscriptToolResult(editSegment.result!));
        if (!card) {
            return undefined;
        }
        const path = this.resolversUi.extractTranscriptToolFullPath(editSegment.args);
        const fileName = path?.split('/').pop();

        const rawDiff = this.resolversUi.formatTranscriptToolResult(editSegment.result!);
        return buildTranscriptDiffCardFromExtracted(card, {
            fileName,
            path: path ? this.resolversUi.compactTranscriptPath(path) : undefined,
            rawDiff,
        });
    }

    formatTranscriptActivityMeta(stats: QaapTranscriptActivityStats): string {
        return formatTranscriptActivityMetaExtracted(this, stats);
    }

    protected resolveTranscriptActivityTimelineSummary(segments: readonly QaapAgentMessageSegmentDTO[],
        hiddenCount = 0,
        options?: { readonly streaming?: boolean; readonly row?: HTMLElement },): string {
        return resolveTranscriptActivityTimelineSummaryExtracted(this, segments, hiddenCount, options);
    }

    protected resolveTranscriptTurnDurationMs(segments: readonly QaapAgentMessageSegmentDTO[],
        row: HTMLElement | undefined,): number | undefined {
        return resolveTranscriptTurnDurationMsExtracted(this, segments, row);
    }

    createTranscriptActivityTimeline(segments: QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions & { readonly includeThinkingSteps?: boolean },): HTMLElement | undefined {
        return createTranscriptActivityTimelineExtracted(this, segments, options);
    }

    protected syncTranscriptActivityItemElement(li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier> = isActive ? 'current' : 'recent',
        subagentCardChild = false,): void {
        syncTranscriptActivityItemElementExtracted(this, li, item, isActive, options, tier, subagentCardChild);
    }

    protected syncTranscriptExecutionNarrativeItemElement(li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier>,): void {
        syncTranscriptExecutionNarrativeItemElementExtracted(this, li, item, tier);
    }

    protected syncTranscriptCheckpointRestoreAction(li: HTMLElement,
        item: TranscriptActivityTimelineItem,): void {
        syncTranscriptCheckpointRestoreActionExtracted(this, li, item);
    }

    protected guardTranscriptActivityExpandClose(host: HTMLElement | null | undefined): void {
        guardTranscriptActivityExpandCloseExtracted(this, host);
    }

    async restoreTranscriptCheckpoint(checkpointId: string, checkpointLabel?: string): Promise<void> {
        return restoreTranscriptCheckpointExtracted(this, checkpointId, checkpointLabel);
    }

    protected applyTranscriptActivityItemClassName(li: HTMLElement,
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

    protected applyTranscriptActivityItemChrome(li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options: TranscriptActivityTimelineOptions | undefined,
        tierClass: string,
        shimmerActive: boolean,
        subagentCardChild = false,): void {
        applyTranscriptActivityItemChromeExtracted(this, li, item, isActive, options, tierClass, shimmerActive, subagentCardChild);
    }

    protected applyTranscriptActivityStepShimmer(copy: HTMLElement,
        isActive: boolean,
        shimmerActive: boolean,
        stalled: boolean,): void {
        applyTranscriptActivityStepShimmerExtracted(this, copy, isActive, shimmerActive, stalled);
    }

    protected syncTranscriptActivityStepCopyCursorTrace(rowEl: HTMLElement,
        item: TranscriptActivityTimelineItem,): boolean {
        return syncTranscriptActivityStepCopyCursorTraceExtracted(this, rowEl, item);
    }

    protected syncTranscriptActivityDiffPeek(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityDiffPeekExtracted(this, copy, item, options);
    }

    protected ensureTranscriptActivityVerbDetailSpacing(rowEl: HTMLElement): void {
        ensureTranscriptActivityVerbDetailSpacingExtracted(this, rowEl);
    }

    protected appendTranscriptActivityEditDiffTail(rowEl: HTMLElement,
        added: number,
        removed: number,): void {
        appendTranscriptActivityEditDiffTailExtracted(this, rowEl, added, removed);
    }

    protected resolveTranscriptActivityExpandDeps(): TranscriptActivityExpandDeps {
        return resolveTranscriptActivityExpandDepsExtracted(this);
    }

    protected resolveTranscriptActivityExpandContent(item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): TranscriptActivityExpandContent | undefined {
        return resolveTranscriptActivityExpandContentExtracted(this, item, options);
    }

    protected enrichTranscriptActivityExpandContent(content: TranscriptActivityExpandContent,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): TranscriptActivityExpandContent {
        return enrichTranscriptActivityExpandContentExtracted(this, content, item, options);
    }

    protected enrichTranscriptActivityReadExpandEntry(entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry {
        return enrichTranscriptActivityReadExpandEntryExtracted(this, entry, segment);
    }

    protected enrichTranscriptActivityEditExpandEntry(entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,
        options?: TranscriptActivityTimelineOptions,): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry {
        return enrichTranscriptActivityEditExpandEntryExtracted(this, entry, segment, options);
    }

    protected shouldShowTranscriptActivityItemExpand(item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): boolean {
        return shouldShowTranscriptActivityItemExpandExtracted(this, item, options);
    }

    protected unwrapTranscriptActivityExpandCopy(copy: HTMLElement): void {
        unwrapTranscriptActivityExpandCopyExtracted(this, copy);
    }

    protected syncTranscriptActivityExpandCopy(copy: HTMLElement, content: TranscriptActivityExpandContent): void {
        syncTranscriptActivityExpandCopyExtracted(this, copy, content);
    }

    protected renderTranscriptActivityExpandBody(body: HTMLElement, content: TranscriptActivityExpandContent): void {
        renderTranscriptActivityExpandBodyExtracted(this, body, content);
    }

    protected syncTranscriptActivityRunningBadge(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityRunningBadgeExtracted(this, copy, item, isActive, options);
    }

    protected syncTranscriptActivityErrorCopy(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityErrorCopyExtracted(this, copy, item, options);
    }

    protected syncTranscriptActivityThinkingCopy(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityThinkingCopyExtracted(this, copy, item, isActive, options);
    }

    protected populateTranscriptActivityStepCopy(copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        populateTranscriptActivityStepCopyExtracted(this, copy, item, isActive, options);
    }

    protected shouldRenderTranscriptActivityDetailAsPill(detail: string | undefined,
        toolKind?: string,): boolean {
        return shouldRenderTranscriptActivityDetailAsPillExtracted(this, detail, toolKind);
    }

    protected createTranscriptActivityFileChip(detail: string, toolKind?: string, fullPath?: string): HTMLElement {
        return createTranscriptActivityFileChipExtracted(this, detail, toolKind, fullPath);
    }

    protected readonly activityToolKindIconMap: Record<string, string> = {
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

    createTranscriptDiffSummaryCard(segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        return createTranscriptDiffSummaryCardExtracted(this, segments);
    }

    createTranscriptChangedFilesCard(segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        return createTranscriptChangedFilesCardExtracted(this, segments);
    }

    protected createTranscriptChangedFileMiniDiffPreview(segments: readonly QaapAgentMessageSegmentDTO[],
        file: { readonly path: string },): HTMLElement | undefined {
        return createTranscriptChangedFileMiniDiffPreviewExtracted(this, segments, file);
    }

    createTranscriptChangedFilesReviewButton(): HTMLButtonElement {
        return createTranscriptChangedFilesReviewButtonExtracted(this);
    }

    protected appendTranscriptChangedFileDiffStats(parent: HTMLElement,
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

    createTranscriptVerificationCard(segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        return createTranscriptVerificationCardExtracted(this, segments);
    }

    createTranscriptTechnicalDetailsCard(segments: QaapAgentMessageSegmentDTO[],
        options?: { readonly activityTimelineShown?: boolean },): HTMLElement | undefined {
        return createTranscriptTechnicalDetailsCardExtracted(this, segments, options);
    }

    createTranscriptStreamingActivityRow(conv: QaapAgentConversationDTO): HTMLElement | undefined {
        return createTranscriptStreamingActivityRowExtracted(this, conv);
    }

    protected createTranscriptStreamMeta(conv: QaapAgentConversationDTO, ownerRow?: HTMLElement): HTMLElement | undefined {
        return createTranscriptStreamMetaExtracted(this, conv, ownerRow);
    }

    protected resolveTranscriptStreamDurationLabel(conv: QaapAgentConversationDTO): string {
        return resolveTranscriptStreamDurationLabelExtracted(this, conv);
    }

    resolveTranscriptStreamingActivity(conv: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean; readonly timedOut?: boolean },): { kind: string; title: string; detail: string } {
        return resolveTranscriptStreamingActivityExtracted(this, conv, options);
    }
}
