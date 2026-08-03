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

export function createTranscriptChangedFileMiniDiffPreviewExtracted(ctx: any, segments: readonly QaapAgentMessageSegmentDTO[],
        file: { readonly path: string },): HTMLElement | undefined {
        for (const segment of segments) {
            if (segment.type !== 'tool') {
                continue;
            }
            const path = ctx.resolversUi.extractTranscriptToolPath(segment.args);
            if (path !== file.path || !segment.result?.trim()) {
                continue;
            }
            const card = extractTranscriptDiffCard(
                ctx.resolversUi.formatTranscriptToolResult(segment.result),
                5,
            );
            if (!card?.lines.length) {
                continue;
            }
            const wrap = document.createElement('div');
            wrap.className = 'theia-mobile-agent-changed-files-mini-diff';
            const lines = document.createElement('pre');
            lines.className = 'theia-mobile-agent-changed-files-mini-diff-lines';
            for (const line of card.lines.slice(0, 5)) {
                const row = document.createElement('div');
                row.className = `theia-mobile-agent-changed-files-mini-diff-line theia-mod-${line.kind}`;
                const marker = document.createElement('span');
                marker.className = 'theia-mobile-agent-changed-files-mini-diff-marker';
                marker.textContent = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
                const text = document.createElement('span');
                text.className = 'theia-mobile-agent-changed-files-mini-diff-text';
                text.textContent = line.text;
                row.append(marker, text);
                lines.append(row);
            }
            wrap.append(lines);
            return wrap;
        }
        return undefined;
}

export function createTranscriptChangedFilesReviewButtonExtracted(ctx: any): HTMLButtonElement {
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'theia-mobile-agent-changed-files-review';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-git-compare';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = nls.localize('qaap/mobileProjects/transcriptChangedFilesReview', 'Review');
        review.append(icon, label);
        review.addEventListener('click', event => {
            // Inside <summary>: stop the click from toggling the collapsible card.
            event.preventDefault();
            event.stopPropagation();
            const project = ctx.host.transcriptComposerProject;
            const convSummary = ctx.host.transcriptComposerSummary;
            if (project && convSummary) {
                ctx.host.executionSurfaceTabsUi.selectTranscriptTab('review', project, convSummary);
            }
        });
        return review;
}

export function appendTranscriptChangedFileDiffStatsExtracted(ctx: any, parent: HTMLElement,
        added: number,
        removed: number,): void {
        if (added > 0) {
            const add = document.createElement('span');
            add.className = 'theia-mobile-agent-diff-stat theia-mod-added';
            add.textContent = `+${added}`;
            parent.append(add);
        }
        if (removed > 0) {
            const rem = document.createElement('span');
            rem.className = 'theia-mobile-agent-diff-stat theia-mod-removed';
            rem.textContent = `−${removed}`;
            parent.append(rem);
        }
}

export function createTranscriptChangedFileRowExtracted(ctx: any, file: { readonly path: string; readonly kind: 'edited' | 'created'; readonly added?: number; readonly removed?: number },
        options?: { readonly compact?: boolean },): HTMLElement {
        const row = document.createElement('div');
        row.className = `theia-mobile-agent-changed-file theia-mod-${file.kind}${options?.compact ? ' theia-mod-compact' : ''}`;

        const icon = document.createElement('span');
        icon.className = `theia-mobile-agent-changed-file-icon codicon ${ctx.transcriptFileIconClass(file.path)}`;
        icon.setAttribute('aria-hidden', 'true');

        const info = document.createElement('span');
        info.className = 'theia-mobile-agent-changed-file-info';
        const slash = file.path.lastIndexOf('/');
        const name = document.createElement('span');
        name.className = 'theia-mobile-agent-changed-file-name';
        name.textContent = slash >= 0 ? file.path.slice(slash + 1) : file.path;
        info.append(name);
        if (!options?.compact && slash > 0) {
            const dir = document.createElement('span');
            dir.className = 'theia-mobile-agent-changed-file-dir';
            dir.textContent = file.path.slice(0, slash);
            info.append(dir);
        }

        const tail = document.createElement('span');
        tail.className = 'theia-mobile-agent-changed-file-tail';
        const added = file.added ?? 0;
        const removed = file.removed ?? 0;
        if (added > 0 || removed > 0) {
            const stats = document.createElement('span');
            stats.className = 'theia-mobile-agent-changed-file-stats';
            ctx.appendTranscriptChangedFileDiffStats(stats, added, removed);
            tail.append(stats);
        } else if (!options?.compact) {
            const badge = document.createElement('span');
            badge.className = `theia-mobile-agent-changed-file-badge theia-mod-${file.kind}`;
            badge.textContent = file.kind === 'created'
                ? nls.localize('qaap/mobileProjects/transcriptChangedFileNew', 'New')
                : nls.localize('qaap/mobileProjects/transcriptChangedFileEdited', 'Edited');
            tail.append(badge);
        }

        row.append(icon, info, tail);
        ctx.toolUi.attachTranscriptReviewFileOpenAction(row, file.path);
        return row;
}

