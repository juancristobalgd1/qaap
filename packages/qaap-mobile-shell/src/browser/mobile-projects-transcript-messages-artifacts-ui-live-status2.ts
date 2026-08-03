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

export function ensureLobeTranscriptWorkflowClassesExtracted(ctx: any, timeline: HTMLDetailsElement): void {
        timeline.classList.add('theia-mobile-agent-lobe-workflow');
        timeline.querySelectorAll<HTMLElement>(
            '.theia-mobile-agent-activity-timeline-summary, .theia-mobile-agent-activity-timeline-sticky-bar',
        ).forEach(summary => summary.classList.add('theia-mobile-agent-lobe-workflow-summary'));
        timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-chevron')
            .forEach(chevron => chevron.classList.add('theia-mobile-agent-lobe-workflow-toggle'));
}

export function syncTranscriptActivityTimelineSummaryElementExtracted(ctx: any, timeline: HTMLDetailsElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        visibleItems: readonly TranscriptActivityTimelineItem[],
        policy: ReturnType<typeof resolveTranscriptTimelineVisibilityPolicy>,
        options?: TranscriptActivityTimelineOptions,): void {
        const summaryLabels = timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-label');
        if (summaryLabels.length === 0) {
            return;
        }
        for (const summaryLabel of summaryLabels) {
            const summaryText = ctx.resolveTranscriptActivityTimelineSummary(segments, 0, {
                streaming: !!options?.streaming,
                row: options?.row,
            });
            const summaryFingerprint = fingerprintTranscriptTimelineSummary(
                summaryText,
                policy.hiddenCount,
                policy.collapsed,
            );
            if (summaryLabel.getAttribute(TRANSCRIPT_TIMELINE_SUMMARY_FP_ATTR) === summaryFingerprint) {
                continue;
            }
            summaryLabel.setAttribute(TRANSCRIPT_TIMELINE_SUMMARY_FP_ATTR, summaryFingerprint);
            summaryLabel.replaceChildren();
            const base = document.createElement('span');
            base.className = 'theia-mobile-agent-activity-timeline-summary-base';
            base.textContent = summaryText;
            summaryLabel.append(base);
            if (policy.collapsed && policy.hiddenCount > 0) {
                const reveal = document.createElement('button');
                reveal.type = 'button';
                reveal.className = 'theia-mobile-agent-activity-timeline-reveal-steps';
                reveal.textContent = nls.localize(
                    'qaap/mobileProjects/transcriptActivityRevealHiddenSteps',
                    ' · {0} earlier steps',
                    String(policy.hiddenCount),
                );
                reveal.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    markTranscriptTimelineRevealAll(timeline);
                    transcriptActivityTimelineResync.get(timeline)?.();
                });
                summaryLabel.append(reveal);
            }
        }
        ctx.bindTranscriptActivityTimelineStickyBar(timeline);
        const backendStreaming = !!options?.conv && options.conv.status === 'streaming';
        ctx.syncTranscriptSummaryIcons(timeline, !!options?.streaming || backendStreaming);
}

export function syncTranscriptSummaryIconsExtracted(ctx: any, timeline: HTMLElement, streaming: boolean): void {
        const icons = timeline.querySelectorAll<HTMLElement>(
            '.theia-mobile-agent-activity-timeline-summary-icon',
        );
        for (const icon of icons) {
            const existingSpinner = transcriptSummarySpinners.get(icon);
            if (streaming) {
                if (!existingSpinner) {
                    const spinner = createThinkingOrbIndicator({
                        activityKind: 'planning',
                        isWorking: true,
                        className: 'theia-mobile-agent-activity-timeline-summary-spinner',
                    });
                    icon.classList.add('theia-mod-spinner-active');
                    icon.append(spinner);
                    transcriptSummarySpinners.set(icon, spinner);
                }
            } else {
                if (existingSpinner) {
                    destroyThinkingOrbIndicator(existingSpinner);
                    existingSpinner.remove();
                    transcriptSummarySpinners.delete(icon);
                    icon.classList.remove('theia-mod-spinner-active');
                }
            }
        }
}

export function bindTranscriptActivityTimelineToggleExtracted(ctx: any, timeline: HTMLDetailsElement): void {
        if (timeline.dataset.transcriptTimelineToggleBound === '1') {
            return;
        }
        timeline.dataset.transcriptTimelineToggleBound = '1';
        timeline.addEventListener('toggle', () => {
            if (timeline.dataset.transcriptTimelineProgrammaticToggle === '1') {
                delete timeline.dataset.transcriptTimelineProgrammaticToggle;
                return;
            }
            timeline.dataset.transcriptTimelineUserToggled = '1';
        });
}

export function bindTranscriptActivityTimelineStickyBarExtracted(ctx: any, timeline: HTMLDetailsElement): void {
        if (timeline.dataset.transcriptTimelineStickyBarBound === '1') {
            return;
        }
        const stickyBar = timeline.querySelector('.theia-mobile-agent-activity-timeline-sticky-bar');
        if (!(stickyBar instanceof HTMLButtonElement)) {
            return;
        }
        timeline.dataset.transcriptTimelineStickyBarBound = '1';
        stickyBar.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            timeline.open = false;
        });
}

