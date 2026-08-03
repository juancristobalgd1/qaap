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

export function syncTranscriptActivityRunningBadgeExtracted(ctx: any, copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        const show = isActive
            && !!options?.streaming
            && !options?.stalled
            && isTranscriptActivityLiveState(item.state);
        let badge = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-running-badge');
        if (!show) {
            badge?.remove();
            return;
        }
        if (!badge) {
            badge = ctx.toolUi.createTranscriptActivityRunningBadge();
            const anchor = copy.querySelector('.theia-mobile-agent-activity-row')
                ?? copy.querySelector('.theia-mobile-agent-activity-label');
            anchor?.after(badge);
        }
}

export function syncTranscriptActivityErrorCopyExtracted(ctx: any, copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): void {
        const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
        const raw = segment?.type === 'tool' ? segment.result : item.errorSummary;
        const display = resolveTranscriptToolErrorDisplay(raw ?? item.errorSummary);
        if (!display) {
            copy.querySelector('.theia-mobile-agent-activity-error-panel')?.remove();
            return;
        }
        let panel = copy.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-error-panel');
        const retry = item.state === 'error' ? ctx.host.retryOpenTranscriptStream : undefined;
        if (!panel) {
            panel = ctx.toolUi.createTranscriptActivityErrorPanel(display, {
                defaultOpen: false,
                onRetry: retry ? () => ctx.host.retryOpenTranscriptStream?.() : undefined,
            });
            copy.append(panel);
        } else {
            const code = panel.querySelector('.theia-mobile-agent-activity-error-panel-code');
            const preview = panel.querySelector('.theia-mobile-agent-activity-error-panel-preview');
            const message = panel.querySelector('.theia-mobile-agent-activity-error-panel-message');
            if (code) {
                code.textContent = display.code;
            }
            if (preview) {
                preview.textContent = display.preview;
            }
            if (message) {
                message.textContent = display.message;
            }
        }
        if (!panel.id) {
            panel.id = `trace-error-${item.segmentIndex ?? Math.random().toString(36).slice(2, 8)}`;
        }
        if (!panel.dataset.errorToggleBound) {
            panel.dataset.errorToggleBound = '1';
            panel.addEventListener('toggle', () => {
                if (!panel.open) {
                    ctx.guardTranscriptActivityExpandClose(copy);
                }
            });
        }
}

export function syncTranscriptActivityThinkingCopyExtracted(ctx: any, copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        syncTranscriptActivityThinkingCopyHelper(copy, item, isActive, options, {
            resolveTranscriptStreamVisualIdle: (s, st) => ctx.resolveTranscriptStreamVisualIdle(s, st),
            cleanTranscriptDisplayText: c => ctx.contentUi.cleanTranscriptDisplayText(c),
            isConversationFinalResponseCommitted: (c, st) => ctx.isConversationFinalResponseCommitted(c, st),
            guardTranscriptActivityExpandClose: cp => ctx.guardTranscriptActivityExpandClose(cp),
        });
}

export function populateTranscriptActivityStepCopyExtracted(ctx: any, copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,): void {
        populateTranscriptActivityStepCopyHelper(copy, item, isActive, options, {
            syncTranscriptActivityThinkingCopy: (cp, it, act, opt) => ctx.syncTranscriptActivityThinkingCopy(cp, it, act, opt),
            unwrapTranscriptActivityExpandCopy: cp => ctx.unwrapTranscriptActivityExpandCopy(cp),
            syncTranscriptActivityStepCopyCursorTrace: (r, it) => ctx.syncTranscriptActivityStepCopyCursorTrace(r, it),
            shouldRenderTranscriptActivityDetailAsPill: (d, k) => ctx.shouldRenderTranscriptActivityDetailAsPill(d, k),
            createTranscriptActivityFileChip: (d, k, fp) => ctx.createTranscriptActivityFileChip(d, k, fp),
            appendTranscriptActivityEditDiffTail: (r, a, rm) => ctx.appendTranscriptActivityEditDiffTail(r, a, rm),
            createTranscriptActivityLabel: (l, c) => ctx.createTranscriptActivityLabel(l, c),
            applyTranscriptActivityStepShimmer: (cp, act, sh, st) => ctx.applyTranscriptActivityStepShimmer(cp, act, sh, st),
            syncTranscriptActivityRunningBadge: (cp, it, act, opt) => ctx.syncTranscriptActivityRunningBadge(cp, it, act, opt),
            syncTranscriptActivityDiffPeek: (cp, it, opt) => ctx.syncTranscriptActivityDiffPeek(cp, it, opt),
            syncTranscriptActivityErrorCopy: (cp, it, opt) => ctx.syncTranscriptActivityErrorCopy(cp, it, opt),
            resolveTranscriptActivityExpandContent: (it, opt) => ctx.resolveTranscriptActivityExpandContent(it, opt),
            syncTranscriptActivityExpandCopy: (cp, c) => ctx.syncTranscriptActivityExpandCopy(cp, c),
            guardTranscriptActivityExpandClose: cp => ctx.guardTranscriptActivityExpandClose(cp),
        });
}

