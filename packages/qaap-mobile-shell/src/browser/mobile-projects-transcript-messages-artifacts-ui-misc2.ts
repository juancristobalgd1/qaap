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

export function syncTranscriptActivityStepCopyCursorTraceExtracted(ctx: any, rowEl: HTMLElement,
        item: TranscriptActivityTimelineItem,): boolean {
        const verbEl = rowEl.querySelector<HTMLElement>('.theia-mobile-agent-activity-verb');
        const detailEl = rowEl.querySelector<HTMLElement>('.theia-mobile-agent-activity-detail');
        if (!verbEl || !detailEl) {
            return false;
        }
        const hasDiff = item.editAdded !== undefined || item.editRemoved !== undefined;
        const hasTail = !!item.tail;
        const diffEl = rowEl.querySelector('.theia-mobile-agent-activity-diff-stats');
        const tailEl = rowEl.querySelector('.theia-mobile-agent-activity-tail');
        if (hasDiff !== !!diffEl || hasTail !== !!tailEl) {
            return false;
        }
        const verbText = item.verb ?? '';
        const detailAsPill = ctx.shouldRenderTranscriptActivityDetailAsPill(item.detail, item.toolKind);
        if (verbEl.textContent !== verbText) {
            verbEl.textContent = verbText;
        }
        if (detailAsPill) {
            const labelEl = detailEl.querySelector<HTMLElement>('.theia-mobile-agent-activity-detail-label');
            const iconEl = detailEl.querySelector<HTMLElement>('.theia-mobile-agent-activity-file-icon');
            if (!labelEl || !iconEl) {
                return false;
            }
            if (labelEl.textContent !== item.detail) {
                labelEl.textContent = item.detail ?? '';
            }
            const iconClass = `theia-mobile-agent-activity-file-icon codicon ${ctx.transcriptFileIconClass(item.detail ?? '')}`;
            if (iconEl.className !== iconClass) {
                iconEl.className = iconClass;
            }
        } else {
            const detailText = item.detail ? item.detail : '';
            if (detailEl.textContent !== detailText) {
                detailEl.textContent = detailText;
            }
        }
        detailEl.classList.toggle('theia-mod-pill', detailAsPill);
        detailEl.classList.toggle('theia-mod-command', item.toolKind === 'terminal' && !detailAsPill);
        detailEl.classList.toggle('theia-mod-edit-file', item.toolKind === 'editing' && detailAsPill);
        if (hasDiff && diffEl instanceof HTMLElement) {
            const addEl = diffEl.querySelector('.theia-mobile-agent-activity-diff-add');
            const remEl = diffEl.querySelector('.theia-mobile-agent-activity-diff-remove');
            const added = item.editAdded ?? 0;
            const removed = item.editRemoved ?? 0;
            if (added > 0) {
                if (addEl) {
                    addEl.textContent = `+${added}`;
                }
            } else {
                addEl?.remove();
            }
            if (removed > 0) {
                if (remEl) {
                    remEl.textContent = `−${removed}`;
                }
            } else {
                remEl?.remove();
            }
        }
        if (hasTail && tailEl instanceof HTMLElement && item.tail) {
            const tailText = ` ${item.tail}`;
            if (tailEl.textContent !== tailText) {
                tailEl.textContent = tailText;
            }
        }
        ctx.ensureTranscriptActivityVerbDetailSpacing(rowEl);
        if (item.filePath) {
            detailEl.title = item.filePath;
        } else {
            detailEl.removeAttribute('title');
        }
        return true;
}

export function syncTranscriptActivityDiffPeekExtracted(ctx: any, copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): void {
        const peek = resolveTranscriptActivityDiffPeek(item, options?.segments, 3);
        let peekEl = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-diff-peek');
        if (!peek || !options?.cursorTrace) {
            peekEl?.remove();
            return;
        }
        if (!peekEl) {
            peekEl = document.createElement('div');
            peekEl.className = 'theia-mobile-agent-activity-diff-peek';
            peekEl.setAttribute('aria-hidden', 'true');
            (copy.querySelector('.theia-mobile-agent-activity-meta')
                ?? copy.querySelector('.theia-mobile-agent-activity-row')
                ?? copy.firstElementChild)?.after(peekEl);
        }
        peekEl.replaceChildren();
        for (const line of peek.lines) {
            const lineEl = document.createElement('div');
            lineEl.className = `theia-mobile-agent-activity-diff-peek-line theia-mod-${line.kind}`;
            lineEl.textContent = line.text;
            peekEl.append(lineEl);
        }
}

export function ensureTranscriptActivityVerbDetailSpacingExtracted(ctx: any, rowEl: HTMLElement): void {
        const verbEl = rowEl.querySelector('.theia-mobile-agent-activity-verb');
        const detailEl = rowEl.querySelector('.theia-mobile-agent-activity-detail');
        if (!verbEl || !detailEl) {
            return;
        }
        if (verbEl.nextSibling === detailEl) {
            verbEl.after(document.createTextNode(' '));
            return;
        }
        let cursor: ChildNode | null = verbEl.nextSibling;
        while (cursor && cursor !== detailEl) {
            if (cursor.nodeType === Node.TEXT_NODE && /\s/.test(cursor.textContent ?? '')) {
                return;
            }
            cursor = cursor.nextSibling;
        }
        verbEl.after(document.createTextNode(' '));
}