export function createTranscriptVerificationCardExtracted(ctx: any, segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        const checks = ctx.resolversUi.resolveTranscriptVerificationChecks(segments);
        if (checks.length === 0) {
            return undefined;
        }
        const card = document.createElement('section');
        card.className = 'theia-mobile-agent-premium-card theia-mobile-agent-verification';
        card.append(ctx.createTranscriptPremiumHead(
            'codicon-check-all',
            nls.localize('qaap/mobileProjects/transcriptVerification', 'Verification'),
        ));
        const list = document.createElement('div');
        list.className = 'theia-mobile-agent-verification-list';
        for (const check of checks.slice(-4)) {
            const row = document.createElement('div');
            row.className = `theia-mobile-agent-verification-row theia-mod-${check.state}`;
            const state = document.createElement('span');
            state.className = 'theia-mobile-agent-verification-state';
            state.textContent = check.state === 'passed'
                ? nls.localize('qaap/mobileProjects/transcriptVerificationPassed', 'OK')
                : check.state === 'failed'
                    ? nls.localize('qaap/mobileProjects/transcriptVerificationFailed', 'Fail')
                    : nls.localize('qaap/mobileProjects/transcriptVerificationRunning', 'Run');
            const command = document.createElement('span');
            command.className = 'theia-mobile-agent-verification-command';
            command.textContent = check.command;
            row.append(state, command);
            list.append(row);
        }
        card.append(list);
        return card;
}

export function createTranscriptTechnicalDetailsCardExtracted(ctx: any, segments: QaapAgentMessageSegmentDTO[],
        options?: { readonly activityTimelineShown?: boolean },): HTMLElement | undefined {
        if (options?.activityTimelineShown) {
            return undefined;
        }
        const technical = segments.filter(segment => segment.type === 'thinking');
        if (technical.length === 0) {
            return undefined;
        }
        const details = document.createElement('details');
        details.className = 'theia-mobile-agent-technical-details';
        const summary = document.createElement('summary');
        summary.textContent = nls.localize(
            'qaap/mobileProjects/transcriptTechnicalDetails',
            'Technical details ({0})',
            String(technical.length),
        );
        details.append(summary);
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-technical-details-body';
        for (const segment of technical) {
            body.append(ctx.toolUi.createTranscriptSegmentDetails(segment));
        }
        details.append(body);
        return details;
}

