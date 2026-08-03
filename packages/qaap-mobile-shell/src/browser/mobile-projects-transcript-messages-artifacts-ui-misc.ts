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

export function syncTranscriptActivityItemElementExtracted(ctx: any, li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier> = isActive ? 'current' : 'recent',
        subagentCardChild = false,): void {
        if (isTranscriptExecutionTimelineNarrative(item)) {
            ctx.syncTranscriptExecutionNarrativeItemElement(li, item, tier);
            return;
        }
        const shimmerActive = isActive
            && !!options?.streaming
            && !options?.stalled
            && !options?.timedOut
            && isTranscriptActivityLiveState(item.state)
            && !ctx.resolveTranscriptStreamVisualIdle(options?.segments ?? [], !!options?.streaming);
        const tierClass = transcriptTimelineTierClassName(tier);
        const contentFingerprint = fingerprintTranscriptActivityItemContent(item);
        // For thinking items, include the overall message display phase in the
        // fingerprint so that a transition from acting → writing (or → settled)
        // forces a re-sync even when the thinking content itself hasn't changed.
        // This is what triggers the auto-collapse of the chain of thought once
        // the model starts writing its final response.
        const isThinkingItem = !!(item.thinkingContent || item.navigate === 'thought');
        const phaseSuffix = isThinkingItem
            ? `|phase:${resolveTranscriptTraceDisplayPhase(options?.segments ?? [], !!options?.streaming)}`
            : '';
        const itemFingerprint = fingerprintTranscriptActivityItemSlot(item, isActive, tierClass, shimmerActive) + phaseSuffix;
        if (li.getAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR) === itemFingerprint) {
            recordTranscriptRenderMetric('timeline_item_sync_skipped');
            return;
        }
        const previousContentFingerprint = li.getAttribute(TRANSCRIPT_ACTIVITY_ITEM_CONTENT_FP_ATTR);
        if (previousContentFingerprint === contentFingerprint && li.querySelector('.theia-mobile-agent-activity-copy')) {
            ctx.applyTranscriptActivityItemChrome(li, item, isActive, options, tierClass, shimmerActive, subagentCardChild);
            li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, itemFingerprint);
            li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_CONTENT_FP_ATTR, contentFingerprint);
            recordTranscriptRenderMetric('timeline_item_sync_light');
            return;
        }
        li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, itemFingerprint);
        li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_CONTENT_FP_ATTR, contentFingerprint);
        recordTranscriptRenderMetric('timeline_item_sync');
        const expandableThinking = !!(item.thinkingContent || item.navigate === 'thought');
        const expandableStep = !expandableThinking && ctx.shouldShowTranscriptActivityItemExpand(item, options);
        ctx.applyTranscriptActivityItemClassName(li, item, isActive, tierClass, {
            expandableThinking,
            expandableStep,
            subagentCardChild,
        });
        if (isActive) {
            li.setAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR, 'true');
            li.setAttribute('aria-current', 'step');
        } else {
            li.removeAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR);
            li.removeAttribute('aria-current');
        }
        const newIcon = ctx.createTranscriptActivityIcon(
            item.thinkingContent || item.navigate === 'thought' ? 'thinking' : item.state,
            isActive,
            item.thinkingContent || item.navigate === 'thought' ? 'thinking' : item.toolKind,
            !!options?.streaming || (!!options?.conv && options.conv.status === 'streaming'),
            { subagentRoot: !!item.subagentRoot },
        );
        const icon = li.querySelector('.theia-mobile-agent-activity-icon');
        if (newIcon) {
            if (icon) {
                icon.replaceWith(newIcon);
            } else {
                li.prepend(newIcon);
            }
        } else {
            icon?.remove();
        }
        let copy = li.querySelector<HTMLElement>('.theia-mobile-agent-activity-copy');
        if (!copy) {
            const legacyLabel = li.querySelector('.theia-mobile-agent-activity-label');
            copy = document.createElement('div');
            copy.className = 'theia-mobile-agent-activity-copy';
            if (legacyLabel) {
                copy.append(legacyLabel);
            } else {
                copy.append(ctx.createTranscriptActivityLabel(item.label, false));
            }
            li.append(copy);
        }
        ctx.populateTranscriptActivityStepCopy(copy, item, isActive, options);

        if (item.state === 'error' && item.errorSummary) {
            const errorEl = copy.querySelector('.theia-mobile-agent-activity-error-panel');
            if (errorEl && !errorEl.id) {
                const errorId = `trace-error-${item.segmentIndex ?? Math.random().toString(36).slice(2, 8)}`;
                errorEl.id = errorId;
                li.setAttribute('aria-describedby', errorId);
            } else if (errorEl?.id) {
                li.setAttribute('aria-describedby', errorEl.id);
            }
        } else {
            li.removeAttribute('aria-describedby');
        }
        ctx.syncTranscriptCheckpointRestoreAction(li, item);
}