export function appendTranscriptActivityEditDiffTailExtracted(ctx: any, rowEl: HTMLElement,
        added: number,
        removed: number,): void {
        if (added <= 0 && removed <= 0) {
            return;
        }
        const wrap = document.createElement('span');
        wrap.className = 'theia-mobile-agent-activity-diff-stats';
        if (added > 0) {
            const add = document.createElement('span');
            add.className = 'theia-mobile-agent-activity-diff-add';
            add.textContent = `+${added}`;
            wrap.append(add);
        }
        if (removed > 0) {
            const rem = document.createElement('span');
            rem.className = 'theia-mobile-agent-activity-diff-remove';
            rem.textContent = `−${removed}`;
            wrap.append(rem);
        }
        rowEl.append(wrap);
}

export function resolveTranscriptActivityExpandDepsExtracted(ctx: any): TranscriptActivityExpandDeps {
        return {
            extractToolPath: args => ctx.resolversUi.extractTranscriptToolPath(args),
            extractToolCommand: args => ctx.resolversUi.extractTranscriptToolCommand(args),
            formatToolLabel: (toolName, args) => formatToolActivityLabel(toolName, args),
        };
}

export function resolveTranscriptActivityExpandContentExtracted(ctx: any, item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): TranscriptActivityExpandContent | undefined {
        const content = resolveTranscriptActivityExpandContent(item, options?.segments, ctx.resolveTranscriptActivityExpandDeps());
        if (!content) {
            return undefined;
        }
        return ctx.enrichTranscriptActivityExpandContent(content, item, options);
}

export function enrichTranscriptActivityExpandContentExtracted(ctx: any, content: TranscriptActivityExpandContent,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): TranscriptActivityExpandContent {
        if (content.kind === 'text' || content.kind === 'todo' || content.kind === 'search-matches'
            || content.kind === 'web-search' || content.kind === 'question_flow') {
            return content;
        }
        if (content.kind === 'read') {
            const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
            return {
                kind: 'read',
                entry: ctx.enrichTranscriptActivityReadExpandEntry(content.entry, segment),
            };
        }
        if (content.kind === 'read-group') {
            return {
                kind: 'read-group',
                entries: content.entries.map((entry, index) => {
                    const segmentIndex = item.segmentIndices?.[index];
                    const segment = segmentIndex !== undefined ? options?.segments?.[segmentIndex] : undefined;
                    return ctx.enrichTranscriptActivityReadExpandEntry(entry, segment);
                }),
            };
        }
        if (content.kind === 'edit') {
            const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
            return {
                kind: 'edit',
                entry: ctx.enrichTranscriptActivityEditExpandEntry(content.entry, segment, options),
            };
        }
        if (content.kind === 'edit-group') {
            return {
                kind: 'edit-group',
                entries: content.entries.map((entry, index) => {
                    const segmentIndex = item.segmentIndices?.[index];
                    const segment = segmentIndex !== undefined ? options?.segments?.[segmentIndex] : undefined;
                    return ctx.enrichTranscriptActivityEditExpandEntry(entry, segment, options);
                }),
            };
        }
        const enrich = (
            entry: TranscriptActivityTerminalExpandEntry,
            segment?: QaapAgentMessageSegmentDTO,
        ): TranscriptActivityTerminalExpandEntry => {
            const rawOutput = segment?.type === 'tool' ? segment.result : entry.output;
            const failed = ctx.resolversUi.transcriptToolResultFailed(rawOutput, segment?.type === 'tool' ? segment.name : undefined);
            const finished = entry.finished ?? (segment?.type === 'tool' ? segment.finished : true);
            const output = rawOutput?.trim() && !/^ok$/i.test(rawOutput.trim())
                ? ctx.resolversUi.formatTranscriptToolResult(rawOutput)
                : undefined;
            const exitCode = finished
                ? (ctx.toolUi.parseTranscriptShellExitCode(rawOutput) ?? (failed ? 1 : undefined))
                : undefined;
            return {
                command: entry.command,
                output,
                failed,
                finished,
                exitCode,
            };
        };
        if (content.kind === 'terminal') {
            const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
            return {
                kind: 'terminal',
                entry: enrich(content.entry, segment),
            };
        }
        return {
            kind: 'terminal-group',
            entries: content.entries.map((entry, index) => {
                const segmentIndex = item.segmentIndices?.[index];
                const segment = segmentIndex !== undefined ? options?.segments?.[segmentIndex] : undefined;
                return enrich(entry, segment);
            }),
        };
}

