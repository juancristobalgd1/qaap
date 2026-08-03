// @ts-nocheck
// Extracted from mobile-projects-transcript-messages-artifacts-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { type QaapAgentConversationDTO, type QaapAgentConversationSummaryDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO, cancelConversationRun, conversationToSummary, resolveRunUserMessageId, restoreConversationCheckpoint } from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task-client';
import {
    extractLastFailedToolFromMessage,
    resolveAgentTurnFailureTechnicalContent,
} from '../common/qaap-agent-failure-message';
import { formatReadToolDetailFromArgs, formatToolActivityLabel } from '../common/qaap-agent-conversation-list-metrics';
import { excerptTranscriptThought, extractTranscriptDiffCard, extractTranscriptMcpServerLabel, hasTranscriptActivityStats, isTranscriptThoughtExcerptTruncated, isTranscriptTodoTool, parseTranscriptTodoChecklist, resolveTranscriptActivityStats, resolveTranscriptThinkingContent, resolveTranscriptToolPillDescriptors, resolveTranscriptToolRowParts, shouldOpenTranscriptToolDetails, type QaapTranscriptActivityStats } from '../common/qaap-agent-transcript-segments';
import { formatTranscriptStreamElapsed, formatTranscriptStreamTokens, isAwaitingFirstTranscriptAgentOutput, isTranscriptAgentThinkingPhase, isTranscriptComposerVisualIdle, resolveLastUserPromptChars, resolveTranscriptTraceDisplayPhase, resolveTranscriptTurnElapsedMs, resolveTranscriptTurnStartMs, resolveTranscriptTurnStreamChars, shouldExpandTranscriptInlineTimeline, shouldShowTranscriptInlineTimeline, shouldShowTranscriptStreamingActivity, shouldShowTranscriptThoughtBrief, shouldTranscriptStreamLabelShimmer } from '../common/qaap-transcript-stream-status';
import { resolveTranscriptStreamHealth, type TranscriptStreamTimeoutCause } from '../common/qaap-transcript-stream-health';
import { resolveTranscriptStreamingAgentSegments } from '../common/qaap-transcript-semantic-progress';
import {
    resolveTranscriptEffectiveStatus,
} from '../common/qaap-transcript-turn-status';
import { resolveTranscriptStreamingActivityFromSegments } from '../common/qaap-transcript-streaming-activity';
import type { TranscriptActivityNavigationItem, TranscriptActivityNavigationOptions } from '../common/qaap-transcript-activity-navigation';
import { groupTranscriptActivityNavigationItems, resolveTranscriptLifecycleActivityItems } from '../common/qaap-transcript-activity-navigation';
import { conversationRequestsDevPreview } from '../common/qaap-transcript-preview-offer';
import {
    resolveTranscriptBootstrapDiagnosticActivityItems,
    toTranscriptPreviewBootstrapSnapshot,
} from '../common/qaap-transcript-preview-bootstrap-failure';
import { isTranscriptActivityLiveState, shouldApplyTranscriptActivitySettleMotion, type TranscriptActivityStepState } from '../common/qaap-transcript-activity-step-state';
import { TranscriptActivityTimingStore } from '../common/qaap-transcript-activity-timing';
import { resolveTranscriptActivityDiffPeek } from '../common/qaap-transcript-activity-diff-peek';
import { resolveTranscriptSubagentCardModels, transcriptActivitySubagentCardClassName } from '../common/qaap-transcript-activity-subagent-card';
import {
    resolveTranscriptTimelineItemTier,
    transcriptTimelineTierClassName,
} from '../common/qaap-transcript-timeline-tier';
import {
    resolveTranscriptActivityTimelineSummaryText,
} from '../common/qaap-transcript-activity-timeline-summary';
import { resolveTranscriptTimelineVisibilityPolicy } from '../common/qaap-transcript-timeline-visibility';
import { resolveQaapTranscriptTrace } from '../common/qaap-transcript-trace-model';
import {
    markTranscriptTimelineGapExpanded,
    markTranscriptTimelineRevealAll,
    readTranscriptTimelineExpandState,
    resolveTranscriptTimelineRenderWindowWithExpand,
    TRANSCRIPT_TIMELINE_GAP_POSITION_ATTR,
} from '../common/qaap-transcript-timeline-gap-expand';
import {
    fingerprintTranscriptActivityItemContent,
    fingerprintTranscriptActivityItemSlot,
    fingerprintTranscriptTimelineSummary,
    fingerprintTranscriptTimelineSync,
    TRANSCRIPT_ACTIVITY_ITEM_CONTENT_FP_ATTR,
    TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR,
    TRANSCRIPT_TIMELINE_SUMMARY_FP_ATTR,
    TRANSCRIPT_TIMELINE_SYNC_FP_ATTR,
} from '../common/qaap-transcript-timeline-sync-fingerprint';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';
import { isPendingTranscriptToolSegment } from '../common/qaap-transcript-approval-inline';
import { buildTranscriptApprovalCard, TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { respondToTranscriptApproval } from './qaap-transcript-approval-respond';
import { buildTranscriptDiffCardFromExtracted, buildTranscriptToolUiPayloadElement } from './qaap-transcript-rich-content-ui';
import { resolveTranscriptToolUiPayloadFromSegment } from '../common/qaap-transcript-tool-ui-payloads';
import { TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, TRANSCRIPT_ACTIVITY_ACTIVE_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, TRANSCRIPT_SEGMENT_INDEX_ATTR, TRANSCRIPT_THOUGHT_BRIEF_ATTR, TRANSCRIPT_TOOL_USE_ID_ATTR } from '../common/qaap-transcript-incremental-update';
import {
    annotateTranscriptActivityNestMetadata,
    transcriptActivityNestDepthClassName,
} from '../common/qaap-transcript-activity-nesting';
import { bindTranscriptActivityListKeyboard } from '../common/qaap-transcript-activity-keyboard';
import {
    TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD,
} from '../common/qaap-transcript-timeline-window';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectEntry } from './mobile-projects-types';
import { MobileSnackbar } from './mobile-snackbar';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';
import { isTranscriptDocumentVisible } from '../common/qaap-transcript-document-visibility';
import { resolveTranscriptToolErrorDisplay } from '../common/qaap-transcript-tool-error-display';
import {
    resolveTranscriptActivityExpandContent,
    shouldShowTranscriptActivityExpandContent,
    type TranscriptActivityExpandContent,
    type TranscriptActivityExpandDeps,
    type TranscriptActivityTerminalExpandEntry,
} from '../common/qaap-transcript-activity-expand-core';
import { createTranscriptWebSearchCard } from './qaap-transcript-web-search-ui';
import { canRestoreConversationCheckpoint, annotateTranscriptActivityCheckpointIds } from '../common/qaap-transcript-checkpoint-restore';
import { createAgentSetupElement, syncAgentSetupElement, destroyAgentSetupElement } from '../common/qaap-agent-setup-phrases';
import {
    createThinkingOrbIndicator,
    destroyThinkingOrbIndicator,
    QAAP_THINKING_ORB_INDICATOR_CLASS,
    syncThinkingOrbIndicator,
} from './qaap-thinking-orb-indicator';
import {
    resolveActivityToolIconMotionKind,
    syncActivityToolIconMotion,
} from './qaap-activity-tool-icon-motion';
import {
    coalesceToolSegments,
    bundleToolSegmentsByUmbrella,
    summarizeToolBundle,
    type ToolUmbrella,
} from '../common/qaap-tool-umbrella';
import {
    buildMobileExecutionEvents,
    createMobileClosingErrorCardElement,
    createMobileDiffSummaryElement,
    createMobileExecutionEventTimeline,
    createMobileLineDiffSummaryElement,
    findMobileProcessAccordion,
    hasMobileExecutionEventTimeline,
    MOBILE_CLOSING_ERROR_CARD_CLASS,
    MOBILE_TOOL_FILE_OPEN_EVENT,
    refreshMobileExecutionEventTimeline,
    resolveMobileActivityVerb,
    syncMobileProcessAccordionState,
    syncTranscriptStandaloneTurnProvenance,
    wrapMobileProcessAccordion,
} from './qaap-execution-event-timeline';
import { ensureSlowTurnHint } from './qaap-slow-turn-hint';
import { getFileIconClass } from '../common/qaap-file-icon-utils';
import {
    clearLegacyTranscriptStreamFooterHost,
    createTranscriptLiveStatusElement,
    ensureTranscriptLiveStatusAtScrollerTail,
    removeNestedTranscriptLiveStatusCopies,
    removeTranscriptLiveStatusElement,
    resolveTranscriptChatHostFromNode,
    resolveTranscriptLiveStatusTokenCount,
    resolveTranscriptScroller,
    resolveTranscriptSegmentsFooterAnchor,
    syncTranscriptLiveStatusElement,
    TRANSCRIPT_LIVE_STATUS_CLASS,
    TRANSCRIPT_LIVE_STATUS_LOGO_CLASS,
    TRANSCRIPT_STREAM_FOOTER_HOST_CLASS,
} from '../common/qaap-transcript-live-status';
import {
    isTranscriptExecutionTimelineNarrative,
    buildTranscriptExecutionTimelineItems,
    normalizeMobileClosingNarrativeText,
    type TranscriptActivityTimelineItem,
} from './mobile-projects-transcript-timeline-utils';
import {
    destroyThinkingOrbHosts as destroyThinkingOrbHostsHelper,
    queueExecutionTimelineRefresh as queueExecutionTimelineRefreshHelper,
    skipExecutionTimelineRefresh as skipExecutionTimelineRefreshHelper,
    consumeExecutionTimelineRefresh as consumeExecutionTimelineRefreshHelper,
    consumeSkippedExecutionTimelineRefresh as consumeSkippedExecutionTimelineRefreshHelper,
    didExecutionToolSegmentsChange as didExecutionToolSegmentsChangeHelper,
    isConversationWorking as isConversationWorkingHelper,
    isConversationFinalResponseCommitted as isConversationFinalResponseCommittedHelper,
    isConversationError as isConversationErrorHelper,
    isAgentMessageCancelled as isAgentMessageCancelledHelper,
    resolveTranscriptStreamTimeoutDetail as resolveTranscriptStreamTimeoutDetailHelper,
    shouldShowPinnedTranscriptLiveStatus as shouldShowPinnedTranscriptLiveStatusHelper,
    resolveTranscriptThoughtBriefIconClass as resolveTranscriptThoughtBriefIconClassHelper,
    isLobeWorkflowProcessText as isLobeWorkflowProcessTextHelper,
    collectMobileClosingNarrativeTextsBefore as collectMobileClosingNarrativeTextsBeforeHelper,
    resolveLobeVisibleTextSegmentIndexes as resolveLobeVisibleTextSegmentIndexesHelper,
    resolveConversationElapsedMs as resolveConversationElapsedMsHelper,
    scrollTranscriptStreamingTraceIntoView as scrollTranscriptStreamingTraceIntoViewHelper,
    enrichChangedFilesWithComposerGitStats as enrichChangedFilesWithComposerGitStatsHelper,
    syncTranscriptActivityThinkingCopy as syncTranscriptActivityThinkingCopyHelper,
    populateTranscriptActivityStepCopy as populateTranscriptActivityStepCopyHelper,
    syncTranscriptActivityHistoryGap as syncTranscriptActivityHistoryGapHelper,
    refreshTranscriptThoughtBriefTitle as refreshTranscriptThoughtBriefTitleHelper,
    syncTranscriptThoughtBriefElement as syncTranscriptThoughtBriefElementHelper,
    syncTranscriptStreamStallChrome as syncTranscriptStreamStallChromeHelper,
} from './mobile-projects-transcript-messages-artifacts-helpers';
import {
    bindTranscriptActivityListActions as bindTranscriptActivityListActionsHelper,
    appendFreeModelTimeoutHint as appendFreeModelTimeoutHintHelper,
    syncTranscriptStreamTimeoutBanner as syncTranscriptStreamTimeoutBannerHelper,
    resolveTranscriptActivityRowContext as resolveTranscriptActivityRowContextHelper,
} from './mobile-projects-transcript-messages-artifacts-helpers2';