export function bindTranscriptActivityTimelineGapHandlersExtracted(ctx: any, timeline: HTMLElement): void {
        if (timeline.dataset.transcriptTimelineGapBound === '1') {
            return;
        }
        timeline.dataset.transcriptTimelineGapBound = '1';
        timeline.addEventListener('click', event => ctx.handleTranscriptActivityTimelineGapClick(event));
        timeline.addEventListener('keydown', event => ctx.handleTranscriptActivityTimelineGapKeydown(event));
}

export function handleTranscriptActivityTimelineGapClickExtracted(ctx: any, event: Event): void {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const gap = target.closest('.theia-mod-history-gap');
        if (!(gap instanceof HTMLElement)) {
            return;
        }
        const position = gap.getAttribute(TRANSCRIPT_TIMELINE_GAP_POSITION_ATTR);
        if (position !== 'before' && position !== 'after') {
            return;
        }
        const timeline = gap.closest<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        if (!timeline) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        markTranscriptTimelineGapExpanded(timeline, position);
        transcriptActivityTimelineResync.get(timeline)?.();
}

export function handleTranscriptActivityTimelineGapKeydownExtracted(ctx: any, event: KeyboardEvent): void {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        if (!target.closest('.theia-mod-history-gap')) {
            return;
        }
        event.preventDefault();
        target.closest('.theia-mod-history-gap')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

export function clearPinnedTranscriptStreamFooterExtracted(ctx: any, chatHost?: HTMLElement): void {
        ctx.pinnedLiveStatusPeakTokens = 0;
        const host = chatHost
            ?? ctx.host.transcriptChatHost
            ?? document.querySelector<HTMLElement>(`.theia-mobile-agent-transcript-real-chat`);
        if (!(host instanceof HTMLElement)) {
            return;
        }
        const scroller = resolveTranscriptScroller(host);
        if (scroller) {
            ctx.removeTranscriptLiveStatusWithOrb(scroller);
        }
        clearLegacyTranscriptStreamFooterHost(host);
}

export function ensureAndSyncTranscriptLiveStatusFooterExtracted(ctx: any, segmentsBody: HTMLElement,
        _segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        options?: { readonly streaming?: boolean; readonly stalled?: boolean; readonly timedOut?: boolean },): void {
        // Never mount into segmentsBody — off-DOM row builds cannot resolve real-chat via
        // closest(), and a nested copy is what flickered. Canonical host is the scroller tail.
        ctx.removeTranscriptLiveStatusWithOrb(segmentsBody);
        if (!conv) {
            const chatHost = ctx.resolveTranscriptLiveStatusChatHost(
                resolveTranscriptChatHostFromNode(segmentsBody),
            );
            ctx.clearPinnedTranscriptStreamFooter(chatHost);
            return;
        }
        ctx.ensurePinnedTranscriptLiveStatus(conv, {
            stalled: options?.stalled,
            timedOut: options?.timedOut,
            chatHost: resolveTranscriptChatHostFromNode(segmentsBody),
        });
}

export function syncTranscriptTraceStatusExtracted(ctx: any, row: HTMLElement | null,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions,): void {
        if (!row) {
            return;
        }
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (!(segmentsBody instanceof HTMLElement)) {
            return;
        }
        if (!options?.streaming) {
            ctx.removeTranscriptLiveStatusWithOrb(segmentsBody);
            if (options?.conv && ctx.shouldShowPinnedTranscriptLiveStatus(options.conv)) {
                ctx.ensurePinnedTranscriptLiveStatus(options.conv, { stalled: options?.stalled });
            } else {
                ctx.clearPinnedTranscriptStreamFooter(resolveTranscriptChatHostFromNode(segmentsBody));
            }
            const status = row.querySelector<HTMLElement>(`[${TRANSCRIPT_TRACE_STATUS_ATTR}]`);
            if (status) {
                status.hidden = true;
                status.textContent = '';
            }
            return;
        }
        ctx.ensureAndSyncTranscriptLiveStatusFooter(segmentsBody, segments, options.conv, {
            streaming: true,
            stalled: options?.stalled,
        });
        row.querySelector<HTMLElement>(`[${TRANSCRIPT_TRACE_STATUS_ATTR}]`)?.remove();
}

export function syncTranscriptActivityHistoryGapExtracted(ctx: any, li: HTMLElement,
        hiddenCount: number,
        position: 'before' | 'after',): void {
        syncTranscriptActivityHistoryGapHelper(li, hiddenCount, position);
}

export function appendStreamingAgentTextSegmentExtracted(ctx: any, row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        const segmentIndex = nextSegments.length - 1;
        const segment = nextSegments[segmentIndex];
        if (!segment || segment.type !== 'text') {
            return false;
        }
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return false;
        }
        // Codex-style execution event timeline: render the text block as a
        // rich content element after the timeline (the agent's final answer),
        // and rebuild the timeline to update its state.
        if (hasMobileExecutionEventTimeline(row)) {
            if (segmentsBody.querySelector(`[${TRANSCRIPT_SEGMENT_INDEX_ATTR}="${segmentIndex}"]`)) {
                return false;
            }
            // Only render as a separate block if it's after the last tool
            // (i.e. the agent's final answer, not process prose).
            const lastToolIndex = nextSegments.reduce(
                (last, seg, idx) => seg.type === 'tool' ? idx : last,
                -1,
            );
            if (segmentIndex > lastToolIndex && !ctx.isLobeWorkflowProcessText(segment.content)) {
                // Repeated tool failures / retries can stream the same
                // "error" trace-event text more than once — check this new
                // tail segment against everything already rendered (and
                // against `msg.error`, shown by the failure dialog) so a
                // duplicate never gets its own block, matching the dedup a
                // full render applies (see renderMobileExecutionEventTimeline).
                const text = segment.content?.trim() ?? '';
                const seenClosingNarrativeTexts = ctx.collectMobileClosingNarrativeTextsBefore(nextSegments, lastToolIndex, segmentIndex);
                const error = ctx.resolveLastAgentMessageError(conv);
                const normalizedFailureReason = error?.trim() ? normalizeMobileClosingNarrativeText(error) : undefined;
                // `conv.status` is typically still `'streaming'` at this point
                // even when this tail segment is itself an error narrative —
                // the conversation only flips to `'failed'` once the turn
                // settles. Without this, an error segment would render as
                // plain unstyled text during streaming and only pick up the
                // styled error card on the next full render/finalize. Treat a
                // text segment matching the error prefix as error-like right
                // away; `resolveMobileClosingNarrativeAction` re-checks the
                // same prefix regex before actually choosing the card, so this
                // cannot turn an unrelated narrative into a false error card.
                const isErrorLikely = ctx.isConversationError(conv) || MOBILE_CLOSING_TEXT_ERROR_PREFIX.test(text);
                const action = ctx.resolveMobileClosingNarrativeAction(
                    text, seenClosingNarrativeTexts, normalizedFailureReason, isErrorLikely,
                );
                if (action.kind !== 'skip') {
                    const streaming = row.classList.contains('theia-mod-streaming');
                    const el = action.kind === 'error-card'
                        ? createMobileClosingErrorCardElement(action.message, ctx.resolveMobileClosingErrorCardRetry())
                        : ctx.toolUi.createTranscriptSegmentDetails(segment);
                    el.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
                    if (action.kind === 'text' && streaming) {
                        ctx.toolUi.renderTranscriptRichContent(el, segment.content ?? '', { streaming });
                    }
                    // Insert after the timeline but before any diff summary.
                    const footerAnchor = resolveTranscriptSegmentsFooterAnchor(segmentsBody);
                    if (footerAnchor) {
                        segmentsBody.insertBefore(el, footerAnchor);
                    } else {
                        segmentsBody.append(el);
                    }
                }
            }
            ctx.skipExecutionTimelineRefresh(row);
            return true;
        }
        const activityTimelineShown = !!segmentsBody.querySelector(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        if (!ctx.shouldRenderLobeTextSegment(nextSegments, segmentIndex, activityTimelineShown)) {
            ctx.patchStreamingActivityTimeline(row, nextSegments, conv);
            return true;
        }
        if (segmentsBody.querySelector(`[${TRANSCRIPT_SEGMENT_INDEX_ATTR}="${segmentIndex}"]`)) {
            return false;
        }
        const textBlock = ctx.toolUi.createTranscriptSegmentDetails(segment);
        textBlock.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
        const streaming = row.classList.contains('theia-mod-streaming');
        if (streaming) {
            ctx.toolUi.renderTranscriptRichContent(textBlock, segment.content ?? '', { streaming });
        }
        const artifacts = segmentsBody.querySelector('.theia-mobile-agent-transcript-artifacts');
        if (artifacts) {
            segmentsBody.insertBefore(textBlock, artifacts);
        } else {
            segmentsBody.append(textBlock);
        }
        ctx.patchStreamingActivityTimeline(row, nextSegments, conv);
        return true;
}

export function appendStreamingAgentToolSegmentExtracted(ctx: any, row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,): boolean {
        const segment = nextSegments[nextSegments.length - 1];
        if (!segment || segment.type !== 'tool') {
            return false;
        }
        if (row.classList.contains('theia-mod-streaming')) {
            return ctx.patchStreamingActivityTimeline(row, nextSegments, conv);
        }
        // Non-streaming row: if it doesn't have the Codex-style timeline yet
        // (e.g. it was created during thinking and settled without tools, then
        // a late tool arrived), upgrade it to the Codex-style timeline.
        if (!hasMobileExecutionEventTimeline(row)) {
            ctx.upgradeToMobileExecutionEventTimeline(row, nextSegments, { streaming: false, conv });
            return true;
        }
        // Non-streaming row that already has the Codex-style timeline: rebuild
        // it in place to reflect the newly appended tool. Without this branch,
        // the method would fall through to the legacy path and create legacy
        // tool pills (.theia-mobile-agent-tool-pills) alongside the Codex
        // timeline, leaving corrupted DOM.
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (segmentsBody) {
            refreshMobileExecutionEventTimeline(segmentsBody, nextSegments);
        }
        return true;
}

