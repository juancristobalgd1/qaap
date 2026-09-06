// @ts-nocheck
import { resolveAgentMessageTiming } from '../common/qaap-transcript-turn-status';
import { MOBILE_CLOSING_TEXT_ERROR_PREFIX } from './mobile-projects-transcript-messages-artifacts-ui-constants';
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
import { enhanceTranscriptCaptureDirectives } from './qaap-transcript-capture-pending-ui';
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

export function removeTranscriptLiveStatusWithOrbExtracted(ctx: any, root: ParentNode): void {
        removeTranscriptLiveStatusElement(root, {
            beforeRemove: element => {
                for (const host of element.querySelectorAll<HTMLElement>(`.${QAAP_THINKING_ORB_INDICATOR_CLASS}`)) {
                    destroyThinkingOrbIndicator(host);
                }
            },
        });
}

export function didExecutionToolSegmentsChangeExtracted(ctx: any, previousSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],): boolean {
        return didExecutionToolSegmentsChangeHelper(previousSegments, nextSegments);
}

export function createTranscriptAgentSegmentsRowExtracted(ctx: any, segments: QaapAgentMessageSegmentDTO[],
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
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
        const defer = !!options?.deferHeavyContent;
        if (defer) {
            row.setAttribute('data-transcript-row-deferred', '1');
        }
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-transcript-segments';
        const streaming = !!options?.streaming;

        // ─── Codex-style Execution Event Timeline ───────────────────────────
        // Replaces the old activity timeline + tool pills + diff/verification cards.
        // Events are the primary element; tools are children, not siblings.
        // Everything collapsed by default. Only Terminal/Error/Diff get cards.
        const hasToolSegments = segments.some(s => s.type === 'tool');
        if (hasToolSegments) {
            ctx.renderMobileExecutionEventTimeline(body, segments, {
                streaming,
                defer,
                conv,
                error,
                message: options?.message,
            });
        } else {
            // No tools (yet, or ever, for a turn that never calls one) — still
            // render the turn-provenance badge as the FIRST child of `body`
            // (same slot used when tools exist: above the process accordion).
            // This is deliberately NOT an empty accordion -- there is no process to
            // expand for a tool-less turn, and a collapsible control with nothing
            // inside would be worse than no accordion at all.
            const effectiveMessage = options?.message ?? ctx.resolveLastAgentMessage(conv);
            const provenance = ctx.resolveTurnProvenance(conv, effectiveMessage);
            syncTranscriptStandaloneTurnProvenance(body, provenance.turnAgentId, provenance.turnAgentModel);
            // No tools yet — render thinking content (if any) as a thought brief,
            // then visible text segments. This preserves the thinking-phase UX
            // (collapsible reasoning block with live indicator) before the first
            // tool arrives. When tools arrive later via streaming, the row is
            // upgraded to the Codex-style timeline in patchStreamingActivityTimeline.
            const thoughtBrief = ctx.createTranscriptThoughtBriefBlock(segments, {
                streaming,
                conv,
            });
            if (thoughtBrief) {
                body.append(thoughtBrief);
            }
            for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
                const segment = segments[segmentIndex];
                if (segment.type === 'text' && (segment.content?.trim() ?? '').length > 0) {
                    const textBlock = ctx.toolUi.createTranscriptSegmentDetails(segment, {
                        defer,
                        streaming: options?.streaming,
                    });
                    textBlock.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
                    body.append(textBlock);
                }
            }
        }

        if (error) {
            const failedTool = extractLastFailedToolFromMessage({
                role: 'agent',
                content: '',
                segments,
            });
            const canRetry = conv?.status === 'failed' && !!ctx.host.retryOpenFailedConversationTask;
            const provenance = ctx.resolveTurnProvenance(conv, undefined);
            const agentId = provenance.turnAgentId ?? conv?.agentId;
            const failureMessage = {
                role: 'agent' as const,
                content: '',
                error,
                segments,
            };
            body.append(ctx.toolUi.createTranscriptAgentFailureDialog(
                error,
                resolveAgentTurnFailureTechnicalContent(failureMessage),
                {
                    failedToolName: failedTool?.name,
                    onRetry: canRetry ? () => ctx.host.retryOpenFailedConversationTask?.() : undefined,
                    onOpenAuthUrl: (url: string) => {
                        window.open(url, '_blank', 'noopener,noreferrer');
                    },
                    onOpenAgentSignIn: ctx.host.openAgentSignInTerminal
                        ? () => ctx.host.openAgentSignInTerminal?.(agentId)
                        : undefined,
                    onOpenAiFeaturesSettings: ctx.host.openPreferencesSheet
                        ? () => ctx.host.openPreferencesSheet?.('ai-features')
                        : undefined,
                    agentId,
                    agentMessage: failureMessage,
                },
            ));
        }
        row.append(body);
        // Child Markdown blocks may have rendered synchronously before the row was
        // assembled. Reconcile once the complete row is attached so settled visual
        // evidence can remove a chip created during that detached render.
        for (const content of row.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-content')) {
            enhanceTranscriptCaptureDirectives(content);
        }
        if (streaming && conv && !hasToolSegments) {
            ctx.ensureAndSyncTranscriptLiveStatusFooter(body, segments, conv, { streaming: true });
        }
        if (streaming) {
            ctx.ensureTranscriptStreamStallWatch(row);
        }
        return row;
}

