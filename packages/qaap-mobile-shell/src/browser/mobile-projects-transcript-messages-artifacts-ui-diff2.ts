// @ts-nocheck
import { lazyTranscriptToolPillBodies } from './mobile-projects-transcript-messages-artifacts-ui-constants';
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

export function createTranscriptToolPillExtracted(ctx: any, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },): HTMLDetailsElement {
        const manualApproval = !!conv && conversationUsesInteractiveApprovals(conv);
        const descriptors = resolveTranscriptToolPillDescriptors([segment], {
            resolvePath: args => ctx.resolversUi.extractTranscriptToolFullPath(args),
        });
        const descriptor = descriptors[0];
        const kind = descriptor?.kind ?? ctx.resolversUi.resolveTranscriptToolKind(segment.name);
        const pill = document.createElement('details');
        pill.className = `theia-mobile-agent-tool-pill theia-mod-${kind}`;
        pill.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, segment.toolUseId);
        pill.classList.toggle('theia-mod-running', !(descriptor?.finished ?? segment.finished));
        pill.classList.toggle('theia-mod-done', descriptor?.finished ?? segment.finished);
        pill.classList.toggle('theia-mod-failed', descriptor?.resultFailed ?? false);
        const pendingApproval = manualApproval
            && isPendingTranscriptToolSegment(segment)
            && ctx.host.transcriptLiveUi.hasPendingTranscriptToolApproval(conv!.id, segment.toolUseId);
        pill.classList.toggle('theia-mod-awaiting-approval', pendingApproval);
        const finished = descriptor?.finished ?? segment.finished;
        const failed = descriptor?.resultFailed ?? false;
        pill.open = shouldOpenTranscriptToolDetails({
            finished,
            resultFailed: failed,
        });
        const todoChecklist = isTranscriptTodoTool(segment.name) && !!parseTranscriptTodoChecklist(segment.args);
        if (todoChecklist) {
            // The live task checklist stays visible, Claude-Code-style.
            pill.open = true;
        }
        if (kind === 'terminal' && (!finished || !!segment.result?.trim())) {
            pill.open = true;
        }
        const rowParts = ctx.resolveToolRowParts(segment, kind);
        pill.append(ctx.toolUi.createTranscriptToolPillSummary({
            kind,
            verb: rowParts.verb,
            label: rowParts.detail,
            finished,
            failed,
            mcpServer: kind === 'mcp' ? extractTranscriptMcpServerLabel(segment.args) : undefined,
            startedAt: segment.startedAt,
            copyFrom: segment.result?.trim()
                ? () => ctx.resolversUi.formatTranscriptToolResult(segment.result!)
                : undefined,
        }));
        if (ctx.resolversUi.isTranscriptPureReadTool(segment.name)
            && !ctx.resolversUi.shouldShowTranscriptToolResultBody(segment, kind)) {
            return pill;
        }
        const lazyBody = ctx.shouldLazyHydrateTranscriptToolPillBody({
            segment,
            finished,
            failed,
            pendingApproval,
            todoChecklist: !!todoChecklist,
            deferHeavyContent: !!options?.deferHeavyContent,
            open: pill.open,
        });
        if (lazyBody) {
            lazyTranscriptToolPillBodies.set(pill, {
                segment,
                conv,
                kind,
                finished,
                resultFailed: failed,
            });
            ctx.attachLazyTranscriptToolPillHydration(pill);
            return pill;
        }
        pill.append(ctx.buildTranscriptToolPillBody(segment, conv, kind, {
            pendingApproval,
            finished,
            todoChecklist: !!todoChecklist,
        }));
        return pill;
}

export function shouldLazyHydrateTranscriptToolPillBodyExtracted(ctx: any, options: {
        readonly segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
        readonly finished: boolean;
        readonly failed: boolean;
        readonly pendingApproval: boolean;
        readonly todoChecklist: boolean;
        readonly deferHeavyContent: boolean;
        readonly open: boolean;
    }): boolean {
        if (options.pendingApproval || options.todoChecklist || options.failed) {
            return false;
        }
        if (!options.finished || options.open) {
            return false;
        }
        if (!options.segment.result?.trim()) {
            return false;
        }
        return true;
}

export function attachLazyTranscriptToolPillHydrationExtracted(ctx: any, pill: HTMLDetailsElement): void {
        if (pill.dataset.transcriptLazyToolBound === '1') {
            return;
        }
        pill.dataset.transcriptLazyToolBound = '1';
        pill.addEventListener('toggle', () => {
            if (!pill.open || pill.querySelector('.theia-mobile-agent-tool-pill-body')) {
                return;
            }
            const payload = lazyTranscriptToolPillBodies.get(pill);
            if (!payload) {
                return;
            }
            lazyTranscriptToolPillBodies.delete(pill);
            pill.append(ctx.buildTranscriptToolPillBody(payload.segment, payload.conv, payload.kind, {
                pendingApproval: false,
                finished: payload.finished,
                todoChecklist: false,
            }));
        });
}

