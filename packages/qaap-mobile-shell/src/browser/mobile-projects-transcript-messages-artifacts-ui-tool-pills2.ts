// @ts-nocheck
import { transcriptActivityTimelineResync, transcriptLiveStatusTickerBound } from './mobile-projects-transcript-messages-artifacts-ui-constants';
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

export function ensurePinnedTranscriptLiveStatusExtracted(ctx: any, conv: QaapAgentConversationDTO,
    options?: { readonly stalled?: boolean; readonly timedOut?: boolean; readonly chatHost?: HTMLElement },): void {
    const chatHost = ctx.resolveTranscriptLiveStatusChatHost(options?.chatHost);
    if (!chatHost) {
        return;
    }
    // Drop off-DOM-build leftovers nested inside rows/segments (not the scroller tail).
    removeNestedTranscriptLiveStatusCopies(chatHost);

    const wantVisible = ctx.shouldShowPinnedTranscriptLiveStatus(conv);
    if (wantVisible) {
        const turnKey = `${conv.id}:${resolveTranscriptTurnStartMs(conv.messages) ?? conv.createdAt}`;
        if (ctx.pinnedLiveStatusTurnKey !== turnKey) {
            ctx.pinnedLiveStatusPeakTokens = 0;
            ctx.pinnedLiveStatusTurnKey = turnKey;
        }
        ctx.pinnedLiveStatusConvId = conv.id;
        ctx.pinnedLiveStatusHoldUntil = Date.now() + 2_000;
    } else if (ctx.shouldHoldPinnedTranscriptLiveStatus(conv)) {
        // Hold the existing chrome through brief status dips — do not remount.
        return;
    } else {
        ctx.clearPinnedTranscriptStreamFooter(chatHost);
        ctx.pinnedLiveStatusConvId = undefined;
        ctx.pinnedLiveStatusHoldUntil = 0;
        ctx.pinnedLiveStatusPeakTokens = 0;
        return;
    }

    const turnStart = resolveTranscriptTurnStartMs(conv.messages) ?? conv.createdAt;
    if (turnStart === undefined) {
        return;
    }
    const scroller = resolveTranscriptScroller(chatHost);
    if (!scroller) {
        return;
    }
    let liveStatus = scroller.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_LIVE_STATUS_CLASS}`);
    if (!liveStatus) {
        // Migrate a leftover from the legacy pinned footer, if any.
        const legacyHost = chatHost.querySelector<HTMLElement>(
            `:scope > .${TRANSCRIPT_STREAM_FOOTER_HOST_CLASS}`,
        );
        liveStatus = legacyHost?.querySelector<HTMLElement>(`.${TRANSCRIPT_LIVE_STATUS_CLASS}`) ?? null;
    }
    if (!liveStatus) {
        liveStatus = createTranscriptLiveStatusElement({
            createIndicator: () => createThinkingOrbIndicator({
                setup: true,
                isWorking: true,
            }),
        });
        liveStatus.addEventListener('click', () => {
            const streamingRow = scroller.querySelector<HTMLElement>(
                '.theia-mobile-agent-transcript-msg.theia-mod-agent.theia-mod-streaming',
            );
            const accordion = streamingRow?.querySelector<HTMLDetailsElement>('.theia-mobile-process-accordion');
            if (accordion) {
                accordion.open = !accordion.open;
            }
        });
    }
    // Append once / re-tail — never replaceChildren on later ticks (that kills the orb).
    ensureTranscriptLiveStatusAtScrollerTail(chatHost, liveStatus);
    clearLegacyTranscriptStreamFooterHost(chatHost);
    const footer = liveStatus;
    const renderFooter = (): void => {
        const latestConv = ctx.host.transcriptLastConv?.id === conv.id ? ctx.host.transcriptLastConv : conv;
        if (ctx.shouldShowPinnedTranscriptLiveStatus(latestConv)) {
            ctx.pinnedLiveStatusHoldUntil = Date.now() + 2_000;
            ctx.pinnedLiveStatusConvId = latestConv.id;
        } else if (ctx.shouldHoldPinnedTranscriptLiveStatus(latestConv)) {
            return;
        } else {
            sharedSecondTicker.unregister(footer);
            transcriptLiveStatusTickerBound.delete(footer);
            ctx.clearPinnedTranscriptStreamFooter(chatHost);
            ctx.pinnedLiveStatusConvId = undefined;
            ctx.pinnedLiveStatusHoldUntil = 0;
            ctx.pinnedLiveStatusPeakTokens = 0;
            return;
        }
        const nestedLeak = chatHost.querySelector(
            `.theia-mobile-agent-transcript .theia-mobile-agent-transcript-msg .${TRANSCRIPT_LIVE_STATUS_CLASS}, `
            + `.theia-mobile-agent-transcript .theia-mobile-agent-transcript-segments .${TRANSCRIPT_LIVE_STATUS_CLASS}`,
        );
        if (nestedLeak) {
            removeNestedTranscriptLiveStatusCopies(chatHost);
        }
        if (scroller.lastElementChild !== footer) {
            ensureTranscriptLiveStatusAtScrollerTail(chatHost, footer);
        }
        const latestSegments = [...resolveTranscriptStreamingAgentSegments(latestConv)];
        const stalled = options?.stalled ?? ctx.resolveTranscriptStreamStalled(latestConv);
        const timedOut = options?.timedOut ?? ctx.resolveTranscriptStreamTimedOut(latestConv);
        const activity = resolveTranscriptStreamingActivityFromSegments(
            latestSegments as QaapAgentMessageSegmentDTO[],
            { stalled, timedOut },
        );
        const streamChars = resolveTranscriptTurnStreamChars(latestConv.messages);
        const nextTokens = resolveTranscriptLiveStatusTokenCount({
            streamChars,
            // Conversation usage may belong to the previous turn; estimate only current output.
        });
        ctx.pinnedLiveStatusPeakTokens = Math.max(ctx.pinnedLiveStatusPeakTokens, nextTokens);
        syncTranscriptLiveStatusElement(footer, {
            elapsedMs: Date.now() - turnStart,
            streamChars,
            tokenCount: ctx.pinnedLiveStatusPeakTokens,
            activityTitle: activity.title,
            activityKind: activity.kind,
            stalled,
            timedOut,
        });
        const orbHost = footer.querySelector<HTMLElement>(
            `.${TRANSCRIPT_LIVE_STATUS_LOGO_CLASS}.${QAAP_THINKING_ORB_INDICATOR_CLASS}`,
        );
        if (orbHost) {
            syncThinkingOrbIndicator(orbHost, {
                activityKind: activity.kind,
                isWorking: true,
                stalled,
                timedOut,
            });
        }
        const accordion = scroller.querySelector<HTMLDetailsElement>(
            '.theia-mobile-agent-transcript-msg.theia-mod-streaming .theia-mobile-process-accordion',
        );
        footer.classList.toggle('theia-mod-process-open', !!accordion?.open);
    };
    renderFooter();
    if (transcriptLiveStatusTickerBound.has(footer)) {
        return;
    }
    transcriptLiveStatusTickerBound.add(footer);
    sharedSecondTicker.register({
        element: footer,
        render: () => {
            if (!footer.isConnected) {
                return;
            }
            if (!isTranscriptDocumentVisible()) {
                return;
            }
            renderFooter();
        },
    });
}

export function patchStreamingThoughtBriefExtracted(ctx: any, row: HTMLElement,
    segments: readonly QaapAgentMessageSegmentDTO[],
    conv: QaapAgentConversationDTO | undefined,
    streaming: boolean,): boolean {
    const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
    if (!segmentsBody) {
        return false;
    }
    // Keep the standalone turn-provenance badge in sync on every tick for
    // no-tool rows. Tool rows sync the same badge from syncRowProcessAccordion.
    if (!hasMobileExecutionEventTimeline(row)) {
        const message = ctx.resolveTranscriptRowAgentMessage(row, conv);
        const provenance = ctx.resolveTurnProvenance(conv, message);
        syncTranscriptStandaloneTurnProvenance(segmentsBody, provenance.turnAgentId, provenance.turnAgentModel);
    }
    const thinking = resolveTranscriptThinkingContent([...segments]);
    const stats = resolveTranscriptActivityStats([...segments]);
    const hasStats = hasTranscriptActivityStats(stats);
    const turnStartMs = conv ? resolveTranscriptTurnStartMs(conv.messages) : undefined;
    const backendActive = ctx.isConversationWorking(conv, streaming);
    const showBrief = shouldShowTranscriptThoughtBrief(segments, backendActive, {
        turnElapsedMs: resolveTranscriptTurnElapsedMs(turnStartMs),
        userPromptChars: conv ? resolveLastUserPromptChars(conv.messages) : undefined,
        hasActivityStats: hasStats,
        thinkingContent: thinking,
    });
    let brief = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_THOUGHT_BRIEF_ATTR}]`);
    if (!showBrief) {
        if (brief) {
            brief.hidden = true;
        }
        return true;
    }
    const thinkingActive = isTranscriptAgentThinkingPhase(segments, backendActive);
    if (!thinking && !hasStats && !thinkingActive) {
        if (brief) {
            brief.hidden = true;
        }
        return true;
    }
    if (!brief) {
        const created = ctx.createTranscriptThoughtBriefBlock([...segments], { streaming, conv });
        if (!created) {
            return false;
        }
        segmentsBody.prepend(created);
        brief = created;
    }
    brief.hidden = false;
    ctx.syncTranscriptThoughtBriefElement(brief, segments, { streaming, conv });
    return true;
}