export function renderMobileExecutionEventTimelineExtracted(ctx: any, body: HTMLElement,
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
        const { streaming, defer, conv, error, message } = options;
        const eventTimeline = createMobileExecutionEventTimeline(segments);
        // Wrap the timeline in a process accordion (Codex-style "Processed in").
        const { isWorking, elapsedMs, turnStartMs } = resolveAgentMessageTiming(conv, message ?? ctx.resolveLastAgentMessage(conv));
        const isError = ctx.isConversationError(conv);
        // Cancellation must be derived from THIS message, not merely the
        // conversation's last agent message -- each agent message renders its
        // own accordion, and in a multi-turn conversation a historical
        // (already-settled) turn's accordion would otherwise be mislabeled
        // whenever a later turn happened to end up cancelled.
        const effectiveMessage = message ?? ctx.resolveLastAgentMessage(conv);
        const isCancelled = ctx.isAgentMessageCancelled(effectiveMessage);
        const activityVerb = isWorking ? resolveMobileActivityVerb(buildMobileExecutionEvents(segments).events) : undefined;
        const provenance = ctx.resolveTurnProvenance(conv, effectiveMessage);
        // Agent/model identity always sits ABOVE the accordion (never inside its summary).
        syncTranscriptStandaloneTurnProvenance(body, provenance.turnAgentId, provenance.turnAgentModel);
        const accordion = wrapMobileProcessAccordion(eventTimeline, {
            isWorking,
            isError,
            isCancelled,
            elapsedMs,
            turnStartMs,
            activityVerb,
            onStopRun: ctx.resolveRunStopHandler(conv, message, isWorking),
            settled: !isWorking,
        });
        ctx.bindMobileExecutionEventTimelineFileOpen(accordion);
        body.append(accordion);
        ensureSlowTurnHint(accordion, {
            isWorking,
            turnStartMs,
            onStopTurn: ctx.resolveRunStopHandler(conv, message, isWorking) ?? (() => ctx.host.cancelOpenTranscriptStream?.()),
        });
        // Render closing narrative text segments (text after the last tool)
        // as rich content blocks — these are the agent's final answer, not
        // process prose. The timeline model captures them as closingNarrative
        // (plain text), but the final answer needs full markdown rendering.
        //
        // Repeated tool failures / retries can surface the same "error"
        // trace-event text more than once (e.g. one summary per retry
        // attempt that ends up identical) — identical closing-narrative
        // content must render ONCE, not once per occurrence. A segment whose
        // (normalized) content matches `msg.error` is skipped entirely: the
        // styled "Task failed" dialog below already shows that message, so an
        // extra unstyled copy here would just be a duplicate.
        const lastToolIndex = segments.reduce(
            (last, segment, index) => segment.type === 'tool' ? index : last,
            -1,
        );
        const seenClosingNarrativeTexts = new Set<string>();
        const normalizedFailureReason = error?.trim() ? normalizeMobileClosingNarrativeText(error) : undefined;
        for (let segmentIndex = lastToolIndex + 1; segmentIndex < segments.length; segmentIndex++) {
            const segment = segments[segmentIndex];
            if (segment.type !== 'text') {
                continue;
            }
            const text = segment.content?.trim() ?? '';
            if (!text) {
                continue;
            }
            if (ctx.isLobeWorkflowProcessText(segment.content)) {
                continue;
            }
            const action = ctx.resolveMobileClosingNarrativeAction(text, seenClosingNarrativeTexts, normalizedFailureReason, isError);
            seenClosingNarrativeTexts.add(normalizeMobileClosingNarrativeText(text));
            if (action.kind === 'skip') {
                continue;
            }
            if (action.kind === 'error-card') {
                const errorCard = createMobileClosingErrorCardElement(action.message, ctx.resolveMobileClosingErrorCardRetry());
                errorCard.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
                body.append(errorCard);
                continue;
            }
            const textBlock = ctx.toolUi.createTranscriptSegmentDetails(segment, {
                defer,
                streaming,
            });
            textBlock.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
            body.append(textBlock);
        }
        // Files Changed card only after the backend commits the final response
        // (idle/failed/cancelled) — never while streaming, working, or finalizing
        // (status still `streaming`/`settled` even when the turn looks complete).
        if (ctx.shouldShowMobileDiffSummary(conv, streaming)) {
            ctx.appendMobileDiffSummary(body, segments);
        } else {
            // Drop any premature card from an earlier paint; keep the live footer
            // only for true streaming renders.
            body.querySelector('.theia-mobile-diff-summary')?.remove();
            if (streaming && conv) {
                ctx.ensureAndSyncTranscriptLiveStatusFooter(body, segments, conv, { streaming: true });
            } else if (conv && ctx.shouldShowPinnedTranscriptLiveStatus(conv)) {
                // Visual settle while the backend is still busy — keep the pinned footer.
                ctx.removeTranscriptLiveStatusWithOrb(body);
                ctx.ensurePinnedTranscriptLiveStatus(conv);
            } else {
                ctx.removeTranscriptLiveStatusWithOrb(body);
                ctx.clearPinnedTranscriptStreamFooter(resolveTranscriptChatHostFromNode(body));
            }
        }
}

export function shouldShowMobileDiffSummaryExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined,
        renderStreaming: boolean,): boolean {
        return ctx.isConversationFinalResponseCommitted(conv, renderStreaming);
}

export function resolveRunStopHandlerExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined,
        message: QaapAgentMessageDTO | undefined,
        isWorking: boolean,): (() => void) | undefined {
        // `isWorking` is conversation-wide: with several agents in one session it is true for
        // every turn, including ones that already answered. `runActive` is the per-message flag
        // the backend sets while THAT run streams — the stop belongs only to those.
        if (!isWorking || !message?.runActive) {
            return undefined;
        }
        const userMessageId = conv && message
            ? resolveRunUserMessageId(conv.messages, message.id)
            : undefined;
        if (!conv || !userMessageId) {
            return () => ctx.host.cancelOpenTranscriptStream?.();
        }
        return () => {
            void cancelConversationRun(conv.id, userMessageId).catch(() => {
                // Backend refused the targeted cancel — fall back to stopping the session.
                ctx.host.cancelOpenTranscriptStream?.();
            });
        };
}

export function bindMobileExecutionEventTimelineFileOpenExtracted(ctx: any, root: HTMLElement): void {
        if (root.dataset.mobileToolFileOpenBound === '1') {
            return;
        }
        root.dataset.mobileToolFileOpenBound = '1';
        root.addEventListener(MOBILE_TOOL_FILE_OPEN_EVENT, event => {
            const detail = (event as CustomEvent<{ readonly filePath?: unknown }>).detail;
            const filePath = typeof detail?.filePath === 'string'
                ? detail.filePath
                : undefined;
            if (!filePath) {
                return;
            }
            event.stopPropagation();
            ctx.toolUi.handleTranscriptFileOpen(filePath);
        });
}