export function buildTranscriptToolPillBodyExtracted(ctx: any, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv: QaapAgentConversationDTO | undefined,
        kind: string,
        options: {
            readonly pendingApproval: boolean;
            readonly finished: boolean;
            readonly todoChecklist: boolean;
        },): HTMLElement {
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-tool-pill-body';
        if (options.pendingApproval && conv) {
            body.append(ctx.createTranscriptToolApprovalActions(conv.id, segment));
        }
        const richPayload = resolveTranscriptToolUiPayloadFromSegment(segment.name, segment.args, segment.result);
        if (richPayload && !segment.result?.trim()) {
            body.append(buildTranscriptToolUiPayloadElement(richPayload));
        }
        if (segment.result?.trim() || options.todoChecklist) {
            body.append(ctx.toolUi.createTranscriptToolResultBody(
                segment,
                kind,
                { streaming: !options.finished },
            ));
        } else if (!options.finished) {
            ctx.toolUi.ensureTranscriptToolSpeculativePlaceholder(body, segment);
        }
        return body;
}

export function createTranscriptToolApprovalActionsExtracted(ctx: any, conversationId: string,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): HTMLElement {
        const pending = ctx.host.transcriptLiveUi.getPendingTranscriptToolApproval(conversationId, segment.toolUseId);
        const onSettled = (): void => {
            void ctx.host.transcriptLiveUi.refreshTranscriptApprovals();
            ctx.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
        };
        const pendingSummary = pending?.summary?.trim();
        return buildTranscriptApprovalCard({
            surface: 'pill',
            title: nls.localize(
                'qaap/mobileProjects/transcriptToolApprovalTitle',
                'Allow {0}?',
                segment.name,
            ),
            description: pendingSummary
                ? `${pendingSummary}\n${nls.localize(
                    'qaap/mobileProjects/transcriptToolApprovalComposerHint',
                    'Prefer the Allow button above the composer if this one does not respond.',
                )}`
                : nls.localize(
                    'qaap/mobileProjects/transcriptToolApprovalComposerHint',
                    'Prefer the Allow button above the composer if this one does not respond.',
                ),
        }, {
            onApprove: event => {
                if (!pending) {
                    return;
                }
                void respondToTranscriptApproval(pending.id, 'approve', { fromEvent: event, callbacks: { onSettled } });
            },
            onReject: event => {
                if (!pending) {
                    return;
                }
                void respondToTranscriptApproval(pending.id, 'reject', { fromEvent: event, callbacks: { onSettled } });
            },
        });
}

export function formatTranscriptActivityMetaExtracted(ctx: any, stats: QaapTranscriptActivityStats): string {
        const parts: string[] = [];
        if (stats.fileReads > 0) {
            parts.push(stats.fileReads === 1
                ? nls.localize('qaap/mobileProjects/transcriptMetaOneFile', '1 file')
                : nls.localize('qaap/mobileProjects/transcriptMetaFiles', '{0} files', String(stats.fileReads)));
        }
        if (stats.searches > 0) {
            parts.push(stats.searches === 1
                ? nls.localize('qaap/mobileProjects/transcriptMetaOneSearch', '1 search')
                : nls.localize('qaap/mobileProjects/transcriptMetaSearches', '{0} searches', String(stats.searches)));
        }
        if (stats.shells > 0) {
            parts.push(stats.shells === 1
                ? nls.localize('qaap/mobileProjects/transcriptMetaRanOneCommand', 'ran 1 command')
                : nls.localize('qaap/mobileProjects/transcriptMetaRanCommands', 'ran {0} commands', String(stats.shells)));
        }
        if (stats.edits > 0) {
            parts.push(stats.edits === 1
                ? nls.localize('qaap/mobileProjects/transcriptMetaOneEdit', '1 edit')
                : nls.localize('qaap/mobileProjects/transcriptMetaEdits', '{0} edits', String(stats.edits)));
        }
        if (stats.otherTools > 0) {
            parts.push(stats.otherTools === 1
                ? nls.localize('qaap/mobileProjects/transcriptMetaOneTool', '1 tool')
                : nls.localize('qaap/mobileProjects/transcriptMetaTools', '{0} tools', String(stats.otherTools)));
        }
        return nls.localize('qaap/mobileProjects/transcriptThoughtMeta', 'Explored {0}', parts.join(', '));
}

export function resolveTranscriptActivityTimelineSummaryExtracted(ctx: any, segments: readonly QaapAgentMessageSegmentDTO[],
        hiddenCount = 0,
        options?: { readonly streaming?: boolean; readonly row?: HTMLElement },): string {
        return resolveTranscriptActivityTimelineSummaryText(hiddenCount, {
            streaming: options?.streaming,
            durationMs: ctx.resolveTranscriptTurnDurationMs(segments, options?.row),
        });
}

export function resolveTranscriptTurnDurationMsExtracted(ctx: any, segments: readonly QaapAgentMessageSegmentDTO[],
        row: HTMLElement | undefined,): number | undefined {
        const messageId = row?.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
        return messageId
            ? ctx.activityTiming.resolveTurnDurationMs(messageId, segments)
            : undefined;
}