export function enrichTranscriptActivityReadExpandEntryExtracted(ctx: any, entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry {
        const raw = segment?.type === 'tool' ? segment.result : entry.text;
        const text = raw?.trim() && !/^ok$/i.test(raw.trim())
            ? ctx.resolversUi.formatTranscriptToolResult(raw)
            : entry.text;
        return {
            path: entry.path ?? (segment?.type === 'tool' ? ctx.resolversUi.extractTranscriptToolPath(segment.args) : undefined),
            text,
        };
}

export function enrichTranscriptActivityEditExpandEntryExtracted(ctx: any, entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,
        options?: TranscriptActivityTimelineOptions,): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry {
        const stats = options?.segments
            ? ctx.resolversUi.resolveTranscriptFileDiffStats([...options.segments], entry.path)
            : {};
        return {
            path: entry.path,
            added: stats.added ?? entry.added,
            removed: stats.removed ?? entry.removed,
        };
}

export function shouldShowTranscriptActivityItemExpandExtracted(ctx: any, item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,): boolean {
        const content = ctx.resolveTranscriptActivityExpandContent(item, options);
        return shouldShowTranscriptActivityExpandContent(item, content);
}

export function unwrapTranscriptActivityExpandCopyExtracted(ctx: any, copy: HTMLElement): void {
        const details = copy.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        if (!details) {
            return;
        }
        const summary = details.querySelector('summary');
        if (summary) {
            summary.querySelector('.theia-mobile-agent-activity-expand-chevron')?.remove();
            for (const child of [...summary.childNodes]) {
                copy.insertBefore(child, details);
            }
        }
        details.remove();
}

export function syncTranscriptActivityExpandCopyExtracted(ctx: any, copy: HTMLElement, content: TranscriptActivityExpandContent): void {
        let details = copy.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-expand');
        if (!details) {
            const created = document.createElement('details');
            created.className = 'theia-mobile-agent-activity-expand';
            const summary = document.createElement('summary');
            summary.className = 'theia-mobile-agent-activity-expand-summary';
            const chevron = document.createElement('span');
            chevron.className = 'theia-mobile-agent-activity-expand-chevron codicon codicon-chevron-right';
            chevron.setAttribute('aria-hidden', 'true');
            const movable = [...copy.children].filter(child => {
                if (!(child instanceof HTMLElement)) {
                    return true;
                }
                return !child.classList.contains('theia-mobile-agent-activity-error-detail')
                    && !child.classList.contains('theia-mobile-agent-activity-error-expand');
            });
            summary.append(...movable, chevron);
            const body = document.createElement('div');
            body.className = 'theia-mobile-agent-activity-expand-body';
            created.append(summary, body);
            copy.prepend(created);
            summary.addEventListener('click', event => event.stopPropagation());
            if (!created.dataset.expandToggleBound) {
                created.dataset.expandToggleBound = '1';
                created.addEventListener('toggle', () => {
                    if (created.open) {
                        created.dataset.expandUserExpanded = '1';
                    } else {
                        created.removeAttribute('data-expand-user-expanded');
                        ctx.guardTranscriptActivityExpandClose(copy);
                    }
                });
            }
            details = created;
        }
        const bodyEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-expand-body');
        if (bodyEl) {
            ctx.renderTranscriptActivityExpandBody(bodyEl, content);
        }
        if (!details.dataset.expandUserExpanded) {
            details.open = false;
        }
}

export function renderTranscriptActivityExpandBodyExtracted(ctx: any, body: HTMLElement, content: TranscriptActivityExpandContent): void {
        body.replaceChildren();
        body.className = `theia-mobile-agent-activity-expand-body theia-mod-${content.kind}`;
        if (content.kind === 'text') {
            body.textContent = content.text;
            return;
        }
        if (content.kind === 'search-matches') {
            body.append(ctx.toolUi.createTranscriptActivitySearchMatchesPanel(content.matches));
            return;
        }
        if (content.kind === 'web-search') {
            body.append(createTranscriptWebSearchCard(content.payload, { open: true }));
            return;
        }
        if (content.kind === 'read') {
            body.append(ctx.toolUi.createTranscriptActivityReadExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'read-group') {
            body.append(ctx.toolUi.createTranscriptActivityReadExpandPanel(content.entries));
            return;
        }
        if (content.kind === 'edit') {
            body.append(ctx.toolUi.createTranscriptActivityEditExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'edit-group') {
            body.append(ctx.toolUi.createTranscriptActivityEditExpandPanel(content.entries));
            return;
        }
        if (content.kind === 'terminal') {
            body.append(ctx.toolUi.createTranscriptActivityTerminalExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'todo') {
            body.append(ctx.toolUi.createTranscriptActivityTodoExpandPanel(content.items));
            return;
        }
        if (content.kind === 'question_flow') {
            body.append(buildTranscriptToolUiPayloadElement(content.payload));
            return;
        }
        body.append(ctx.toolUi.createTranscriptActivityTerminalExpandPanel(content.entries));
}