export function createTranscriptStreamingActivityRowExtracted(ctx: any, conv: QaapAgentConversationDTO): HTMLElement | undefined {
        const segments = [...resolveTranscriptStreamingAgentSegments(conv)];
        const awaitingFirstAgentOutput = isAwaitingFirstTranscriptAgentOutput(conv);
        const turnStartMs = resolveTranscriptTurnStartMs(conv.messages);
        const stalled = ctx.resolveTranscriptStreamStalled(conv);
        const timedOut = ctx.resolveTranscriptStreamTimedOut(conv);
        if (!shouldShowTranscriptStreamingActivity(segments, true, {
            turnElapsedMs: resolveTranscriptTurnElapsedMs(turnStartMs),
            userPromptChars: resolveLastUserPromptChars(conv.messages),
            stalled: stalled || timedOut,
            awaitingFirstAgentOutput,
        })) {
            return undefined;
        }
        const row = document.createElement('div');
        row.setAttribute(TRANSCRIPT_ACTIVITY_ROW_ATTR, 'true');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent theia-mod-streaming theia-mobile-agent-activity';
        row.setAttribute('aria-live', 'polite');
        row.setAttribute('aria-busy', 'true');
        const state = ctx.resolveTranscriptStreamingActivity(conv, { stalled, timedOut });
        const durationLabel = stalled || timedOut ? state.title : ctx.resolveTranscriptStreamDurationLabel(conv);

        // CloudCode-style setup animation: whimsical phrases + ThinkingOrb
        // + per-letter shimmer while the agent is in its initial setup or thinking
        // phase (no tool calls or answer text yet). Once the agent starts producing
        // output, fall back to the stream line with the real status.
        const phase = resolveTranscriptTraceDisplayPhase(segments, !stalled && !timedOut);
        const useSetupAnimation = (awaitingFirstAgentOutput || phase === 'thinking') && !stalled && !timedOut;
        if (useSetupAnimation) {
            const setupEl = createAgentSetupElement(durationLabel, {
                createIndicator: () => createThinkingOrbIndicator({
                    setup: phase !== 'thinking',
                    activityKind: phase === 'thinking' ? 'thinking' : 'planning',
                    isWorking: true,
                }),
            });
            const meta = ctx.createTranscriptStreamMeta(conv);
            if (meta) {
                setupEl.append(meta);
            }
            row.append(setupEl);
            const cleanupObserver = new MutationObserver(() => {
                if (!setupEl.isConnected) {
                    ctx.destroyThinkingOrbHosts(setupEl);
                    destroyAgentSetupElement(setupEl);
                    cleanupObserver.disconnect();
                }
            });
            cleanupObserver.observe(row, { childList: true, subtree: true });
        } else {
            const line = document.createElement('div');
            line.className = `theia-mobile-agent-stream-line theia-mod-${state.kind}`;
            const spinner = createThinkingOrbIndicator({
                activityKind: state.kind,
                isWorking: true,
                stalled,
                timedOut,
                className: 'theia-mobile-agent-stream-dot',
            });
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-stream-label';
            label.textContent = timedOut ? state.title : durationLabel;
            label.classList.toggle('theia-mod-shimmer', shouldTranscriptStreamLabelShimmer(state.kind, stalled, timedOut));
            label.classList.toggle('theia-mod-stall', stalled || timedOut);
            line.append(spinner, label);
            const meta = ctx.createTranscriptStreamMeta(conv);
            if (meta) {
                line.append(meta);
            }
            row.append(line);
        }
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
            row.classList.toggle('theia-mod-stream-stalled', stalled);
            row.classList.toggle('theia-mod-stream-timed-out', timedOut);
            row.dataset.qaapAgenticState = timedOut ? 'timeout' : stalled ? 'stall' : 'streaming';
            if (timedOut) {
                row.append(ctx.createTranscriptStreamTimeoutBanner());
            }
            ctx.ensureTranscriptStreamStallWatch(row);
        }
        // Whole-turn pinned chrome (setup → first agent tokens → tools → finalize).
        ctx.ensurePinnedTranscriptLiveStatus(conv, { stalled, timedOut });
        return row;
}

export function createTranscriptStreamMetaExtracted(ctx: any, conv: QaapAgentConversationDTO, ownerRow?: HTMLElement): HTMLElement | undefined {
        const turnStart = resolveTranscriptTurnStartMs(conv.messages);
        if (turnStart === undefined) {
            return undefined;
        }
        const meta = document.createElement('span');
        meta.className = 'theia-mobile-agent-stream-meta';
        const update = (): void => {
            const parts = [formatTranscriptStreamElapsed(Date.now() - turnStart)];
            // Keep the token meter visible for the whole stream (incl. ~0).
            parts.push(formatTranscriptStreamTokens(resolveTranscriptTurnStreamChars(
                ctx.host.transcriptLastConv?.id === conv.id ? ctx.host.transcriptLastConv.messages : conv.messages,
            )) ?? '~0 tokens');
            meta.textContent = `· ${parts.join(' · ')}`;
        };
        update();
        // Rides the shared 1s ticker instead of a dedicated per-row `setInterval`;
        // the ticker auto-drops `meta` once it's disconnected from the DOM.
        sharedSecondTicker.register({
            element: meta,
            render: () => {
                if (ownerRow && !ownerRow.classList.contains('theia-mod-streaming')) {
                    sharedSecondTicker.unregister(meta);
                    (meta.closest('.theia-mobile-agent-stream-status') ?? meta).remove();
                    return;
                }
                if (!isTranscriptDocumentVisible()) {
                    return;
                }
                update();
            },
        });
        return meta;
}

export function resolveTranscriptStreamDurationLabelExtracted(ctx: any, conv: QaapAgentConversationDTO): string {
        const turnStartMs = resolveTranscriptTurnStartMs(conv.messages);
        const durationMs = resolveTranscriptTurnElapsedMs(turnStartMs);
        const streaming = resolveTranscriptEffectiveStatus(conv) === 'streaming';
        return resolveTranscriptActivityTimelineSummaryText(0, {
            streaming,
            durationMs,
        });
}

export function resolveTranscriptStreamingActivityExtracted(ctx: any, conv: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean; readonly timedOut?: boolean },): { kind: string; title: string; detail: string } {
        const segments = [...resolveTranscriptStreamingAgentSegments(conv)] as QaapAgentMessageSegmentDTO[];
        return resolveTranscriptStreamingActivityFromSegments(segments, {
            stalled: options?.stalled,
            timedOut: options?.timedOut,
            stallTitle: ctx.resolveTranscriptStreamStallLabel(),
            localizeToolTitle: label => ctx.host.projectRowsUi.localizeActivityLabel(label),
        });
}