export function syncTranscriptThoughtBriefElementExtracted(ctx: any, block: HTMLElement,
    segments: readonly QaapAgentMessageSegmentDTO[],
    options: { readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO },): void {
    syncTranscriptThoughtBriefElementHelper(block, segments, options, {
        isConversationFinalResponseCommitted: (c, s) => ctx.isConversationFinalResponseCommitted(c, s),
        isConversationWorking: (c, s) => ctx.isConversationWorking(c, s),
        syncTranscriptThoughtBriefIcon: (i, a) => ctx.syncTranscriptThoughtBriefIcon(i, a),
        refreshTranscriptThoughtBriefTitle: (t, b, o) => ctx.refreshTranscriptThoughtBriefTitle(t, b, o),
    });
}

export function refreshTranscriptThoughtBriefTitleExtracted(ctx: any, title: HTMLElement,
    block: HTMLElement,
    options: {
        readonly thinking: string | undefined;
        readonly thinkingActive: boolean;
        readonly streaming: boolean;
        readonly turnStartMs: number | undefined;
        readonly segments?: readonly QaapAgentMessageSegmentDTO[];
    },): void {
    refreshTranscriptThoughtBriefTitleHelper(title, block, options, {
        refreshTranscriptThoughtBriefTitle: (t, b, o) => ctx.refreshTranscriptThoughtBriefTitle(t, b, o),
    });
}