export function patchStreamingAgentTextSegmentsExtracted(ctx: any, row: HTMLElement,
        prevSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        // Codex-style execution event timeline: update closing narrative text
        // blocks (rendered outside the timeline as rich content) in-place, and
        // rebuild the timeline to reflect any narrative changes inside events.
        // Narrative inside events is plain text updated by the timeline rebuild;
        // closing narrative blocks are rich content that must be refreshed here
        // because the timeline rebuild does not touch them.
        if (hasMobileExecutionEventTimeline(row)) {
            const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
            if (!segmentsBody) {
                return true;
            }
            const streaming = row.classList.contains('theia-mod-streaming');
            const lastToolIndex = nextSegments.reduce(
                (last, seg, idx) => seg.type === 'tool' ? idx : last,
                -1,
            );
            let timelineNarrativeChanged = false;
            for (let segmentIndex = 0; segmentIndex < nextSegments.length; segmentIndex++) {
                const previous = prevSegments[segmentIndex];
                const next = nextSegments[segmentIndex];
                if (next?.type !== 'text' || previous?.type !== 'text') {
                    continue;
                }
                if ((previous.content ?? '') === (next.content ?? '')) {
                    continue;
                }
                // Only closing narrative text blocks (after the last tool) are
                // rendered as separate rich content elements outside the timeline.
                // Narrative inside events is plain text within the timeline and
                // is updated by the timeline rebuild below.
                if (segmentIndex <= lastToolIndex) {
                    timelineNarrativeChanged = true;
                    continue;
                }
                if (ctx.isLobeWorkflowProcessText(next.content ?? '')) {
                    continue;
                }
                const host = segmentsBody.querySelector<HTMLElement>(
                    `[${TRANSCRIPT_SEGMENT_INDEX_ATTR}="${segmentIndex}"]`,
                );
                if (host) {
                    // A closing error card (see renderMobileExecutionEventTimeline)
                    // is not a markdown block — re-rendering it here would clobber
                    // its icon + message structure with the raw markdown renderer.
                    // Mirror the guard in refreshMobileClosingNarrativeBlocks.
                    if (!host.classList.contains(MOBILE_CLOSING_ERROR_CARD_CLASS)) {
                        ctx.toolUi.renderTranscriptRichContent(host, next.content ?? '', { streaming });
                    }
                } else if (ctx.isClosingNarrativeSegmentSkipped(next, nextSegments, lastToolIndex, segmentIndex, conv)) {
                    // The segment has no DOM host because the closing-narrative
                    // dedup / error-suppression logic (see
                    // resolveMobileClosingNarrativeAction) deliberately skipped
                    // it — a duplicate of an earlier closing block, or identical
                    // to `msg.error` which the styled failure dialog already
                    // shows. A full row rebuild would re-skip it and produce
                    // byte-identical DOM, so returning false here would churn a
                    // brand-new process accordion on every streaming tick for no
                    // visible change. Keep patching in place instead.
                    continue;
                } else {
                    // Genuinely missing closing-narrative host. Prefer refreshing
                    // the Codex timeline in place over forcing a full agent-row
                    // remount (which restarts shimmer/spin mid-stream).
                    if (hasMobileExecutionEventTimeline(row)) {
                        ctx.queueExecutionTimelineRefresh(row, nextSegments);
                        return true;
                    }
                    return false;
                }
            }
            // Coalesce execution-timeline refresh with the final activity patch
            // for this SSE tick. Closing final-answer text lives outside the
            // timeline, so pure final-answer growth should not touch it.
            if (timelineNarrativeChanged) {
                ctx.queueExecutionTimelineRefresh(row, nextSegments);
            } else {
                ctx.skipExecutionTimelineRefresh(row);
            }
            return true;
        }
        // Upgrade path: if tools are present but no Codex-style timeline yet,
        // the caller (patchStreamingAgentToolSegments) will upgrade. Return
        // true to avoid patching legacy text blocks that will be removed.
        if (nextSegments.some(s => s.type === 'tool')) {
            return true;
        }
        const activityTimelineShown = !!row.querySelector(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        for (let segmentIndex = 0; segmentIndex < nextSegments.length; segmentIndex++) {
            const previous = prevSegments[segmentIndex];
            const next = nextSegments[segmentIndex];
            if (next.type !== 'text' || previous.type !== 'text') {
                continue;
            }
            if ((previous.content ?? '') === (next.content ?? '')) {
                continue;
            }
            const host = row.querySelector<HTMLElement>(
                `[${TRANSCRIPT_SEGMENT_INDEX_ATTR}="${segmentIndex}"]`,
            );
            if (!host) {
                if (!ctx.shouldRenderLobeTextSegment(nextSegments, segmentIndex, activityTimelineShown)) {
                    continue;
                }
                return false;
            }
            const streaming = row.classList.contains('theia-mod-streaming');
            ctx.toolUi.renderTranscriptRichContent(host, next.content ?? '', { streaming });
        }
        return true;
}

export function patchStreamingAgentToolSegmentsExtracted(ctx: any, row: HTMLElement,
        prevSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        // Codex-style execution event timeline: rebuild in place.
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (segmentsBody && hasMobileExecutionEventTimeline(row)) {
            if (ctx.didExecutionToolSegmentsChange(prevSegments, nextSegments)) {
                ctx.queueExecutionTimelineRefresh(row, nextSegments);
            }
            // Sync the process accordion label/state while streaming.
            ctx.syncRowProcessAccordion(row, nextSegments, conv, true);
            return true;
        }
        // Upgrade path: row has tools but no Codex-style timeline yet.
        if (segmentsBody && nextSegments.some(s => s.type === 'tool')) {
            ctx.upgradeToMobileExecutionEventTimeline(row, nextSegments, { streaming: true, conv });
            return true;
        }

        for (let segmentIndex = 0; segmentIndex < nextSegments.length; segmentIndex++) {
            const previous = prevSegments[segmentIndex];
            const next = nextSegments[segmentIndex];
            if (next.type !== 'tool' || previous.type !== 'tool') {
                continue;
            }
            if (previous.toolUseId !== next.toolUseId || previous.name !== next.name) {
                return false;
            }
            const previousResult = previous.result ?? '';
            const incomingResult = next.result ?? '';
            const previousArgs = previous.args ?? '';
            const incomingArgs = next.args ?? '';
            const unchanged = previous.finished === next.finished
                && previousResult === incomingResult
                && previousArgs === incomingArgs;
            if (unchanged) {
                continue;
            }
            const pill = row.querySelector<HTMLDetailsElement>(
                `[${TRANSCRIPT_TOOL_USE_ID_ATTR}="${CSS.escape(next.toolUseId)}"]`,
            );
            if (!pill) {
                return false;
            }
            ctx.patchTranscriptToolPill(pill, previous, next, conv);
            const group = pill.closest('.theia-mobile-agent-tool-group');
            if (group instanceof HTMLElement) {
                const items = transcriptToolGroupItems.get(group);
                if (items) {
                    const idx = items.findIndex(item => item.toolUseId === next.toolUseId);
                    if (idx >= 0) {
                        items[idx] = next;
                    }
                }
                ctx.refreshTranscriptToolGroupSummary(group);
            }
        }
        return true;
}

export function resolveTranscriptStreamHealthExtracted(ctx: any, conv?: QaapAgentConversationDTO) {
        const streaming = !!conv && resolveTranscriptEffectiveStatus(conv) === 'streaming';
        const segments = conv ? resolveTranscriptStreamingAgentSegments(conv) : [];
        return resolveTranscriptStreamHealth({
            streaming,
            lastProgressAtMs: ctx.host.transcriptLastStreamProgressAt,
            lastTransportEventAtMs: ctx.host.transcriptLastTransportEventAt,
            segments,
        });
}

export function resolveTranscriptStreamVisualIdleExtracted(ctx: any, segments: readonly QaapAgentMessageSegmentDTO[],
        streaming: boolean,): boolean {
        return isTranscriptComposerVisualIdle(
            segments,
            streaming,
            ctx.host.transcriptLastStreamProgressAt,
        );
}

export function resolveTranscriptStreamStallLabelExtracted(ctx: any): string {
        return nls.localize(
            'qaap/mobileProjects/transcriptStreamStalled',
            'Taking longer than expected',
        );
}

export function resolveTranscriptActivityItemsForDisplayExtracted(ctx: any, segments: readonly QaapAgentMessageSegmentDTO[],
        options?: {
            readonly stalled?: boolean;
            readonly timedOut?: boolean;
            readonly includeThinkingSteps?: boolean;
            readonly row?: HTMLElement;
            readonly conv?: QaapAgentConversationDTO;
            readonly streaming?: boolean;
        },): readonly TranscriptActivityTimelineItem[] {
        const rowContext = ctx.resolveTranscriptActivityRowContext(
            options?.row,
            segments,
            options?.conv,
            { stalled: options?.stalled, streaming: options?.streaming },
        );
        const segmentItems = ctx.resolversUi.resolveTranscriptActivityItems(
            [...segments],
            options?.includeThinkingSteps ?? true,
            {
                stalled: options?.stalled,
                streaming: rowContext.navigationOptions.streaming,
                pendingToolUseIds: rowContext.navigationOptions.pendingToolUseIds,
                messageCancelled: rowContext.navigationOptions.messageCancelled,
                resolveStepDurationMs: rowContext.resolveDurationMs,
                resolveStepTimestamp: rowContext.resolveTimestamp,
            },
        );
        const lifecycleItems = resolveTranscriptLifecycleActivityItems(rowContext.message?.traceEvents);
        const conv = options?.conv;
        const hasPreviewFailureTrace = rowContext.message?.traceEvents?.some(event => event.type === 'error') ?? false;
        const bootstrapDiagnosticItems = conv
            && !hasPreviewFailureTrace
            && (conversationRequestsDevPreview(conv) || conv.status === 'failed')
            && ctx.host.projectBootstrap
            ? resolveTranscriptBootstrapDiagnosticActivityItems(
                toTranscriptPreviewBootstrapSnapshot(ctx.host.projectBootstrap.getStateSnapshot()),
            )
            : [];
        const items = annotateTranscriptActivityNestMetadata(
            groupTranscriptActivityNavigationItems([...segmentItems, ...lifecycleItems, ...bootstrapDiagnosticItems]),
            segments,
        );
        const annotatedItems = annotateTranscriptActivityCheckpointIds(items, options?.conv);
        if (!options?.stalled || annotatedItems.length === 0) {
            return annotatedItems;
        }
        const activeIndex = annotatedItems.findIndex(item => isTranscriptActivityLiveState(item.state));
        if (activeIndex < 0) {
            return annotatedItems;
        }
        const stallLabel = ctx.resolveTranscriptStreamStallLabel();
        return annotatedItems.map((item, index) => index === activeIndex
            ? { ...item, state: 'warning', label: stallLabel }
            : item);
}

export function resolveTranscriptActivityRowContextExtracted(ctx: any, row: HTMLElement | undefined,
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
        return resolveTranscriptActivityRowContextHelper(row, segments, conv, options, {
            activityTiming: ctx.activityTiming,
            resolvePendingTranscriptToolUseIds: (c, s) => ctx.resolvePendingTranscriptToolUseIds(c, s),
        });
}

export function resolvePendingTranscriptToolUseIdsExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined,
        segments: readonly QaapAgentMessageSegmentDTO[],): ReadonlySet<string> | undefined {
        if (!conv || !conversationUsesInteractiveApprovals(conv)) {
            return undefined;
        }
        const pending = new Set<string>();
        for (const segment of segments) {
            if (segment.type === 'tool'
                && !segment.finished
                && ctx.host.transcriptLiveUi.hasPendingTranscriptToolApproval(conv.id, segment.toolUseId)) {
                pending.add(segment.toolUseId);
            }
        }
        return pending.size > 0 ? pending : undefined;
}