export function resolveLastAgentMessageExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined): QaapAgentMessageDTO | undefined {
        const messages = conv?.messages;
        if (!messages) {
            return undefined;
        }
        for (let index = messages.length - 1; index >= 0; index--) {
            if (messages[index].role === 'agent') {
                return messages[index];
            }
        }
        return undefined;
}

export function resolveTranscriptRowAgentMessageExtracted(ctx: any, row: HTMLElement | undefined,
        conv: QaapAgentConversationDTO | undefined,): QaapAgentMessageDTO | undefined {
        const messageId = row?.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
        const found = messageId ? conv?.messages.find(entry => entry.id === messageId) : undefined;
        return found ?? ctx.resolveLastAgentMessage(conv);
}

export function resolveTurnProvenanceExtracted(ctx: any, conv: QaapAgentConversationDTO | undefined,
        message: QaapAgentMessageDTO | undefined,): { readonly turnAgentId?: string; readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel } {
        if (!conv || !message) {
            return {};
        }
        const userMessageId = resolveRunUserMessageId(conv.messages, message.id);
        const userMessage = userMessageId ? conv.messages.find(entry => entry.id === userMessageId) : undefined;
        return { turnAgentId: userMessage?.turnAgentId, turnAgentModel: userMessage?.turnAgentModel };
}

export function resolveMobileClosingNarrativeActionExtracted(ctx: any, text: string,
        seenClosingNarrativeTexts: ReadonlySet<string>,
        normalizedFailureReason: string | undefined,
        isError: boolean,): MobileClosingNarrativeAction {
        const normalizedText = normalizeMobileClosingNarrativeText(text);
        if (seenClosingNarrativeTexts.has(normalizedText)) {
            // Exact duplicate of an already-rendered closing block — collapse
            // to a single occurrence instead of repeating the raw text.
            return { kind: 'skip' };
        }
        if (normalizedFailureReason !== undefined && normalizedText === normalizedFailureReason) {
            // Same message the failure dialog renders — skip the duplicate
            // instead of showing it twice.
            return { kind: 'skip' };
        }
        if (isError && MOBILE_CLOSING_TEXT_ERROR_PREFIX.test(text)) {
            // A distinct error-derived closing line with no corresponding
            // `msg.error` dialog — show it as a single, styled error card
            // (icon + message) instead of an unstyled markdown block.
            return { kind: 'error-card', message: normalizedText };
        }
        return { kind: 'text' };
}

export function resolveMobileClosingErrorCardRetryExtracted(ctx: any): (() => void) | undefined {
        if (!ctx.host.retryOpenTranscriptConversation) {
            return undefined;
        }
        return () => {
            void ctx.host.retryOpenTranscriptConversation?.();
        };
}

export function collectMobileClosingNarrativeTextsBeforeExtracted(ctx: any, segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        beforeIndex: number,): Set<string> {
        return collectMobileClosingNarrativeTextsBeforeHelper(segments, lastToolIndex, beforeIndex, content => ctx.isLobeWorkflowProcessText(content));
}

export function isClosingNarrativeSegmentSkippedExtracted(ctx: any, segment: QaapAgentMessageSegmentDTO,
        segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        segmentIndex: number,
        conv: QaapAgentConversationDTO | undefined,): boolean {
        const text = segment.type === 'text' ? (segment.content?.trim() ?? '') : '';
        if (!text) {
            return false;
        }
        const seenClosingNarrativeTexts = ctx.collectMobileClosingNarrativeTextsBefore(segments, lastToolIndex, segmentIndex);
        const error = ctx.resolveLastAgentMessageError(conv);
        const normalizedFailureReason = error?.trim() ? normalizeMobileClosingNarrativeText(error) : undefined;
        const isErrorLikely = ctx.isConversationError(conv) || MOBILE_CLOSING_TEXT_ERROR_PREFIX.test(text);
        return ctx.resolveMobileClosingNarrativeAction(
            text, seenClosingNarrativeTexts, normalizedFailureReason, isErrorLikely,
        ).kind === 'skip';
}