export function syncTranscriptExecutionNarrativeItemElementExtracted(ctx: any, li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier>,): void {
        const tierClass = transcriptTimelineTierClassName(tier);
        const fingerprint = `narrative|${item.label}|${tierClass}`;
        if (li.getAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR) === fingerprint) {
            recordTranscriptRenderMetric('timeline_item_sync_skipped');
            return;
        }
        li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, fingerprint);
        li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_CONTENT_FP_ATTR, item.label);
        li.className = `theia-mobile-agent-activity-item theia-mod-narrative ${tierClass}`;
        li.removeAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR);
        li.removeAttribute('aria-current');
        li.removeAttribute('aria-describedby');
        li.removeAttribute(TRANSCRIPT_CHECKPOINT_RESTORE_ATTR);
        let copy = li.querySelector<HTMLElement>('.theia-mobile-agent-activity-copy');
        if (!copy) {
            copy = document.createElement('div');
            copy.className = 'theia-mobile-agent-activity-copy';
            li.replaceChildren(copy);
        } else {
            li.querySelector('.theia-mobile-agent-activity-icon')?.remove();
            for (const child of [...li.children]) {
                if (child !== copy) {
                    child.remove();
                }
            }
        }
        let label = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-narrative');
        if (!label) {
            label = document.createElement('p');
            label.className = 'theia-mobile-agent-activity-narrative';
            copy.replaceChildren(label);
        }
        label.textContent = item.label;
        recordTranscriptRenderMetric('timeline_item_sync');
}

export function syncTranscriptCheckpointRestoreActionExtracted(ctx: any, li: HTMLElement,
        item: TranscriptActivityTimelineItem,): void {
        const checkpointId = item.checkpointId;
        const conv = ctx.host.transcriptLastConv;
        const canRestore = !!checkpointId && canRestoreConversationCheckpoint(conv, checkpointId);
        const isErrorRow = item.state === 'error' && !!item.errorSummary;
        const errorPanel = li.querySelector<HTMLElement>('.theia-mobile-agent-activity-error-panel');
        let action = li.querySelector<HTMLButtonElement>('.theia-mobile-agent-activity-checkpoint-restore');
        if (!canRestore) {
            action?.remove();
            li.removeAttribute(TRANSCRIPT_CHECKPOINT_RESTORE_ATTR);
            return;
        }
        if (!action) {
            action = document.createElement('button');
            action.type = 'button';
            action.className = 'theia-mobile-agent-activity-checkpoint-restore';
        }
        li.setAttribute(TRANSCRIPT_CHECKPOINT_RESTORE_ATTR, checkpointId!);
        const label = item.detail?.trim() || item.label;
        if (isErrorRow && errorPanel) {
            li.querySelector('.theia-mobile-agent-activity-copy > .theia-mobile-agent-activity-checkpoint-restore')?.remove();
            const body = errorPanel.querySelector('.theia-mobile-agent-activity-error-panel-body');
            if (body && !body.contains(action)) {
                body.append(action);
            }
            action.title = nls.localize(
                'qaap/mobileProjects/transcriptCheckpointRestoreBeforeStep',
                'Restore workspace to the state before this step',
            );
            action.setAttribute('aria-label', action.title);
            action.textContent = nls.localize(
                'qaap/mobileProjects/transcriptCheckpointRestoreBeforeStepShort',
                'Restore to before this step',
            );
        } else {
            errorPanel?.querySelector('.theia-mobile-agent-activity-checkpoint-restore')?.remove();
            const copy = li.querySelector('.theia-mobile-agent-activity-copy');
            if (copy && !copy.contains(action)) {
                copy.append(action);
            }
            action.title = nls.localize(
                'qaap/mobileProjects/transcriptCheckpointRestore',
                'Restore workspace to this checkpoint',
            );
            action.setAttribute('aria-label', action.title);
            action.textContent = nls.localize('qaap/mobileProjects/transcriptCheckpointRestoreShort', 'Restore');
        }
        action.disabled = li.dataset.transcriptCheckpointRestoreBusy === '1';
        action.onclick = ev => {
            ev.preventDefault();
            ev.stopPropagation();
            void ctx.restoreTranscriptCheckpoint(checkpointId!, label);
        };
}