export function shouldRenderTranscriptActivityDetailAsPillExtracted(ctx: any, detail: string | undefined,
        toolKind?: string,): boolean {
        if (!detail?.trim()) {
            return false;
        }
        if (toolKind === 'terminal' || toolKind === 'searching') {
            return false;
        }
        const clean = detail.trim();
        if (/^(?:https?:\/\/)?(?:www\.)?[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(clean)) {
            return true;
        }
        if (!/[./\\]/.test(clean)) {
            return false;
        }
        return true;
}

export function createTranscriptActivityFileChipExtracted(ctx: any, detail: string, toolKind?: string, fullPath?: string): HTMLElement {
        const chip = document.createElement('span');
        chip.className = 'theia-mobile-agent-activity-file-chip';
        if (toolKind === 'editing') {
            chip.classList.add('theia-mod-edit-link');
        }
        chip.setAttribute('role', 'button');
        chip.tabIndex = 0;
        if (fullPath) {
            chip.title = fullPath;
        }
        const icon = document.createElement('span');
        icon.className = `codicon ${ctx.transcriptFileIconClass(detail)}`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-activity-file-chip-label';
        label.textContent = detail;
        chip.append(icon, label);
        return chip;
}

export function createTranscriptActivityIconExtracted(ctx: any, state: TranscriptActivityStepState,
        active: boolean,
        toolKind?: string,
        streaming?: boolean,
        options?: { readonly subagentRoot?: boolean },): HTMLElement {
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-activity-icon';
        icon.setAttribute('aria-hidden', 'true');
        const kindIconClass = toolKind ? ctx.activityToolKindIconMap[toolKind] : undefined;
        const motionKind = resolveActivityToolIconMotionKind(toolKind)
            ?? (state === 'retrying' ? 'update' : undefined);
        if (options?.subagentRoot && active && isTranscriptActivityLiveState(state) && streaming) {
            const spinner = createThinkingOrbIndicator({
                activityKind: toolKind ?? state,
                isWorking: true,
                className: 'theia-mobile-agent-activity-icon-spinner theia-mod-compact',
            });
            icon.append(spinner);
            icon.classList.add('theia-mod-active');
            return icon;
        }
        if (state === 'thinking' || toolKind === 'thinking') {
            if (active && isTranscriptActivityLiveState(state) && streaming) {
                const spinner = createThinkingOrbIndicator({
                    activityKind: toolKind ?? 'thinking',
                    isWorking: true,
                    className: 'theia-mobile-agent-activity-icon-spinner theia-mod-compact',
                });
                icon.append(spinner);
                icon.classList.add('theia-mod-active');
                return icon;
            }
            icon.classList.add('theia-mod-thinking', 'codicon', kindIconClass ?? 'codicon-thinking');
            if (active && isTranscriptActivityLiveState(state)) {
                icon.classList.add('theia-mod-active', 'theia-mod-pulse');
            }
            return icon;
        }
        // Live tool rows keep the kind glyph visible and animate it (lucide-animated spirit)
        // instead of swapping to the generic orb / arrow bullet.
        if (active && isTranscriptActivityLiveState(state) && kindIconClass && motionKind) {
            icon.classList.add('theia-mod-kind', 'theia-mod-running', 'codicon', kindIconClass);
            syncActivityToolIconMotion(icon, true, toolKind);
            return icon;
        }
        if (active && isTranscriptActivityLiveState(state)) {
            if (streaming) {
                const spinner = createThinkingOrbIndicator({
                    activityKind: toolKind ?? state,
                    isWorking: true,
                    className: 'theia-mobile-agent-activity-icon-spinner theia-mod-compact',
                });
                icon.append(spinner);
                icon.classList.add('theia-mod-active');
                return icon;
            }
            icon.classList.add('theia-mod-active', 'theia-mod-pulse');
            const arrow = document.createElement('span');
            arrow.className = 'codicon codicon-arrow-small-right';
            arrow.setAttribute('aria-hidden', 'true');
            icon.append(arrow);
            return icon;
        }
        switch (state) {
            case 'waiting':
                icon.classList.add('theia-mod-waiting', 'codicon', 'codicon-shield');
                break;
            case 'streaming':
                icon.classList.add('theia-mod-streaming', 'codicon', kindIconClass ?? 'codicon-loading');
                if (kindIconClass && motionKind) {
                    syncActivityToolIconMotion(icon, true, toolKind);
                }
                break;
            case 'success':
                if (toolKind && kindIconClass) {
                    icon.classList.add('theia-mod-kind', 'theia-mod-success', 'codicon', kindIconClass);
                } else {
                    icon.classList.add('theia-mod-success', 'codicon', 'codicon-check');
                }
                break;
            case 'error':
                icon.classList.add('theia-mod-error', 'codicon', 'codicon-error');
                break;
            case 'warning':
                icon.classList.add('theia-mod-warning', 'codicon', 'codicon-warning');
                break;
            case 'cancelled':
                icon.classList.add('theia-mod-cancelled', 'codicon', 'codicon-circle-slash');
                break;
            case 'retrying':
                icon.classList.add('theia-mod-retrying', 'codicon', 'codicon-refresh');
                syncActivityToolIconMotion(icon, true, 'retrying');
                break;
            case 'running':
            default:
                if (toolKind && kindIconClass) {
                    icon.classList.add('theia-mod-kind', 'theia-mod-running', 'codicon', kindIconClass);
                    syncActivityToolIconMotion(icon, true, toolKind);
                } else {
                    icon.classList.add('theia-mod-running', 'codicon', 'codicon-sync');
                    syncActivityToolIconMotion(icon, true, 'other');
                }
                break;
        }
        return icon;
}

export function createTranscriptActivityLabelExtracted(ctx: any, text: string, active = false): HTMLElement {
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-activity-label';
        label.textContent = text;
        label.classList.toggle('theia-mod-shimmer', active);
        return label;
}

export function createTranscriptPremiumHeadExtracted(ctx: any, iconClass: string,
        label: string,
        options?: { readonly count?: number; readonly variant?: 'default' | 'todos' },): HTMLElement {
        const head = document.createElement('div');
        head.className = 'theia-mobile-agent-premium-head';
        if (options?.variant === 'todos') {
            head.classList.add('theia-mod-todos');
        }
        const icon = document.createElement('span');
        icon.className = `theia-mobile-agent-premium-head-icon codicon ${iconClass}`;
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'theia-mobile-agent-premium-head-label';
        text.textContent = label;
        head.append(icon, text);
        if (options?.count !== undefined) {
            const count = document.createElement('span');
            count.className = 'theia-mobile-agent-premium-head-count';
            count.textContent = String(options.count);
            head.append(count);
        }
        return head;
}

export function createTranscriptDiffSummaryCardExtracted(ctx: any, segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        const stats = ctx.resolversUi.resolveTranscriptDiffStats(segments);
        if (!stats || (stats.added === 0 && stats.removed === 0)) {
            return undefined;
        }
        const card = document.createElement('section');
        card.className = 'theia-mobile-agent-premium-card theia-mobile-agent-diff-summary';
        card.append(ctx.createTranscriptPremiumHead(
            'codicon-diff',
            nls.localize('qaap/mobileProjects/transcriptDiffSummary', 'Change summary'),
        ));
        const statsRow = document.createElement('div');
        statsRow.className = 'theia-mobile-agent-diff-stats';
        const added = document.createElement('span');
        added.className = 'theia-mobile-agent-diff-stat theia-mod-added';
        added.textContent = `+${stats.added}`;
        const removed = document.createElement('span');
        removed.className = 'theia-mobile-agent-diff-stat theia-mod-removed';
        removed.textContent = `-${stats.removed}`;
        statsRow.append(added, removed);
        card.append(statsRow);
        return card;
}

export function createTranscriptChangedFilesCardExtracted(ctx: any, segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        const files = ctx.resolversUi.resolveTranscriptChangedFiles(segments);
        if (files.length === 0) {
            return undefined;
        }
        const stats = ctx.resolversUi.resolveTranscriptDiffStats(segments);

        // Collapsible, GitHub-style card: a compact header (count + aggregate +/- stats) that
        // expands to the per-file list.
        const card = document.createElement('details');
        card.className = 'theia-mobile-agent-premium-card theia-mobile-agent-changed-files';

        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-changed-files-summary';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-changed-files-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'theia-mobile-agent-changed-files-title';
        if (files.length === 1) {
            const file = files[0]!;
            const slash = file.path.lastIndexOf('/');
            title.textContent = slash >= 0 ? file.path.slice(slash + 1) : file.path;
        } else {
            title.textContent = nls.localize('qaap/mobileProjects/transcriptChangedFilesCount', '{0} files changed', String(files.length));
        }
        summary.append(chevron, title);
        const summaryStats = files.length === 1 ? files[0] : stats;
        if (summaryStats && ((summaryStats.added ?? 0) > 0 || (summaryStats.removed ?? 0) > 0)) {
            const statsRow = document.createElement('span');
            statsRow.className = 'theia-mobile-agent-changed-files-stats';
            ctx.appendTranscriptChangedFileDiffStats(statsRow, summaryStats.added ?? 0, summaryStats.removed ?? 0);
            summary.append(statsRow);
        } else if (files.length > 1 && stats && (stats.added > 0 || stats.removed > 0)) {
            const statsRow = document.createElement('span');
            statsRow.className = 'theia-mobile-agent-changed-files-stats';
            ctx.appendTranscriptChangedFileDiffStats(statsRow, stats.added, stats.removed);
            summary.append(statsRow);
        }
        summary.append(ctx.createTranscriptChangedFilesReviewButton());
        card.append(summary);

        const collapsedPreview = document.createElement('div');
        collapsedPreview.className = 'theia-mobile-agent-changed-files-collapsed-preview';
        if (files.length === 1) {
            const miniDiff = ctx.createTranscriptChangedFileMiniDiffPreview(segments, files[0]!);
            if (miniDiff) {
                collapsedPreview.append(miniDiff);
            } else {
                collapsedPreview.append(ctx.createTranscriptChangedFileRow(files[0]!, { compact: true }));
            }
        } else {
            const previewFiles = files.slice(0, 4);
            for (const file of previewFiles) {
                collapsedPreview.append(ctx.createTranscriptChangedFileRow(file, { compact: true }));
            }
            if (files.length > 4) {
                const more = document.createElement('div');
                more.className = 'theia-mobile-agent-changed-files-more';
                more.textContent = nls.localize(
                    'qaap/mobileProjects/transcriptChangedFilesMore',
                    '+{0} more',
                    String(files.length - 4),
                );
                collapsedPreview.append(more);
            }
        }
        if (collapsedPreview.childElementCount > 0) {
            card.append(collapsedPreview);
        }

        const list = document.createElement('div');
        list.className = 'theia-mobile-agent-changed-files-list';
        for (const file of files.slice(0, 12)) {
            list.append(ctx.createTranscriptChangedFileRow(file));
        }
        if (files.length > 12) {
            const more = document.createElement('div');
            more.className = 'theia-mobile-agent-changed-files-more';
            more.textContent = nls.localize(
                'qaap/mobileProjects/transcriptChangedFilesMore',
                '+{0} more',
                String(files.length - 12),
            );
            list.append(more);
        }
        card.append(list);
        return card;
}