export function createTranscriptActivityTimelineExtracted(ctx: any, segments: QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions & { readonly includeThinkingSteps?: boolean },): HTMLElement | undefined {
        const variant = options?.variant ?? 'inline';
        const includeThinkingSteps = options?.includeThinkingSteps ?? (variant === 'inline' || variant === 'plan');
        const items = ctx.resolveTranscriptActivityItemsForDisplay(segments, {
            stalled: options?.stalled,
            includeThinkingSteps,
            row: options?.row,
            conv: options?.conv,
            streaming: options?.streaming,
        });
        if (items.length === 0) {
            return undefined;
        }
        const timelineItems = buildTranscriptExecutionTimelineItems(items);
        const timelineOptions = { ...options, segments, includeThinkingSteps, cursorTrace: true };

        if (variant === 'inline') {
            const timeline = document.createElement('details');
            timeline.className = 'theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible theia-mod-cursor-trace theia-mobile-agent-lobe-workflow';
            timeline.setAttribute(TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, 'true');
            timeline.setAttribute(
                'aria-label',
                nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity'),
            );
            timeline.setAttribute('aria-atomic', 'true');
            timeline.setAttribute('role', 'log');
            timeline.classList.toggle('theia-mod-stalled', !!options?.stalled);
            timeline.open = false;

            const summary = document.createElement('summary');
            summary.className = 'theia-mobile-agent-activity-timeline-summary theia-mobile-agent-lobe-workflow-summary';
            const summaryIcon = document.createElement('span');
            summaryIcon.className = 'theia-mobile-agent-trace-glyph theia-mobile-agent-activity-timeline-summary-icon';
            summaryIcon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-activity-timeline-summary-label';
            label.textContent = ctx.resolveTranscriptActivityTimelineSummary(segments, 0, {
                streaming: !!options?.streaming,
                row: options?.row,
            });
            const count = document.createElement('span');
            count.className = 'theia-mobile-agent-activity-timeline-summary-count';
            count.textContent = String(timelineItems.filter(item => !isTranscriptExecutionTimelineNarrative(item)).length);
            const chevron = document.createElement('span');
            chevron.className = 'theia-mobile-agent-activity-timeline-summary-chevron theia-mobile-agent-lobe-workflow-toggle codicon codicon-chevron-down';
            chevron.setAttribute('aria-hidden', 'true');
            summary.append(summaryIcon, label, count, chevron);
            const openPanel = document.createElement('div');
            openPanel.className = 'theia-mobile-agent-activity-timeline-open-panel';
            const stickyBar = document.createElement('button');
            stickyBar.type = 'button';
            stickyBar.className = 'theia-mobile-agent-activity-timeline-sticky-bar theia-mobile-agent-lobe-workflow-summary';
            stickyBar.setAttribute('aria-expanded', 'true');
            const stickyIcon = document.createElement('span');
            stickyIcon.className = 'theia-mobile-agent-trace-glyph theia-mobile-agent-activity-timeline-summary-icon';
            stickyIcon.setAttribute('aria-hidden', 'true');
            const stickyLabel = document.createElement('span');
            stickyLabel.className = 'theia-mobile-agent-activity-timeline-summary-label';
            const stickyCount = document.createElement('span');
            stickyCount.className = 'theia-mobile-agent-activity-timeline-summary-count';
            const stickyChevron = document.createElement('span');
            stickyChevron.className = 'theia-mobile-agent-activity-timeline-summary-chevron theia-mobile-agent-lobe-workflow-toggle codicon codicon-chevron-down';
            stickyChevron.setAttribute('aria-hidden', 'true');
            stickyBar.append(stickyIcon, stickyLabel, stickyCount, stickyChevron);
            const list = document.createElement('ol');
            list.className = 'theia-mobile-agent-activity-list';
            bindTranscriptActivityListKeyboard(list);
            openPanel.append(stickyBar, list);
            timeline.append(summary, openPanel);
            ctx.syncTranscriptActivityTimelineElement(timeline, timelineItems, timelineOptions);
            return timeline;
        }

        const timeline = document.createElement('section');
        timeline.className = `theia-mobile-agent-premium-card theia-mobile-agent-activity-timeline theia-mod-${variant}`;
        timeline.setAttribute(TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, 'true');
        timeline.setAttribute(
            'aria-label',
            nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity'),
        );
        timeline.setAttribute('aria-atomic', 'true');
        timeline.classList.toggle('theia-mod-stalled', !!options?.stalled);
        timeline.append(ctx.createTranscriptPremiumHead(
            'codicon-checklist',
            nls.localize('qaap/mobileProjects/planLabel', 'Execution plan'),
            { count: timelineItems.filter(item => !isTranscriptExecutionTimelineNarrative(item)).length, variant: 'todos' },
        ));
        const list = document.createElement('ol');
        list.className = 'theia-mobile-agent-activity-list';
        bindTranscriptActivityListKeyboard(list);
        timeline.append(list);
        ctx.syncTranscriptActivityTimelineElement(timeline, timelineItems, timelineOptions);
        return timeline;
}