export function guardTranscriptActivityExpandCloseExtracted(ctx: any, host: HTMLElement | null | undefined): void {
        const row = host?.closest('li.theia-mobile-agent-activity-item');
        if (!(row instanceof HTMLElement)) {
            return;
        }
        row.classList.add('theia-mod-expand-close-guarded');
        window.setTimeout(() => {
            row.classList.remove('theia-mod-expand-close-guarded');
        }, 420);
}

export async function restoreTranscriptCheckpointExtracted(ctx: any, checkpointId: string, checkpointLabel?: string): Promise<void> {
        const conv = ctx.host.transcriptLastConv;
        if (!conv || !canRestoreConversationCheckpoint(conv, checkpointId)) {
            return;
        }
        const detail = checkpointLabel?.trim()
            || conv.checkpoints?.find(checkpoint => checkpoint.id === checkpointId)?.label
            || nls.localize('qaap/mobileProjects/transcriptCheckpointRestoreFallback', 'this checkpoint');
        const confirmed = await new ConfirmDialog({
            title: nls.localize('qaap/mobileProjects/transcriptCheckpointRestoreTitle', 'Restore checkpoint'),
            msg: nls.localize(
                'qaap/mobileProjects/transcriptCheckpointRestoreMsg',
                'Revert tracked files to "{0}"? Changes made after this point will be lost.',
                detail,
            ),
            ok: nls.localize('qaap/mobileProjects/transcriptCheckpointRestoreConfirm', 'Restore'),
            cancel: nls.localize('qaap/mobileProjects/parallelCancel', 'Back'),
        }).open();
        if (!confirmed) {
            return;
        }
        document.querySelectorAll(`[${TRANSCRIPT_CHECKPOINT_RESTORE_ATTR}="${checkpointId}"]`)
            .forEach(row => {
                row.setAttribute('data-transcript-checkpoint-restore-busy', '1');
                row.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-activity-checkpoint-restore')
                    .forEach(button => { button.disabled = true; });
            });
        try {
            const updated = await restoreConversationCheckpoint(conv.id, checkpointId);
            ctx.host.conversations?.recordSnapshot(conversationToSummary(updated));
            if (ctx.onConversationMutation) {
                ctx.onConversationMutation(updated);
            } else {
                ctx.host.transcriptLastConv = updated;
                ctx.host.transcriptLastFingerprint = undefined;
                ctx.host.transcriptStickyComposerUi.refreshComposerActivityStack();
            }
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/transcriptCheckpointRestored', 'Workspace restored'),
                { kind: 'success', duration: 2000 },
            );
        } catch (error) {
            MobileSnackbar.show(
                error instanceof Error ? error.message : String(error),
                { kind: 'warning', duration: 3200 },
            );
        } finally {
            document.querySelectorAll(`[${TRANSCRIPT_CHECKPOINT_RESTORE_ATTR}="${checkpointId}"]`)
                .forEach(row => {
                    row.removeAttribute('data-transcript-checkpoint-restore-busy');
                    row.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-activity-checkpoint-restore')
                        .forEach(button => { button.disabled = false; });
                });
        }
}