export function syncTranscriptActivityTimelineElementExtracted(ctx: any, timeline: HTMLElement,
    items: readonly TranscriptActivityTimelineItem[],
    options?: TranscriptActivityTimelineOptions,): void {
    const expandState = readTranscriptTimelineExpandState(timeline);
    const timelineExpanded = timeline instanceof HTMLDetailsElement ? timeline.open : false;
    const policy = resolveTranscriptTimelineVisibilityPolicy(items, {
        maxVisibleItems: options?.maxVisibleItems,
        revealAll: expandState.revealAll || timelineExpanded,
    });
    const visibleItems = policy.visibleItems;
    const activeIndex = visibleItems.findIndex(item => isTranscriptActivityLiveState(item.state));
    const segments = options?.segments ?? [];
    const cursorTrace = timeline.classList.contains('theia-mod-cursor-trace');
    if (timeline instanceof HTMLDetailsElement) {
        ctx.ensureLobeTranscriptWorkflowClasses(timeline);
        const autoExpanded = options?.expanded
            ?? shouldExpandTranscriptInlineTimeline(segments, false);
        ctx.bindTranscriptActivityTimelineToggle(timeline);
        const expanded = timeline.dataset.transcriptTimelineUserToggled === '1'
            ? timeline.open
            : autoExpanded;
        if (!timeline.dataset.transcriptTimelineUserToggled && timeline.open !== autoExpanded) {
            timeline.dataset.transcriptTimelineProgrammaticToggle = '1';
            timeline.open = autoExpanded;
        }
        timeline.classList.toggle('theia-mod-collapsed-history', policy.collapsed);
        timeline.classList.toggle('theia-mod-stalled', !!options?.stalled);
        const backendStreaming = !!options?.streaming || (!!options?.conv && options.conv.status === 'streaming');
        timeline.classList.toggle('theia-mod-streaming', backendStreaming);
        ctx.syncTranscriptActivityTimelineSummaryElement(timeline, segments, visibleItems, policy, options);
        timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-count')
            .forEach(count => count.textContent = String(visibleItems.filter(item => !isTranscriptExecutionTimelineNarrative(item)).length));
        const visualIdle = ctx.resolveTranscriptStreamVisualIdle(segments, !!options?.streaming);
        timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-label').forEach(label => {
            label.classList.toggle('theia-mod-shimmer', !!options?.streaming && !options?.stalled && !options?.timedOut && !visualIdle);
            label.classList.toggle('theia-mod-stall', !!options?.stalled);
        });
        const stickyBar = timeline.querySelector<HTMLElement>('.theia-mobile-agent-activity-timeline-sticky-bar');
        stickyBar?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    } else {
        const backendStreamingElse = !!options?.streaming || (!!options?.conv && options.conv.status === 'streaming');
        timeline.classList.toggle('theia-mod-streaming', backendStreamingElse);
        const count = timeline.querySelector('.theia-mobile-agent-premium-head-count');
        if (count) {
            count.textContent = String(visibleItems.filter(item => !isTranscriptExecutionTimelineNarrative(item)).length);
        }
    }
    const list = timeline.querySelector('.theia-mobile-agent-activity-list');
    if (!list) {
        return;
    }
    if (list instanceof HTMLOListElement) {
        bindTranscriptActivityListKeyboard(list);
    }
    ctx.bindTranscriptActivityTimelineGapHandlers(timeline);
    const ownerRow = timeline.closest<HTMLElement>('.theia-mobile-agent-transcript-msg');
    if (list instanceof HTMLElement && ownerRow) {
        ctx.bindTranscriptActivityListActions(list, ownerRow);
    }
    const timelineOptionsWithTrace = { ...options, cursorTrace };
    const focusIndex = activeIndex >= 0 ? activeIndex : visibleItems.length - 1;
    const shouldVirtualizeTimeline = visibleItems.length > TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD
        && !!options?.cursorTrace;
    const renderWindow = resolveTranscriptTimelineRenderWindowWithExpand(visibleItems.length, {
        focusIndex,
        enabled: shouldVirtualizeTimeline,
        expand: expandState,
    });
    list.classList.toggle('theia-mod-virtualized', renderWindow.virtualized);
    const renderedItems = visibleItems.slice(renderWindow.start, renderWindow.end);
    const renderedActiveIndex = renderedItems.findIndex(
        (_, index) => renderWindow.start + index === activeIndex,
    );
    const syncFingerprint = fingerprintTranscriptTimelineSync(
        visibleItems,
        activeIndex,
        renderWindow,
        expandState,
        {
            stalled: options?.stalled,
            expanded: timeline instanceof HTMLDetailsElement ? timeline.open : undefined,
            collapsed: policy.collapsed,
            hiddenCount: policy.hiddenCount,
        },
    );
    const previousFingerprint = timeline.getAttribute(TRANSCRIPT_TIMELINE_SYNC_FP_ATTR);
    if (previousFingerprint === syncFingerprint) {
        recordTranscriptRenderMetric('timeline_sync_skipped');
        transcriptActivityTimelineResync.set(timeline, () => {
            ctx.syncTranscriptActivityTimelineElement(timeline, items, options);
        });
        return;
    }
    timeline.setAttribute(TRANSCRIPT_TIMELINE_SYNC_FP_ATTR, syncFingerprint);
    recordTranscriptRenderMetric('timeline_sync');
    const slots: Array<
        | { readonly kind: 'gap'; readonly count: number; readonly position: 'before' | 'after' }
        | {
            readonly kind: 'item';
            readonly item: TranscriptActivityTimelineItem;
            readonly isActive: boolean;
            readonly absoluteIndex: number;
            readonly tier: ReturnType<typeof resolveTranscriptTimelineItemTier>;
        }
    > = [];
    if (renderWindow.hiddenBefore > 0) {
        slots.push({ kind: 'gap', count: renderWindow.hiddenBefore, position: 'before' });
    }
    renderedItems.forEach((item, index) => {
        const absoluteIndex = renderWindow.start + index;
        slots.push({
            kind: 'item',
            item,
            isActive: index === renderedActiveIndex,
            absoluteIndex,
            tier: resolveTranscriptTimelineItemTier(absoluteIndex, focusIndex, visibleItems.length),
        });
    });
    if (renderWindow.hiddenAfter > 0) {
        slots.push({ kind: 'gap', count: renderWindow.hiddenAfter, position: 'after' });
    }
    const subagentCardChildIndexes = new Set<number>();
    for (const model of resolveTranscriptSubagentCardModels(visibleItems)) {
        for (const childIndex of model.childIndexes) {
            subagentCardChildIndexes.add(childIndex);
        }
    }
    const existing = [...list.querySelectorAll<HTMLElement>(':scope > li')];
    slots.forEach((slot, index) => {
        let li = existing[index];
        if (!li) {
            li = document.createElement('li');
            li.classList.add('theia-mod-enter');
            li.addEventListener('animationend', () => li.classList.remove('theia-mod-enter'), { once: true });
            list.append(li);
        }
        if (slot.kind === 'gap') {
            ctx.syncTranscriptActivityHistoryGap(li, slot.count, slot.position);
            return;
        }
        ctx.syncTranscriptActivityItemElement(
            li,
            slot.item,
            slot.isActive,
            timelineOptionsWithTrace,
            cursorTrace ? 'recent' : slot.tier,
            subagentCardChildIndexes.has(slot.absoluteIndex),
        );
        if (ownerRow) {
            ctx.attachTranscriptActivityItemAction(li, slot.item, ownerRow);
        }
    });
    while (list.children.length > slots.length) {
        list.lastElementChild?.remove();
    }
    ctx.syncTranscriptTraceStatus(ownerRow, segments, {
        ...options,
        streaming: options?.streaming,
        conv: options?.conv,
        cursorTrace: timeline.classList.contains('theia-mod-cursor-trace'),
    });
    transcriptActivityTimelineResync.set(timeline, () => {
        ctx.syncTranscriptActivityTimelineElement(timeline, items, options);
    });
}