export function ensureTranscriptStreamStallWatchExtracted(ctx: any, row: HTMLElement): void {
        if (row.dataset.transcriptStallWatch === '1') {
            return;
        }
        row.dataset.transcriptStallWatch = '1';
        // Bind to the row's own document view rather than the global `window`: the
        // interval outlives synchronous test bodies, and the global jsdom window is
        // torn down between specs, so a global `window.clearInterval` in the callback
        // would throw `window is not defined` once the timer fires post-teardown.
        const view = (row.ownerDocument?.defaultView ?? window) as Window & typeof globalThis;
        const timer = view.setInterval(() => {
            if (!row.isConnected) {
                view.clearInterval(timer);
                row.removeAttribute('data-transcript-stall-watch');
                return;
            }
            if (!row.classList.contains('theia-mod-streaming')) {
                view.clearInterval(timer);
                row.removeAttribute('data-transcript-stall-watch');
                row.classList.remove('theia-mod-stream-stalled');
                return;
            }
            if (!isTranscriptDocumentVisible()) {
                return;
            }
            const conv = ctx.host.transcriptLastConv;
            if (!conv || conv.status !== 'streaming') {
                return;
            }
            ctx.syncTranscriptStreamStallChrome(row, conv);
        }, 1000);
}

export function syncTranscriptStreamStallChromeExtracted(ctx: any, row: HTMLElement, conv: QaapAgentConversationDTO): void {
        syncTranscriptStreamStallChromeHelper(row, conv, {
            resolveTranscriptStreamHealth: c => ctx.resolveTranscriptStreamHealth(c),
            syncTranscriptStreamTimeoutBanner: (s, t, c, cv) => ctx.syncTranscriptStreamTimeoutBanner(s, t, c, cv),
            resolveTranscriptActivityItemsForDisplay: (s, o) => ctx.resolveTranscriptActivityItemsForDisplay(s, o),
            resolveTranscriptRowSegments: (c, r) => ctx.resolveTranscriptRowSegments(c, r),
            syncTranscriptActivityTimelineElement: (t, i, o) => ctx.syncTranscriptActivityTimelineElement(t, i, o),
            syncTranscriptStreamingActivityLine: (l, c, s, t) => ctx.syncTranscriptStreamingActivityLine(l, c, s, t),
        });
}

export function syncTranscriptStreamTimeoutBannerExtracted(ctx: any, segmentsBody: ParentNode,
        timedOut: boolean,
        cause?: TranscriptStreamTimeoutCause,
        conv?: QaapAgentConversationDTO,): void {
        syncTranscriptStreamTimeoutBannerHelper(segmentsBody, timedOut, cause, conv, {
            createTranscriptStreamTimeoutBanner: c => ctx.createTranscriptStreamTimeoutBanner(c),
            refreshTranscriptExecutionChrome: () => ctx.host.transcriptHeaderUi.refreshTranscriptExecutionChrome(),
            resolveTranscriptStreamTimeoutDetail: c => ctx.resolveTranscriptStreamTimeoutDetail(c),
        });
}

export function resolveTranscriptStreamTimeoutDetailExtracted(ctx: any, cause?: TranscriptStreamTimeoutCause,): string | undefined {
        return resolveTranscriptStreamTimeoutDetailHelper(cause);
}