export function applyTranscriptActivityItemClassNameExtracted(ctx: any, li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        tierClass: string,
        chrome: {
            readonly expandableThinking: boolean;
            readonly expandableStep: boolean;
            readonly subagentCardChild?: boolean;
        },): void {
        const previousState = li.dataset.transcriptActivityState as TranscriptActivityStepState | undefined;
        const keepEnter = li.classList.contains('theia-mod-enter');
        const nestClass = transcriptActivityNestDepthClassName(item.nestDepth ?? 0) ?? '';
        const roleClass = item.timelineRole ? ` theia-mod-${item.timelineRole}` : '';
        const subagentCardClass = item.subagentRoot ? ` ${transcriptActivitySubagentCardClassName}` : '';
        const isSubagentChild = chrome.subagentCardChild ?? ((item.nestDepth ?? 0) > 0 && !item.subagentRoot);
        const subagentChildClass = isSubagentChild ? ' theia-mod-subagent-card-child' : '';
        li.className = `theia-mobile-agent-activity-item theia-mod-${item.state}${roleClass}${isActive ? ' theia-mod-active' : ''}${item.grouped ? ' theia-mod-grouped' : ''}${item.subagentRoot ? ' theia-mod-subagent-root' : ''}${subagentCardClass}${subagentChildClass}${chrome.expandableThinking ? ' theia-mod-expandable-thinking' : ''}${chrome.expandableStep ? ' theia-mod-expandable-step' : ''}${nestClass ? ` ${nestClass}` : ''} ${tierClass}`;
        if (keepEnter) {
            li.classList.add('theia-mod-enter');
        }
        if (shouldApplyTranscriptActivitySettleMotion(previousState, item.state)) {
            li.classList.add('theia-mod-settle');
            li.addEventListener('animationend', () => li.classList.remove('theia-mod-settle'), { once: true });
        }
        li.dataset.transcriptActivityState = item.state;
}

export function applyTranscriptActivityItemChromeExtracted(ctx: any, li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options: TranscriptActivityTimelineOptions | undefined,
        tierClass: string,
        shimmerActive: boolean,
        subagentCardChild = false,): void {
        const expandableThinking = !!(item.thinkingContent || item.navigate === 'thought');
        const expandableStep = !expandableThinking && ctx.shouldShowTranscriptActivityItemExpand(item, options);
        ctx.applyTranscriptActivityItemClassName(li, item, isActive, tierClass, {
            expandableThinking,
            expandableStep,
            subagentCardChild,
        });
        if (isActive) {
            li.setAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR, 'true');
            li.setAttribute('aria-current', 'step');
        } else {
            li.removeAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR);
            li.removeAttribute('aria-current');
        }
        const copy = li.querySelector<HTMLElement>('.theia-mobile-agent-activity-copy');
        if (copy) {
            if (options?.cursorTrace) {
                ctx.populateTranscriptActivityStepCopy(copy, item, isActive, options);
            } else {
                ctx.applyTranscriptActivityStepShimmer(copy, isActive, shimmerActive, !!options?.stalled);
            }
        }
        ctx.syncTranscriptCheckpointRestoreAction(li, item);
}

export function applyTranscriptActivityStepShimmerExtracted(ctx: any, copy: HTMLElement,
        isActive: boolean,
        shimmerActive: boolean,
        stalled: boolean,): void {
        const labelForShimmer = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-label')
            ?? copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-row');
        labelForShimmer?.classList.toggle('theia-mod-shimmer', shimmerActive);
        labelForShimmer?.classList.toggle('theia-mod-stall', isActive && stalled);
}

