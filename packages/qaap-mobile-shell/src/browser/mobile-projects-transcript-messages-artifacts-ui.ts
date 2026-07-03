// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { type QaapAgentConversationDTO, type QaapAgentConversationSummaryDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO, conversationToSummary, restoreConversationCheckpoint } from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import {
    extractLastFailedToolFromMessage,
    resolveAgentTurnFailureTechnicalContent,
} from '../common/qaap-agent-failure-message';
import { formatReadToolDetailFromArgs, formatToolActivityLabel } from '../common/qaap-agent-conversation-list-metrics';
import { classifyTranscriptToolActivityKind, excerptTranscriptThought, extractTranscriptDiffCard, extractTranscriptMcpServerLabel, hasTranscriptActivityStats, isTranscriptThoughtExcerptTruncated, isTranscriptTodoTool, parseTranscriptTodoChecklist, resolveTranscriptActivityStats, resolveTranscriptThinkingContent, resolveTranscriptToolPillDescriptors, resolveTranscriptToolRowParts, shouldOpenTranscriptToolDetails, type QaapTranscriptActivityStats } from '../common/qaap-agent-transcript-segments';
import { formatTranscriptStreamElapsed, formatTranscriptStreamTokens, isAwaitingFirstTranscriptAgentOutput, isTranscriptAgentThinkingPhase, isTranscriptComposerVisualIdle, resolveLastUserPromptChars, resolveTranscriptTraceDisplayPhase, resolveTranscriptTurnElapsedMs, resolveTranscriptTurnStartMs, resolveTranscriptTurnStreamChars, shouldExpandTranscriptInlineTimeline, shouldShowTranscriptInlineTimeline, shouldShowTranscriptStreamingActivity, shouldShowTranscriptThoughtBrief, shouldTranscriptStreamLabelShimmer } from '../common/qaap-transcript-stream-status';
import { resolveTranscriptStreamHealth, type TranscriptStreamTimeoutCause } from '../common/qaap-transcript-stream-health';
import { resolveTranscriptStreamingAgentSegments } from '../common/qaap-transcript-semantic-progress';
import { hasUnfinishedAgentWork, resolveTranscriptEffectiveStatus } from '../common/qaap-transcript-turn-status';
import { resolveTranscriptStreamingActivityFromSegments } from '../common/qaap-transcript-streaming-activity';
import type { TranscriptActivityNavigationItem, TranscriptActivityNavigateTarget, TranscriptActivityNavigationOptions } from '../common/qaap-transcript-activity-navigation';
import { groupTranscriptActivityNavigationItems, resolveTranscriptLifecycleActivityItems } from '../common/qaap-transcript-activity-navigation';
import { conversationRequestsDevPreview } from '../common/qaap-transcript-preview-offer';
import {
    resolveTranscriptBootstrapDiagnosticActivityItems,
    toTranscriptPreviewBootstrapSnapshot,
} from '../common/qaap-transcript-preview-bootstrap-failure';
import { formatTranscriptActivityStepDuration, isTranscriptActivityLiveState, type TranscriptActivityStepState } from '../common/qaap-transcript-activity-step-state';
import { formatTranscriptActivityStepMeta, TranscriptActivityTimingStore } from '../common/qaap-transcript-activity-timing';
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
    fingerprintTranscriptActivityHistoryGapSlot,
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
import { canRestoreConversationCheckpoint, annotateTranscriptActivityCheckpointIds } from '../common/qaap-transcript-checkpoint-restore';
import { createAgentSetupElement, syncAgentSetupElement, destroyAgentSetupElement, createUnicodeSpinner, destroyUnicodeSpinner } from '../common/qaap-agent-setup-phrases';
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
    refreshMobileExecutionEventTimeline,
    resolveMobileActivityVerb,
    syncMobileProcessAccordionState,
    wrapMobileProcessAccordion,
} from './qaap-execution-event-timeline';
import { ensureSlowTurnHint } from './qaap-slow-turn-hint';
import { getFileIconClass } from '../common/qaap-file-icon-utils';

const TRANSCRIPT_TRACE_STATUS_ATTR = 'data-transcript-trace-status';
const TRANSCRIPT_CHECKPOINT_RESTORE_ATTR = 'data-transcript-checkpoint-id';

const transcriptActivityTimelineResync = new WeakMap<HTMLElement, () => void>();
const transcriptToolGroupItems = new WeakMap<HTMLElement, Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>[]>();
const transcriptToolGroupUmbrella = new WeakMap<HTMLElement, ToolUmbrella>();
const transcriptSummarySpinners = new WeakMap<HTMLElement, HTMLElement>();
const pendingExecutionTimelineRefreshSegments = new WeakMap<HTMLElement, readonly QaapAgentMessageSegmentDTO[]>();
const skippedExecutionTimelineRefreshRows = new WeakSet<HTMLElement>();

export interface TranscriptActivityTimelineOptions {
    /** Last N steps in chat; omit or ≤0 to show the full trace (Plan tab). */
    readonly maxVisibleItems?: number;
    readonly variant?: 'inline' | 'plan';
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

interface TranscriptActivityTimelineItem extends TranscriptActivityNavigationItem { }

function isTranscriptExecutionTimelineNarrative(item: TranscriptActivityTimelineItem): boolean {
    return item.timelineRole === 'narrative';
}

function transcriptExecutionTimelineCount(item: TranscriptActivityTimelineItem): number {
    return Math.max(1, item.groupCount ?? item.segmentIndices?.length ?? 1);
}

function isTranscriptVerificationCommand(command: string | undefined): boolean {
    return !!command && /(^|[\s"'`:,{[])(npm|yarn|pnpm|npx|node)?\s*(run\s+)?(test|vitest|lint|typecheck|tsc)(:|\b)/i.test(command);
}

function resolveTranscriptExecutionToolGroupParts(
    item: TranscriptActivityTimelineItem,
): Pick<TranscriptActivityTimelineItem, 'label' | 'verb' | 'detail' | 'tail' | 'timelineRole'> {
    const count = transcriptExecutionTimelineCount(item);
    const plural = (one: string, many: string): string => count === 1 ? one : many;
    if (item.toolKind === 'reading') {
        return {
            timelineRole: 'toolGroup',
            label: count === 1 ? 'Read 1 file' : `Read ${count} files`,
            verb: 'Read',
            detail: count === 1 ? '1 file' : `${count} files`,
            tail: undefined,
        };
    }
    if (item.toolKind === 'searching') {
        return {
            timelineRole: 'toolGroup',
            label: count === 1 ? 'Explore 1 search' : `Explore ${count} searches`,
            verb: 'Explore',
            detail: count === 1 ? '1 search' : `${count} searches`,
            tail: undefined,
        };
    }
    if (item.toolKind === 'editing') {
        return {
            timelineRole: 'toolGroup',
            label: count === 1 ? 'Update 1 file' : `Update ${count} files`,
            verb: 'Update',
            detail: count === 1 ? '1 file' : `${count} files`,
            tail: undefined,
        };
    }
    if (item.toolKind === 'terminal') {
        const verification = isTranscriptVerificationCommand(item.detail);
        const verb = verification ? 'Verification' : 'Run';
        const unit = verification ? plural('check', 'checks') : plural('command', 'commands');
        return {
            timelineRole: 'toolGroup',
            label: `${verb} ${count} ${unit}`,
            verb,
            detail: `${count} ${unit}`,
            tail: undefined,
        };
    }
    return {
        timelineRole: 'toolGroup',
        label: count === 1 ? 'Use 1 tool' : `Use ${count} tools`,
        verb: 'Use',
        detail: count === 1 ? '1 tool' : `${count} tools`,
        tail: undefined,
    };
}

function resolveTranscriptExecutionNarrative(item: TranscriptActivityTimelineItem): string {
    if (item.toolKind === 'reading') {
        return "I'm checking the relevant files.";
    }
    if (item.toolKind === 'searching') {
        return "I'm inspecting the repository structure.";
    }
    if (item.toolKind === 'editing') {
        return "I'm updating the implementation.";
    }
    if (item.toolKind === 'terminal') {
        return isTranscriptVerificationCommand(item.detail)
            ? "I'm validating the implementation."
            : "I'm running the next command.";
    }
    return "I'm applying the next step.";
}

function createTranscriptExecutionNarrativeItem(label: string, anchor: TranscriptActivityTimelineItem): TranscriptActivityTimelineItem {
    return {
        label,
        timelineRole: 'narrative',
        state: 'success',
        timestamp: anchor.timestamp,
        segmentIndex: anchor.segmentIndex,
    };
}

function buildTranscriptExecutionTimelineItems(items: readonly TranscriptActivityTimelineItem[]): TranscriptActivityTimelineItem[] {
    const timeline: TranscriptActivityTimelineItem[] = [];
    for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        if (!item.toolKind) {
            if (item.verb === 'Preparing') {
                timeline.push({
                    ...item,
                    timelineRole: 'result',
                    label: item.label,
                    verb: undefined,
                    detail: undefined,
                    tail: undefined,
                });
            } else {
                timeline.push(item);
            }
            continue;
        }
        const previous = timeline[timeline.length - 1];
        if (!previous || !isTranscriptExecutionTimelineNarrative(previous)) {
            timeline.push(createTranscriptExecutionNarrativeItem(resolveTranscriptExecutionNarrative(item), item));
        }
        timeline.push({
            ...item,
            ...resolveTranscriptExecutionToolGroupParts(item),
        });
    }
    return timeline;
}

/** Leading "Error: " marker prepended by {@link traceEventsToSegments} when it
 *  converts an `error` trace event into a plain text segment. Stripped before
 *  comparing closing-narrative text against `msg.error` (which never carries
 *  the prefix) so identical content is recognized as a duplicate regardless
 *  of which side added the marker. */
const MOBILE_CLOSING_TEXT_ERROR_PREFIX = /^error:\s*/i;

/** Normalizes closing-narrative text for duplicate detection: trims and
 *  strips a leading "Error: " marker so a trace-derived error segment and the
 *  canonical `msg.error` string compare equal. */
function normalizeMobileClosingNarrativeText(text: string): string {
    return text.trim().replace(MOBILE_CLOSING_TEXT_ERROR_PREFIX, '').trim();
}

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

interface LazyTranscriptToolPillPayload {
    readonly segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
    readonly conv: QaapAgentConversationDTO | undefined;
    readonly kind: string;
    readonly finished: boolean;
    readonly resultFailed: boolean;
}

const lazyTranscriptToolPillBodies = new WeakMap<HTMLDetailsElement, LazyTranscriptToolPillPayload>();

export class MobileProjectsTranscriptMessagesArtifactsUi {
    protected readonly activityTiming = new TranscriptActivityTimingStore();

    constructor(
        protected readonly host: MobileProjectsTranscriptMessagesHost,
        protected readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        protected readonly resolversUi: MobileProjectsTranscriptMessagesResolversUi,
        protected readonly toolUi: MobileProjectsTranscriptMessagesToolUi,
        protected readonly onConversationMutation?: (conv: QaapAgentConversationDTO) => void,
    ) { }

    protected queueExecutionTimelineRefresh(row: HTMLElement, segments: readonly QaapAgentMessageSegmentDTO[]): void {
        pendingExecutionTimelineRefreshSegments.set(row, segments);
    }

    protected skipExecutionTimelineRefresh(row: HTMLElement): void {
        skippedExecutionTimelineRefreshRows.add(row);
    }

    protected consumeExecutionTimelineRefresh(row: HTMLElement): readonly QaapAgentMessageSegmentDTO[] | undefined {
        const segments = pendingExecutionTimelineRefreshSegments.get(row);
        if (segments) {
            pendingExecutionTimelineRefreshSegments.delete(row);
            skippedExecutionTimelineRefreshRows.delete(row);
        }
        return segments;
    }

    protected consumeSkippedExecutionTimelineRefresh(row: HTMLElement): boolean {
        if (!skippedExecutionTimelineRefreshRows.has(row)) {
            return false;
        }
        skippedExecutionTimelineRefreshRows.delete(row);
        return true;
    }

    protected didExecutionToolSegmentsChange(
        previousSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
    ): boolean {
        const length = Math.max(previousSegments.length, nextSegments.length);
        for (let index = 0; index < length; index++) {
            const previous = previousSegments[index];
            const next = nextSegments[index];
            if (previous?.type !== 'tool' && next?.type !== 'tool') {
                continue;
            }
            if (previous?.type !== 'tool' || next?.type !== 'tool') {
                return true;
            }
            if (previous.toolUseId !== next.toolUseId
                || previous.name !== next.name
                || previous.finished !== next.finished) {
                return true;
            }
            // O(1) length pre-check before walking the full common prefix —
            // args/result can be large while streaming, and a length
            // mismatch alone already proves a change without comparing
            // every character.
            if ((previous.args?.length ?? 0) !== (next.args?.length ?? 0)
                || (previous.result?.length ?? 0) !== (next.result?.length ?? 0)) {
                return true;
            }
            if (previous.args !== next.args || previous.result !== next.result) {
                return true;
            }
        }
        return false;
    }

    createTranscriptAgentSegmentsRow(
        segments: QaapAgentMessageSegmentDTO[],
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
        },
    ): HTMLElement {
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
            this.renderMobileExecutionEventTimeline(body, segments, {
                streaming,
                defer,
                conv,
                error,
                message: options?.message,
            });
        } else {
            // No tools yet — render thinking content (if any) as a thought brief,
            // then visible text segments. This preserves the thinking-phase UX
            // (collapsible reasoning block with live indicator) before the first
            // tool arrives. When tools arrive later via streaming, the row is
            // upgraded to the Codex-style timeline in patchStreamingActivityTimeline.
            const thoughtBrief = this.createTranscriptThoughtBriefBlock(segments, {
                streaming,
                conv,
            });
            if (thoughtBrief) {
                body.append(thoughtBrief);
            }
            if (streaming) {
                const status = document.createElement('div');
                status.className = 'theia-mobile-agent-trace-status';
                status.setAttribute(TRANSCRIPT_TRACE_STATUS_ATTR, 'true');
                status.hidden = true;
                body.append(status);
            }
            for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
                const segment = segments[segmentIndex];
                if (segment.type === 'text' && (segment.content?.trim() ?? '').length > 0) {
                    const textBlock = this.toolUi.createTranscriptSegmentDetails(segment, {
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
            const canRetry = conv?.status === 'failed' && !!this.host.retryOpenFailedConversationTask;
            body.append(this.toolUi.createTranscriptAgentFailureDialog(
                error,
                resolveAgentTurnFailureTechnicalContent({ role: 'agent', content: '', segments }),
                {
                    failedToolName: failedTool?.name,
                    onRetry: canRetry ? () => this.host.retryOpenFailedConversationTask?.() : undefined,
                },
            ));
        }
        row.append(body);
        if (streaming) {
            this.ensureTranscriptStreamStallWatch(row);
        }
        return row;
    }

    /**
     * Renders the Codex-style execution event timeline into `body`:
     *   1. The execution event timeline (events with narrative + collapsed tool groups)
     *   2. A trace status element (when streaming)
     *   3. Closing narrative text segments (the agent's final answer, after the last tool)
     *   4. The diff summary (when not streaming)
     *
     * Used both for initial render and for upgrading a row that was created
     * during the thinking phase (no tools) and later received tool segments.
     */
    protected renderMobileExecutionEventTimeline(
        body: HTMLElement,
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
        },
    ): void {
        const { streaming, defer, conv, error, message } = options;
        const eventTimeline = createMobileExecutionEventTimeline(segments);
        // Wrap the timeline in a process accordion (Codex-style "Processed in").
        const isWorking = streaming && this.isConversationWorking(conv);
        const isError = this.isConversationError(conv);
        // Cancellation must be derived from THIS message, not merely the
        // conversation's last agent message -- each agent message renders its
        // own accordion, and in a multi-turn conversation a historical
        // (already-settled) turn's accordion would otherwise be mislabeled
        // whenever a later turn happened to end up cancelled.
        const isCancelled = this.isAgentMessageCancelled(message ?? this.resolveLastAgentMessage(conv));
        const elapsedMs = this.resolveConversationElapsedMs(conv);
        const turnStartMs = conv ? resolveTranscriptTurnStartMs(conv.messages) : undefined;
        const activityVerb = isWorking ? resolveMobileActivityVerb(buildMobileExecutionEvents(segments).events) : undefined;
        const accordion = wrapMobileProcessAccordion(eventTimeline, { isWorking, isError, isCancelled, elapsedMs, turnStartMs, activityVerb });
        body.append(accordion);
        ensureSlowTurnHint(accordion, { isWorking, turnStartMs, onStopTurn: () => this.host.cancelOpenTranscriptStream?.() });
        if (streaming) {
            const status = document.createElement('div');
            status.className = 'theia-mobile-agent-trace-status';
            status.setAttribute(TRANSCRIPT_TRACE_STATUS_ATTR, 'true');
            status.hidden = true;
            body.append(status);
        }
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
            if (this.isLobeWorkflowProcessText(segment.content)) {
                continue;
            }
            const action = this.resolveMobileClosingNarrativeAction(text, seenClosingNarrativeTexts, normalizedFailureReason, isError);
            seenClosingNarrativeTexts.add(normalizeMobileClosingNarrativeText(text));
            if (action.kind === 'skip') {
                continue;
            }
            if (action.kind === 'error-card') {
                const errorCard = createMobileClosingErrorCardElement(action.message, this.resolveMobileClosingErrorCardRetry());
                errorCard.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
                body.append(errorCard);
                continue;
            }
            const textBlock = this.toolUi.createTranscriptSegmentDetails(segment, {
                defer,
                streaming,
            });
            textBlock.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
            body.append(textBlock);
        }
        // Diff summary as the natural closing of the execution story
        if (!streaming) {
            this.appendMobileDiffSummary(body, segments);
        }
    }

    /** True when the conversation is still actively streaming/working. */
    protected isConversationWorking(conv: QaapAgentConversationDTO | undefined): boolean {
        if (!conv) {
            return false;
        }
        return hasUnfinishedAgentWork(conv) || conv.status === 'streaming';
    }

    /** True when the conversation ended in a failure. */
    protected isConversationError(conv: QaapAgentConversationDTO | undefined): boolean {
        return conv?.status === 'failed';
    }

    /** The most recent agent message in the conversation, if any. Walks
     *  backwards without allocating a reversed copy -- called on every
     *  streaming tick, so avoiding the `[...].reverse()` allocation matters. */
    protected resolveLastAgentMessage(conv: QaapAgentConversationDTO | undefined): QaapAgentMessageDTO | undefined {
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

    /** The failure reason recorded on the conversation's last agent message, if any. */
    protected resolveLastAgentMessageError(conv: QaapAgentConversationDTO | undefined): string | undefined {
        return this.resolveLastAgentMessage(conv)?.error;
    }

    /**
     * Resolves the specific agent message a rendered `row` represents: the
     * conversation message matching `row`'s `data-transcript-message-id`
     * attribute, falling back to the conversation's last agent message when
     * the attribute isn't set yet (e.g. before the row has been marked) or
     * doesn't match. Mirrors the message resolution in
     * {@link resolveTranscriptActivityRowContext}, so that cancellation
     * (and other message-scoped state) is derived from the same message in
     * both places.
     */
    protected resolveTranscriptRowAgentMessage(
        row: HTMLElement | undefined,
        conv: QaapAgentConversationDTO | undefined,
    ): QaapAgentMessageDTO | undefined {
        const messageId = row?.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
        const found = messageId ? conv?.messages.find(entry => entry.id === messageId) : undefined;
        return found ?? this.resolveLastAgentMessage(conv);
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
        return message?.traceEvents?.some(event => event.type === 'run_cancelled') ?? false;
    }

    /**
     * Decides how a single closing-narrative text segment should render:
     * skipped (exact duplicate of an earlier closing block, or the same
     * message the "Task failed" dialog already shows), a compact error card
     * (a distinct error-derived line with no corresponding `msg.error`
     * dialog), or a normal rich-content text block. Shared by the full render
     * path and the streaming fast-path so duplicate error text is suppressed
     * consistently regardless of which path first observes the segment — see
     * {@link MobileClosingNarrativeAction}.
     */
    protected resolveMobileClosingNarrativeAction(
        text: string,
        seenClosingNarrativeTexts: ReadonlySet<string>,
        normalizedFailureReason: string | undefined,
        isError: boolean,
    ): MobileClosingNarrativeAction {
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

    /**
     * Resolves the optional "Retry" action for a closing error card, or
     * undefined when the host doesn't support it. Wired to
     * {@link MobileProjectsTranscriptMessagesHost.retryOpenTranscriptConversation},
     * which resolves the conversation to retry the same way
     * `cancelOpenTranscriptStream` resolves the one to cancel: the transcript
     * sheet's open project/summary when a sheet is open, falling back to
     * whichever conversation the Agents Hub inline shell is showing
     * otherwise. This dual resolution matters — the error card renders
     * wherever the conversation happens to be displayed, and a retry wired
     * only to the transcript-sheet state would silently no-op on the Agents
     * Hub inline surface, which is the default (non-sheet) surface.
     */
    protected resolveMobileClosingErrorCardRetry(): (() => void) | undefined {
        if (!this.host.retryOpenTranscriptConversation) {
            return undefined;
        }
        return () => {
            void this.host.retryOpenTranscriptConversation?.();
        };
    }

    /**
     * Recomputes the (normalized) set of closing-narrative text strictly
     * before `beforeIndex`, so a newly-arrived closing-narrative segment (the
     * streaming fast-path in {@link appendStreamingAgentTextSegment}) can be
     * checked against everything already rendered — the same duplicate check
     * {@link renderMobileExecutionEventTimeline} applies during a full render.
     */
    protected collectMobileClosingNarrativeTextsBefore(
        segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        beforeIndex: number,
    ): Set<string> {
        const seen = new Set<string>();
        for (let index = lastToolIndex + 1; index < beforeIndex; index++) {
            const segment = segments[index];
            if (segment?.type !== 'text') {
                continue;
            }
            const text = segment.content?.trim() ?? '';
            if (!text || this.isLobeWorkflowProcessText(segment.content)) {
                continue;
            }
            seen.add(normalizeMobileClosingNarrativeText(text));
        }
        return seen;
    }

    /**
     * True when the closing-narrative text `segment` at `segmentIndex` would be
     * DELIBERATELY skipped (no DOM host emitted) by
     * {@link resolveMobileClosingNarrativeAction} — a duplicate of an earlier
     * closing block, or identical to the message's `error` (already shown by
     * the failure dialog). Used by {@link patchStreamingAgentTextSegments} to
     * tell an intentional hole (keep patching) apart from a genuinely missing
     * block (rebuild once). Mirrors the exact decision inputs the full render
     * path and the streaming append fast-path use, so all three agree on which
     * closing segments are visible.
     */
    protected isClosingNarrativeSegmentSkipped(
        segment: QaapAgentMessageSegmentDTO,
        segments: readonly QaapAgentMessageSegmentDTO[],
        lastToolIndex: number,
        segmentIndex: number,
        conv: QaapAgentConversationDTO | undefined,
    ): boolean {
        const text = segment.type === 'text' ? (segment.content?.trim() ?? '') : '';
        if (!text) {
            return false;
        }
        const seenClosingNarrativeTexts = this.collectMobileClosingNarrativeTextsBefore(segments, lastToolIndex, segmentIndex);
        const error = this.resolveLastAgentMessageError(conv);
        const normalizedFailureReason = error?.trim() ? normalizeMobileClosingNarrativeText(error) : undefined;
        const isErrorLikely = this.isConversationError(conv) || MOBILE_CLOSING_TEXT_ERROR_PREFIX.test(text);
        return this.resolveMobileClosingNarrativeAction(
            text, seenClosingNarrativeTexts, normalizedFailureReason, isErrorLikely,
        ).kind === 'skip';
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
        if (!conv) {
            return undefined;
        }
        const startAt = resolveTranscriptTurnStartMs(conv.messages) ?? conv.createdAt;
        if (this.isConversationWorking(conv)) {
            return Math.max(0, Date.now() - startAt);
        }
        // While streaming, updatedAt may not have advanced yet — use the last
        // agent message's createdAt as the upper bound in that case.
        const lastAgentCreatedAt = conv.messages.length > 0
            ? conv.messages[conv.messages.length - 1].createdAt
            : undefined;
        const endAt = conv.updatedAt >= startAt
            ? conv.updatedAt
            : (typeof lastAgentCreatedAt === 'number' && lastAgentCreatedAt >= startAt
                ? lastAgentCreatedAt
                : undefined);
        if (typeof endAt === 'number' && endAt >= startAt) {
            return endAt - startAt;
        }
        return undefined;
    }

    /**
     * Updates the process accordion state (auto-expand/collapse + label) for
     * a row based on the current conversation status. Called during streaming
     * patches and finalization.
     */
    protected syncRowProcessAccordion(
        row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        streaming: boolean,
    ): void {
        const accordion = findMobileProcessAccordion(row);
        if (!accordion) {
            return;
        }
        const isWorking = streaming && this.isConversationWorking(conv);
        const turnStartMs = conv ? resolveTranscriptTurnStartMs(conv.messages) : undefined;
        // `row` represents one specific agent message, not necessarily the
        // conversation's last one -- resolve it via the row's message-id
        // attribute so a historical (already-settled) turn's accordion isn't
        // mislabeled as cancelled just because a later turn ended up
        // cancelled.
        const message = this.resolveTranscriptRowAgentMessage(row, conv);
        const activityVerb = isWorking ? resolveMobileActivityVerb(buildMobileExecutionEvents(segments).events) : undefined;
        syncMobileProcessAccordionState(accordion, {
            isWorking,
            isError: this.isConversationError(conv),
            isCancelled: this.isAgentMessageCancelled(message),
            elapsedMs: this.resolveConversationElapsedMs(conv),
            turnStartMs,
            activityVerb,
            // Only the finalize path calls with streaming=false, and it does so
            // AFTER appending the closing narrative + diff summary — that is
            // the one moment auto-collapse is allowed. Streaming syncs must
            // never collapse, even if the working flag flickers between tools.
            settled: !streaming,
        });
        // Re-ensure the slow-turn hint on every sync (runs on every streaming
        // tick): this is what lets the hint survive `accordion` being wholly
        // replaced by a full timeline rebuild mid-stream, and what removes it
        // promptly once the turn settles.
        ensureSlowTurnHint(accordion, { isWorking, turnStartMs, onStopTurn: () => this.host.cancelOpenTranscriptStream?.() });
    }

    /**
     * Upgrades a row from the thinking-phase representation (thought brief +
     * text blocks) to the Codex-style execution event timeline. Removes all
     * legacy elements (thought brief, activity timeline, artifacts, tool pills,
     * process-prose text blocks) and renders the new timeline + closing
     * narrative + diff summary in their place.
     *
     * Called when tool segments arrive during streaming but the row was
     * initially created without tools (thinking phase), or when a row settles
     * with tools but was never upgraded.
     */
    protected upgradeToMobileExecutionEventTimeline(
        row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: { readonly streaming: boolean; readonly conv?: QaapAgentConversationDTO },
    ): void {
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return;
        }
        // Remove legacy elements: thought brief, activity timeline, artifacts,
        // and all text blocks (process-prose text blocks will be re-rendered
        // as narrative inside the timeline; closing-narrative text blocks will
        // be re-rendered after the timeline).
        segmentsBody.querySelectorAll(
            `[${TRANSCRIPT_THOUGHT_BRIEF_ATTR}], [${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}], ` +
            `.theia-mobile-agent-transcript-artifacts, [${TRANSCRIPT_SEGMENT_INDEX_ATTR}]`,
        ).forEach(el => el.remove());
        // Remove any leftover trace status (will be re-added by the helper if streaming)
        segmentsBody.querySelector('.theia-mobile-agent-trace-status')?.remove();
        // Render the Codex-style timeline + closing narrative + diff summary.
        // Neither `error` nor the specific message are part of `options` here
        // (callers only have `conv`) — resolve the message `row` represents
        // (via its message-id attribute) so the same duplicate-error
        // suppression AND cancellation state that a fresh render would use
        // apply on this upgrade path too, instead of whichever agent message
        // happens to be last in the conversation.
        const message = this.resolveTranscriptRowAgentMessage(row, options.conv);
        this.renderMobileExecutionEventTimeline(segmentsBody, segments, {
            ...options,
            error: message?.error,
            message,
        });
    }

    protected resolveLobeVisibleTextSegmentIndexes(
        segments: readonly QaapAgentMessageSegmentDTO[],
        activityTimelineShown: boolean,
    ): ReadonlySet<number> {
        const textIndexes = segments
            .map((segment, index) => segment.type === 'text' && segment.content.trim() ? index : -1)
            .filter(index => index >= 0);
        if (textIndexes.length === 0) {
            return new Set();
        }
        const hasTools = segments.some(segment => segment.type === 'tool');
        if (!activityTimelineShown && !hasTools) {
            return new Set(textIndexes);
        }
        const lastToolIndex = segments.reduce(
            (last, segment, index) => segment.type === 'tool' ? index : last,
            -1,
        );
        const visible = textIndexes.filter(index => {
            const segment = segments[index];
            if (segment?.type !== 'text') {
                return false;
            }
            if (index <= lastToolIndex) {
                return false;
            }
            return !this.isLobeWorkflowProcessText(segment.content);
        });
        return new Set(visible);
    }

    protected shouldRenderLobeTextSegment(
        segments: readonly QaapAgentMessageSegmentDTO[],
        segmentIndex: number,
        activityTimelineShown: boolean,
    ): boolean {
        return this.resolveLobeVisibleTextSegmentIndexes(segments, activityTimelineShown).has(segmentIndex);
    }

    protected isLobeWorkflowProcessText(content: string): boolean {
        const normalized = this.contentUi.cleanTranscriptDisplayText(content).trim();
        if (!normalized) {
            return true;
        }
        if (normalized.length > 280) {
            return false;
        }
        if (/^#{1,3}\s+\S/.test(normalized) || /^\s*[-*]\s+\S/m.test(normalized) || /\n\s*[-*]\s+\S/.test(normalized)) {
            return false;
        }
        if (/\b(summary|findings|risks|recommendations|review|result|changes|issues)\b/i.test(normalized)
            && /[:\n]/.test(normalized)) {
            return false;
        }
        return /^(let me|i['’]?ll|i will|i need to|i’m going to|i am going to|now\b|next\b|checking\b|reading\b|looking\b|fetching\b|running\b|reviewing\b|analyzing\b|searching\b)/i
            .test(normalized);
    }

    /**
     * Re-render closing narrative text blocks (text after the last tool) with
     * the final segment content. Used as a safety net during finalization to
     * ensure the agent's final answer is complete even if the last streaming
     * patch didn't apply. Only updates existing blocks; does not create new ones.
     */
    protected refreshMobileClosingNarrativeBlocks(
        segmentsBody: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
    ): void {
        const lastToolIndex = segments.reduce(
            (last, segment, index) => segment.type === 'tool' ? index : last,
            -1,
        );
        for (let segmentIndex = lastToolIndex + 1; segmentIndex < segments.length; segmentIndex++) {
            const segment = segments[segmentIndex];
            if (segment.type !== 'text') {
                continue;
            }
            const text = segment.content?.trim() ?? '';
            if (!text) {
                continue;
            }
            if (this.isLobeWorkflowProcessText(segment.content)) {
                continue;
            }
            const host = segmentsBody.querySelector<HTMLElement>(
                `[${TRANSCRIPT_SEGMENT_INDEX_ATTR}="${segmentIndex}"]`,
            );
            // Closing error cards (see renderMobileExecutionEventTimeline) are
            // not markdown blocks — refreshing one here would clobber its
            // icon + message structure with the raw markdown renderer.
            if (host && !host.classList.contains(MOBILE_CLOSING_ERROR_CARD_CLASS)) {
                this.toolUi.renderTranscriptRichContent(host, segment.content ?? '', { streaming: false });
            }
        }
    }

    /**
     * Append the Codex-style diff summary (the natural closing of the execution
     * story) to `segmentsBody`, removing any previously-rendered one first.
     * Extracted so both initial render and streaming finalization can share it.
     */
    protected appendMobileDiffSummary(
        segmentsBody: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
    ): void {
        // Remove any existing diff summary so re-calling this is idempotent.
        segmentsBody.querySelector('.theia-mobile-diff-summary')?.remove();
        const mutableSegments = [...segments];
        const changedFiles = this.resolversUi.resolveTranscriptChangedFiles(mutableSegments);
        if (changedFiles.length > 0) {
            const diffSummary = createMobileDiffSummaryElement(
                changedFiles.length,
                changedFiles.filter(f => f.kind === 'created').length,
                changedFiles.filter(f => f.kind === 'edited').length,
                0,
                changedFiles.map(f => ({
                    name: f.path.split('/').pop() ?? f.path,
                    type: f.kind === 'created' ? 'add' : 'modify',
                    added: f.added,
                    removed: f.removed,
                })),
            );
            segmentsBody.append(diffSummary);
        } else {
            // No per-file change set — fall back to aggregate line stats
            // (parsed from diff hunks embedded in tool output). Use the
            // line-level summary builder so we render "+N / -N" without
            // claiming a misleading file count.
            const diffStats = this.resolversUi.resolveTranscriptDiffStats(mutableSegments);
            if (diffStats && (diffStats.added > 0 || diffStats.removed > 0)) {
                const diffSummary = createMobileLineDiffSummaryElement(diffStats.added, diffStats.removed);
                segmentsBody.append(diffSummary);
            }
        }
    }

    /**
     * When a turn becomes visually settled while the backend is still attached, collapse the trace
     * and mount deferred tool artifacts that were hidden during streaming.
     */
    finalizeStreamingAgentTrace(
        row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO,
    ): void {
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return;
        }
        // Codex-style execution event timeline: rebuild as a finalized (non-streaming) timeline.
        if (hasMobileExecutionEventTimeline(row)) {
            const hasTools = segments.some(s => s.type === 'tool');
            if (hasTools) {
                refreshMobileExecutionEventTimeline(segmentsBody, segments);
            }
            // Re-render closing narrative text blocks with final content as a
            // safety net — if the last streaming patch didn't apply (e.g. a
            // race between the final SSE frame and settle), the blocks could
            // have stale content. This ensures the final answer is complete.
            this.refreshMobileClosingNarrativeBlocks(segmentsBody, segments);
            // Append the diff summary as the natural closing of the execution
            // story. During streaming the row was created without it; now that
            // the turn has settled we add it. The helper is idempotent.
            this.appendMobileDiffSummary(segmentsBody, segments);
            // Sync the process accordion: collapse on success, stay open on error.
            this.syncRowProcessAccordion(row, segments, conv, false);
            row.classList.remove('theia-mod-stream-stalled');
            return;
        }
        // Upgrade path: if the row was never upgraded during streaming (e.g. it
        // was created during thinking and tools arrived but the streaming patch
        // didn't run), upgrade it now to the Codex-style timeline.
        if (segments.some(s => s.type === 'tool')) {
            this.upgradeToMobileExecutionEventTimeline(row, segments, { streaming: false, conv });
            row.classList.remove('theia-mod-stream-stalled');
            return;
        }
        if (!shouldShowTranscriptThoughtBrief(segments, false, {
            userPromptChars: resolveLastUserPromptChars(conv.messages),
            hasActivityStats: hasTranscriptActivityStats(resolveTranscriptActivityStats(segments)),
            thinkingContent: resolveTranscriptThinkingContent(segments),
        })) {
            segmentsBody.querySelector(`[${TRANSCRIPT_THOUGHT_BRIEF_ATTR}]`)?.remove();
        }
        const timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        if (timeline) {
            timeline.removeAttribute('data-transcript-timeline-user-toggled');
            const items = buildTranscriptExecutionTimelineItems(this.resolveTranscriptActivityItemsForDisplay([...segments], { row, conv }));
            this.syncTranscriptActivityTimelineElement(timeline, items, {
                streaming: false,
                segments,
                expanded: false,
                conv,
                row,
            });
            segmentsBody.querySelectorAll('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')
                .forEach(element => element.remove());
        }
        if (!timeline && !segmentsBody.querySelector('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')) {
            const toolPills = this.createTranscriptToolPillsStrip([...segments], conv);
            if (toolPills) {
                let artifacts = segmentsBody.querySelector<HTMLElement>('.theia-mobile-agent-transcript-artifacts');
                if (!artifacts) {
                    artifacts = document.createElement('div');
                    artifacts.className = 'theia-mobile-agent-transcript-artifacts';
                    segmentsBody.append(artifacts);
                }
                artifacts.insertBefore(toolPills, artifacts.firstChild);
            }
        }
        row.classList.remove('theia-mod-stream-stalled');
    }

    scrollTranscriptStreamingTraceIntoView(options?: { readonly expandTimeline?: boolean }): void {
        const chatHost = this.host.transcriptChatHost;
        if (!chatHost?.isConnected) {
            return;
        }
        const messageHost = chatHost.querySelector('.theia-mobile-agent-transcript-real-chat')
            ?? chatHost.querySelector('.theia-mobile-agent-transcript');
        if (!(messageHost instanceof HTMLElement)) {
            return;
        }
        const row = messageHost.querySelector<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-agent.theia-mod-streaming')
            ?? [...messageHost.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-agent')].at(-1);
        if (!row) {
            return;
        }
        const timeline = row.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        if (options?.expandTimeline && timeline instanceof HTMLDetailsElement) {
            timeline.open = true;
        }
        const thought = row.querySelector('.theia-mobile-agent-thought-brief');
        const target = timeline ?? thought ?? row;
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    protected handleTranscriptActivityNavigation(
        item: TranscriptActivityNavigationItem,
        ownerRow: HTMLElement,
    ): void {
        if (item.navigate === 'file' && item.filePath) {
            this.toolUi.handleTranscriptFileOpen(item.filePath);
            return;
        }
        if (item.navigate === 'terminal') {
            const { project, summary } = this.resolveTranscriptActivityExecutionContext();
            if (project && summary) {
                this.host.executionSurfaceTabsUi.selectTranscriptTab('terminal', project, summary);
                return;
            }
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/transcriptOpenTerminalUnavailable', 'Terminal is unavailable for this session'),
                { kind: 'warning', duration: 2200 },
            );
            return;
        }
        if (item.navigate === 'thought') {
            const segmentIndex = item.segmentIndex;
            const thinkingDetails = ownerRow.querySelector<HTMLDetailsElement>(
                segmentIndex !== undefined
                    ? `.theia-mobile-agent-activity-thinking[data-transcript-thinking-segment="${segmentIndex}"]`
                    : '.theia-mobile-agent-activity-thinking',
            );
            if (thinkingDetails) {
                thinkingDetails.open = true;
                thinkingDetails.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                return;
            }
            const brief = ownerRow.querySelector('.theia-mobile-agent-thought-brief');
            if (brief instanceof HTMLDetailsElement) {
                brief.open = true;
                brief.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    protected resolveTranscriptActivityExecutionContext(): {
        project: MobileProjectEntry | undefined;
        summary: QaapAgentConversationSummaryDTO | undefined;
    } {
        let summary = this.host.transcriptOpenSummary ?? this.host.transcriptComposerSummary;
        let project = this.host.transcriptOpenProject ?? this.host.transcriptComposerProject;
        if (!summary && this.host.transcriptLastConv) {
            summary = conversationToSummary(this.host.transcriptLastConv);
        }
        if (!summary && this.host.transcriptOpenSummaryId) {
            summary = this.host.conversations?.findSummaryById(this.host.transcriptOpenSummaryId);
        }
        if (!project && summary) {
            const summaryCwd = summary.cwd?.trim().toLowerCase();
            project = this.host.projects.find(entry => {
                const projectCwd = this.host.projectsService.getProjectCwd(entry)?.trim().toLowerCase();
                return !!summaryCwd && !!projectCwd && projectCwd === summaryCwd;
            });
        }
        if (!project) {
            project = this.host.projects.find(entry => entry.isCurrent) ?? this.host.projects[0];
        }
        return { project, summary };
    }

    protected attachTranscriptActivityItemAction(
        li: HTMLElement,
        item: TranscriptActivityNavigationItem,
        _ownerRow: HTMLElement,
    ): void {
        li.removeAttribute('data-transcript-activity-action');
        li.removeAttribute('data-transcript-activity-file-path');
        li.removeAttribute('data-transcript-activity-segment-index');
        li.classList.remove('theia-mod-clickable');
        if (!item.navigate || item.thinkingContent || item.navigate === 'thought') {
            li.removeAttribute('role');
            li.removeAttribute('tabindex');
            li.removeAttribute('aria-label');
            return;
        }
        li.classList.add('theia-mod-clickable');
        li.dataset.transcriptActivityAction = item.navigate;
        if (item.filePath) {
            li.dataset.transcriptActivityFilePath = item.filePath;
        }
        if (item.segmentIndex !== undefined) {
            li.dataset.transcriptActivitySegmentIndex = String(item.segmentIndex);
        }
        if (!li.hasAttribute('tabindex')) {
            li.tabIndex = 0;
        }
        li.setAttribute('role', 'button');
        const hint = item.navigate === 'file'
            ? nls.localize('qaap/mobileProjects/transcriptOpenFileInFiles', 'Open in Files preview')
            : item.navigate === 'terminal'
                ? nls.localize('qaap/mobileProjects/transcriptOpenTerminal', 'Open terminal')
                : nls.localize('qaap/mobileProjects/transcriptOpenThought', 'Show reasoning');
        li.setAttribute('aria-label', `${item.label}. ${hint}`);
    }

    protected bindTranscriptActivityListActions(list: HTMLElement, ownerRow: HTMLElement): void {
        if (list.dataset.transcriptActivityListBound === '1') {
            return;
        }
        list.dataset.transcriptActivityListBound = '1';
        const activate = (li: HTMLElement): void => {
            const navigate = li.dataset.transcriptActivityAction as TranscriptActivityNavigateTarget | undefined;
            if (!navigate) {
                return;
            }
            const navigationItem: TranscriptActivityNavigationItem = {
                label: li.getAttribute('aria-label') ?? '',
                state: 'success',
                navigate,
                filePath: li.dataset.transcriptActivityFilePath,
                segmentIndex: li.dataset.transcriptActivitySegmentIndex
                    ? Number(li.dataset.transcriptActivitySegmentIndex)
                    : undefined,
            };
            this.handleTranscriptActivityNavigation(navigationItem, ownerRow);
        };
        list.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const chip = target.closest('.theia-mobile-agent-activity-file-chip');
            if (chip) {
                const li = chip.closest<HTMLElement>('li');
                const filePath = li?.dataset.transcriptActivityFilePath;
                if (filePath) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.toolUi.handleTranscriptFileOpen(filePath);
                }
                return;
            }
            if (target.closest('button,a')) {
                return;
            }
            if (target.closest('.theia-mobile-agent-activity-expand-summary, .theia-mobile-agent-activity-thinking-summary')) {
                return;
            }
            const li = target.closest<HTMLElement>('li.theia-mod-clickable[data-transcript-activity-action]');
            if (!li) {
                return;
            }
            if (li.classList.contains('theia-mod-expand-close-guarded')) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            activate(li);
        });
        list.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            const li = target.closest<HTMLElement>('li.theia-mod-clickable[data-transcript-activity-action]');
            if (!li) {
                return;
            }
            event.preventDefault();
            activate(li);
        });
    }

    /** In-place markdown refresh for streaming text segments — preserves tool pill expand state. */
    patchStreamingAgentTextSegments(
        row: HTMLElement,
        prevSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
    ): boolean {
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
                if (this.isLobeWorkflowProcessText(next.content ?? '')) {
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
                        this.toolUi.renderTranscriptRichContent(host, next.content ?? '', { streaming });
                    }
                } else if (this.isClosingNarrativeSegmentSkipped(next, nextSegments, lastToolIndex, segmentIndex, conv)) {
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
                    // Genuinely missing: the block should be visible but doesn't
                    // exist yet (e.g. content grew enough to no longer be
                    // process prose, or to become a distinct error card).
                    // Trigger a one-off full re-render to materialize it.
                    return false;
                }
            }
            // Coalesce execution-timeline refresh with the final activity patch
            // for this SSE tick. Closing final-answer text lives outside the
            // timeline, so pure final-answer growth should not touch it.
            if (timelineNarrativeChanged) {
                this.queueExecutionTimelineRefresh(row, nextSegments);
            } else {
                this.skipExecutionTimelineRefresh(row);
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
                if (!this.shouldRenderLobeTextSegment(nextSegments, segmentIndex, activityTimelineShown)) {
                    continue;
                }
                return false;
            }
            const streaming = row.classList.contains('theia-mod-streaming');
            this.toolUi.renderTranscriptRichContent(host, next.content ?? '', { streaming });
        }
        return true;
    }

    /** In-place tool pill refresh — preserves expand state while result/args stream or finish. */
    patchStreamingAgentToolSegments(
        row: HTMLElement,
        prevSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
    ): boolean {
        // Codex-style execution event timeline: rebuild in place.
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (segmentsBody && hasMobileExecutionEventTimeline(row)) {
            if (this.didExecutionToolSegmentsChange(prevSegments, nextSegments)) {
                this.queueExecutionTimelineRefresh(row, nextSegments);
            }
            // Sync the process accordion label/state while streaming.
            this.syncRowProcessAccordion(row, nextSegments, conv, true);
            return true;
        }
        // Upgrade path: row has tools but no Codex-style timeline yet.
        if (segmentsBody && nextSegments.some(s => s.type === 'tool')) {
            this.upgradeToMobileExecutionEventTimeline(row, nextSegments, { streaming: true, conv });
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
            this.patchTranscriptToolPill(pill, previous, next, conv);
            const group = pill.closest('.theia-mobile-agent-tool-group');
            if (group instanceof HTMLElement) {
                const items = transcriptToolGroupItems.get(group);
                if (items) {
                    const idx = items.findIndex(item => item.toolUseId === next.toolUseId);
                    if (idx >= 0) {
                        items[idx] = next;
                    }
                }
                this.refreshTranscriptToolGroupSummary(group);
            }
        }
        return true;
    }

    /** In-place activity timeline refresh — append steps and toggle the active marker during SSE. */
    protected resolveTranscriptStreamHealth(conv?: QaapAgentConversationDTO) {
        const streaming = !!conv && resolveTranscriptEffectiveStatus(conv) === 'streaming';
        const segments = conv ? resolveTranscriptStreamingAgentSegments(conv) : [];
        return resolveTranscriptStreamHealth({
            streaming,
            lastProgressAtMs: this.host.transcriptLastStreamProgressAt,
            lastTransportEventAtMs: this.host.transcriptLastTransportEventAt,
            segments,
        });
    }

    protected resolveTranscriptStreamStalled(conv?: QaapAgentConversationDTO): boolean {
        return this.resolveTranscriptStreamHealth(conv).stalled;
    }

    protected resolveTranscriptStreamTimedOut(conv?: QaapAgentConversationDTO): boolean {
        return this.resolveTranscriptStreamHealth(conv).timedOut;
    }

    protected resolveTranscriptStreamVisualIdle(
        segments: readonly QaapAgentMessageSegmentDTO[],
        streaming: boolean,
    ): boolean {
        return isTranscriptComposerVisualIdle(
            segments,
            streaming,
            this.host.transcriptLastStreamProgressAt,
        );
    }

    protected resolveTranscriptStreamStallLabel(): string {
        return nls.localize(
            'qaap/mobileProjects/transcriptStreamStalled',
            'Taking longer than expected',
        );
    }

    protected resolveTranscriptActivityItemsForDisplay(
        segments: readonly QaapAgentMessageSegmentDTO[],
        options?: {
            readonly stalled?: boolean;
            readonly timedOut?: boolean;
            readonly includeThinkingSteps?: boolean;
            readonly row?: HTMLElement;
            readonly conv?: QaapAgentConversationDTO;
            readonly streaming?: boolean;
        },
    ): readonly TranscriptActivityTimelineItem[] {
        const rowContext = this.resolveTranscriptActivityRowContext(
            options?.row,
            segments,
            options?.conv,
            { stalled: options?.stalled, streaming: options?.streaming },
        );
        const segmentItems = this.resolversUi.resolveTranscriptActivityItems(
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
            && this.host.projectBootstrap
            ? resolveTranscriptBootstrapDiagnosticActivityItems(
                toTranscriptPreviewBootstrapSnapshot(this.host.projectBootstrap.getStateSnapshot()),
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
        const stallLabel = this.resolveTranscriptStreamStallLabel();
        return annotatedItems.map((item, index) => index === activeIndex
            ? { ...item, state: 'warning', label: stallLabel }
            : item);
    }

    protected resolveTranscriptActivityRowContext(
        row: HTMLElement | undefined,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean; readonly streaming?: boolean },
    ): {
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
        const messageId = row?.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
        const streaming = options?.streaming
            ?? row?.classList.contains('theia-mod-streaming')
            ?? conv?.status === 'streaming';
        if (messageId) {
            this.activityTiming.observe(messageId, segments, Date.now(), { streaming });
        }
        const message = messageId
            ? conv?.messages.find(entry => entry.id === messageId)
            : [...(conv?.messages ?? [])].reverse().find(entry => entry.role === 'agent');
        const pendingToolUseIds = this.resolvePendingTranscriptToolUseIds(conv, segments);
        return {
            message,
            navigationOptions: {
                streaming,
                stalled: options?.stalled,
                pendingToolUseIds,
                messageCancelled: !!message?.error
                    || conv?.status === 'failed'
                    || (message?.traceEvents?.some(event => event.type === 'run_cancelled') ?? false),
            },
            resolveDurationMs: (segmentIndex, segment) => messageId
                ? this.activityTiming.resolveDurationMs(messageId, segmentIndex, segment)
                : undefined,
            resolveTimestamp: (segmentIndex, segment) => messageId
                ? this.activityTiming.resolveTimestamp(messageId, segmentIndex, segment)
                : undefined,
        };
    }

    protected resolvePendingTranscriptToolUseIds(
        conv: QaapAgentConversationDTO | undefined,
        segments: readonly QaapAgentMessageSegmentDTO[],
    ): ReadonlySet<string> | undefined {
        if (!conv || !conversationUsesInteractiveApprovals(conv)) {
            return undefined;
        }
        const pending = new Set<string>();
        for (const segment of segments) {
            if (segment.type === 'tool'
                && !segment.finished
                && this.host.transcriptLiveUi.hasPendingTranscriptToolApproval(conv.id, segment.toolUseId)) {
                pending.add(segment.toolUseId);
            }
        }
        return pending.size > 0 ? pending : undefined;
    }

    ensureTranscriptStreamStallWatch(row: HTMLElement): void {
        if (row.dataset.transcriptStallWatch === '1') {
            return;
        }
        row.dataset.transcriptStallWatch = '1';
        const timer = window.setInterval(() => {
            if (!row.isConnected) {
                window.clearInterval(timer);
                row.removeAttribute('data-transcript-stall-watch');
                return;
            }
            if (!row.classList.contains('theia-mod-streaming')) {
                window.clearInterval(timer);
                row.removeAttribute('data-transcript-stall-watch');
                row.classList.remove('theia-mod-stream-stalled');
                return;
            }
            if (!isTranscriptDocumentVisible()) {
                return;
            }
            const conv = this.host.transcriptLastConv;
            if (!conv || conv.status !== 'streaming') {
                return;
            }
            this.syncTranscriptStreamStallChrome(row, conv);
        }, 1000);
    }

    syncTranscriptStreamStallChrome(row: HTMLElement, conv: QaapAgentConversationDTO): void {
        const health = this.resolveTranscriptStreamHealth(conv);
        const { stalled, timedOut, timeoutCause } = health;
        // Only rebuild the (relatively expensive) activity timeline items when the
        // stall/timeout state actually changed, or while stalled/timed out (so the
        // banner/detail text can keep updating). Steady-state streaming ticks skip
        // the rebuild; the cheap class toggles below still run every tick.
        const stallState = `${stalled ? 1 : 0}${timedOut ? 1 : 0}`;
        const stallStateChanged = row.dataset.qaapStallState !== stallState;
        row.dataset.qaapStallState = stallState;
        row.classList.toggle('theia-mod-stream-stalled', stalled);
        row.classList.toggle('theia-mod-stream-timed-out', timedOut);
        const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
        if (segmentsBody) {
            this.syncTranscriptStreamTimeoutBanner(segmentsBody, timedOut, timeoutCause);
            // Codex-style execution event timeline: toggle stalled class on the container.
            if (hasMobileExecutionEventTimeline(row)) {
                const eventTimeline = segmentsBody.querySelector<HTMLElement>(`.theia-mobile-execution-timeline`);
                if (eventTimeline) {
                    eventTimeline.classList.toggle('theia-mod-stalled', stalled);
                    eventTimeline.classList.toggle('theia-mod-timed-out', timedOut);
                }
            }
            const timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
            if (timeline) {
                timeline.classList.toggle('theia-mod-stalled', stalled);
                timeline.classList.toggle('theia-mod-timed-out', timedOut);
                if (stallStateChanged || stalled || timedOut) {
                    const items = this.resolveTranscriptActivityItemsForDisplay(
                        this.resolveTranscriptRowSegments(conv, row),
                        { stalled, timedOut, row, conv, streaming: true },
                    );
                    this.syncTranscriptActivityTimelineElement(timeline, buildTranscriptExecutionTimelineItems(items), {
                        streaming: true,
                        stalled,
                        timedOut,
                        expanded: false,
                        segments: this.resolveTranscriptRowSegments(conv, row),
                        conv,
                        row,
                    });
                }
            }
            const streamLine = segmentsBody.querySelector('.theia-mobile-agent-stream-line, .qaap-agent-setup');
            if (streamLine) {
                this.syncTranscriptStreamingActivityLine(streamLine, conv, stalled, timedOut);
            }
        }
        if (row.hasAttribute(TRANSCRIPT_ACTIVITY_ROW_ATTR)) {
            const line = row.querySelector('.theia-mobile-agent-stream-line, .qaap-agent-setup');
            if (line) {
                this.syncTranscriptStreamingActivityLine(line, conv, stalled, timedOut);
            }
            this.syncTranscriptStreamTimeoutBanner(row, timedOut, timeoutCause);
            row.classList.toggle('theia-mod-stream-stalled', stalled);
            row.classList.toggle('theia-mod-stream-timed-out', timedOut);
        }
    }

    protected syncTranscriptStreamTimeoutBanner(
        segmentsBody: ParentNode,
        timedOut: boolean,
        cause?: TranscriptStreamTimeoutCause,
    ): void {
        const attr = 'data-transcript-stream-timeout';
        let banner = segmentsBody.querySelector<HTMLElement>(`.theia-mobile-agent-stream-timeout-banner`);
        if (!timedOut) {
            banner?.remove();
            return;
        }
        if (!banner) {
            banner = this.createTranscriptStreamTimeoutBanner(cause);
            banner.setAttribute(attr, 'true');
            segmentsBody.append(banner);
            this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
            return;
        }
        const message = banner.querySelector<HTMLElement>('.theia-mobile-agent-stream-timeout-message');
        const detail = banner.querySelector<HTMLElement>('.theia-mobile-agent-stream-timeout-detail');
        const detailText = this.resolveTranscriptStreamTimeoutDetail(cause);
        if (message) {
            message.textContent = nls.localize(
                'qaap/mobileProjects/transcriptStreamTimedOut',
                'El agente no respondió a tiempo',
            );
        }
        if (detailText) {
            if (!detail) {
                const detailEl = document.createElement('p');
                detailEl.className = 'theia-mobile-agent-stream-timeout-detail';
                detailEl.textContent = detailText;
                message?.after(detailEl);
            } else {
                detail.textContent = detailText;
            }
        } else {
            detail?.remove();
        }
    }

    protected resolveTranscriptStreamTimeoutDetail(
        cause?: TranscriptStreamTimeoutCause,
    ): string | undefined {
        switch (cause) {
            case 'sse_disconnected':
                return nls.localize(
                    'qaap/mobileProjects/transcriptStreamTimedOutSse',
                    'La conexión en vivo se interrumpió. Reintenta para sincronizar el turno.',
                );
            case 'active_tool':
                return nls.localize(
                    'qaap/mobileProjects/transcriptStreamTimedOutTool',
                    'Un comando o herramienta tardó demasiado sin devolver resultado.',
                );
            case 'semantic_idle':
                return nls.localize(
                    'qaap/mobileProjects/transcriptStreamTimedOutIdle',
                    'No hubo progreso visible (lecturas, ediciones o respuesta) en el tiempo esperado.',
                );
            default:
                return nls.localize(
                    'qaap/mobileProjects/transcriptStreamTimedOutDetail',
                    'Cancela o reintenta para continuar.',
                );
        }
    }

    protected createTranscriptStreamTimeoutBanner(
        cause?: TranscriptStreamTimeoutCause,
    ): HTMLElement {
        const banner = document.createElement('div');
        banner.className = 'theia-mobile-agent-stream-timeout-banner';
        banner.setAttribute('role', 'alert');

        const message = document.createElement('p');
        message.className = 'theia-mobile-agent-stream-timeout-message';
        message.textContent = nls.localize(
            'qaap/mobileProjects/transcriptStreamTimedOut',
            'El agente no respondió a tiempo',
        );
        const detailText = this.resolveTranscriptStreamTimeoutDetail(cause);
        if (detailText) {
            const detail = document.createElement('p');
            detail.className = 'theia-mobile-agent-stream-timeout-detail';
            detail.textContent = detailText;
            message.after(detail);
        }

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agent-stream-timeout-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'theia-mobile-agent-stream-timeout-btn theia-mod-ghost';
        cancelBtn.textContent = nls.localize('qaap/mobileProjects/transcriptStreamTimeoutCancel', 'Cancelar');
        cancelBtn.addEventListener('click', () => {
            this.host.cancelOpenTranscriptStream?.();
        });

        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'theia-mobile-agent-stream-timeout-btn theia-mod-primary';
        retryBtn.textContent = nls.localize('qaap/mobileProjects/transcriptStreamTimeoutRetry', 'Reintentar');
        retryBtn.addEventListener('click', () => {
            void this.host.retryOpenTranscriptStream?.();
        });

        actions.append(cancelBtn, retryBtn);
        banner.append(message, actions);
        return banner;
    }

    protected resolveTranscriptRowSegments(conv: QaapAgentConversationDTO, row: HTMLElement): QaapAgentMessageSegmentDTO[] {
        const messageId = row.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
        if (messageId) {
            const message = conv.messages.find(entry => entry.id === messageId);
            if (message) {
                const segments = resolveQaapTranscriptTrace(message).segments;
                if (segments.length) {
                    return [...segments];
                }
            }
        }
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        return lastAgent ? [...resolveQaapTranscriptTrace(lastAgent).segments] : [];
    }

    protected syncTranscriptStreamingActivityLine(
        line: Element,
        conv: QaapAgentConversationDTO,
        stalled: boolean,
        timedOut = false,
    ): void {
        const ownerRow = line.closest<HTMLElement>('.theia-mobile-agent-transcript-msg');
        const segments = ownerRow
            ? this.resolveTranscriptRowSegments(conv, ownerRow)
            : [...resolveTranscriptStreamingAgentSegments(conv)];
        const turnStartMs = resolveTranscriptTurnStartMs(conv.messages);
        const show = shouldShowTranscriptStreamingActivity(segments, true, {
            turnElapsedMs: resolveTranscriptTurnElapsedMs(turnStartMs),
            userPromptChars: resolveLastUserPromptChars(conv.messages),
            stalled: stalled || timedOut,
            awaitingFirstAgentOutput: isAwaitingFirstTranscriptAgentOutput(conv),
        });
        const host = line.closest<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`) ?? line.parentElement;
        if (host instanceof HTMLElement) {
            host.hidden = !show;
        }
        if (!show) {
            return;
        }
        const state = this.resolveTranscriptStreamingActivity(conv, { stalled, timedOut });
        if (line.classList.contains('qaap-agent-setup')) {
            syncAgentSetupElement(line as HTMLElement, stalled || timedOut ? null : state.title);
            return;
        }
        line.className = `theia-mobile-agent-stream-line theia-mod-${state.kind}`;
        const label = line.querySelector('.theia-mobile-agent-stream-label');
        if (label) {
            label.textContent = timedOut ? state.title : `${state.title}…`;
            label.classList.toggle(
                'theia-mod-shimmer',
                shouldTranscriptStreamLabelShimmer(state.kind, stalled, timedOut),
            );
            label.classList.toggle('theia-mod-stall', stalled || timedOut);
        }
    }

    patchStreamingActivityTimeline(
        row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
    ): boolean {
        // ─── Codex-style execution event timeline path ──────────────────────
        // If the row was rendered with the new execution event timeline, rebuild
        // it in place. This is cheap (a flat list of collapsed <details>) and
        // avoids the complex incremental sync logic of the legacy timeline.
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (segmentsBody && hasMobileExecutionEventTimeline(row)) {
            const queuedRefreshSegments = this.consumeExecutionTimelineRefresh(row);
            if (!queuedRefreshSegments && this.consumeSkippedExecutionTimelineRefresh(row)) {
                return true;
            }
            const refreshSegments = queuedRefreshSegments ?? nextSegments;
            const hasTools = refreshSegments.some(s => s.type === 'tool');
            if (hasTools) {
                recordTranscriptRenderMetric('timeline_sync');
                refreshMobileExecutionEventTimeline(segmentsBody, refreshSegments);
            }
            // Sync the accordion label here too: this path handles the
            // tool-START frame (a new tool appended to a streaming row), and a
            // long quiet tool produces no further frames — without this sync
            // the live label would keep the verb captured before the tool
            // began (usually none, i.e. plain 'Processing…').
            this.syncRowProcessAccordion(row, refreshSegments, conv, true);
            return true;
        }

        // ─── Upgrade path: thinking → tools ────────────────────────────────
        // The row was created during the thinking phase (no tools, so a thought
        // brief was rendered). Now tools are present — upgrade to the Codex-style
        // execution event timeline so the user sees events, not a tool log.
        if (segmentsBody && nextSegments.some(s => s.type === 'tool')) {
            recordTranscriptRenderMetric('timeline_upgrade');
            this.upgradeToMobileExecutionEventTimeline(row, nextSegments, { streaming: true, conv });
            return true;
        }

        // ─── Legacy activity timeline path ──────────────────────────────────
        const stalled = this.resolveTranscriptStreamStalled(conv);
        const timedOut = this.resolveTranscriptStreamTimedOut(conv);
        const streaming = row.classList.contains('theia-mod-streaming');
        if (!shouldShowTranscriptInlineTimeline(nextSegments, streaming)) {
            segmentsBody?.querySelector(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`)?.remove();
            this.patchStreamingThoughtBrief(row, nextSegments, conv, true);
            return true;
        }
        const items = this.resolveTranscriptActivityItemsForDisplay([...nextSegments], {
            stalled,
            timedOut,
            row,
            conv,
            streaming,
        });
        if (items.length === 0) {
            this.patchStreamingThoughtBrief(row, nextSegments, conv, true);
            return true;
        }
        if (!segmentsBody) {
            return false;
        }
        let timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        const timelineOptions = {
            streaming: true,
            stalled,
            timedOut,
            expanded: false,
            segments: nextSegments,
            includeThinkingSteps: true,
            conv,
            row,
        };
        if (!timeline) {
            recordTranscriptRenderMetric('timeline_create');
            const created = this.createTranscriptActivityTimeline([...nextSegments], timelineOptions);
            if (!created) {
                return false;
            }
            const thoughtBrief = segmentsBody.querySelector('.theia-mobile-agent-thought-brief');
            if (thoughtBrief) {
                thoughtBrief.insertAdjacentElement('afterend', created);
            } else {
                segmentsBody.prepend(created);
            }
            timeline = created;
        } else {
            this.syncTranscriptActivityTimelineElement(timeline, buildTranscriptExecutionTimelineItems(items), timelineOptions);
        }
        // Hide the thought brief when the timeline is visible (instead of removing it)
        // to prevent flickering from create/destroy cycles during streaming.
        const thoughtBrief = segmentsBody.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief');
        if (thoughtBrief) {
            thoughtBrief.hidden = true;
        }
        return true;
    }

    patchStreamingThoughtBrief(
        row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        streaming: boolean,
    ): boolean {
        const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return false;
        }
        const thinking = resolveTranscriptThinkingContent([...segments]);
        const stats = resolveTranscriptActivityStats([...segments]);
        const hasStats = hasTranscriptActivityStats(stats);
        const turnStartMs = conv ? resolveTranscriptTurnStartMs(conv.messages) : undefined;
        const showBrief = shouldShowTranscriptThoughtBrief(segments, streaming, {
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
        const thinkingActive = isTranscriptAgentThinkingPhase(segments, streaming);
        if (!thinking && !hasStats && !thinkingActive) {
            if (brief) {
                brief.hidden = true;
            }
            return true;
        }
        if (!brief) {
            const created = this.createTranscriptThoughtBriefBlock([...segments], { streaming, conv });
            if (!created) {
                return false;
            }
            segmentsBody.prepend(created);
            brief = created;
        }
        brief.hidden = false;
        this.syncTranscriptThoughtBriefElement(brief, segments, { streaming, conv });
        return true;
    }

    protected syncTranscriptThoughtBriefElement(
        block: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: { readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO },
    ): void {
        const thinking = resolveTranscriptThinkingContent([...segments]);
        const streaming = !!options.streaming;
        const thinkingActive = isTranscriptAgentThinkingPhase(segments, streaming);
        const title = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-title');
        if (!title) {
            return;
        }
        const turnStartMs = options.conv ? resolveTranscriptTurnStartMs(options.conv.messages) : undefined;
        if (thinkingActive) {
            block.classList.add('theia-mod-thinking-live');
            block.removeAttribute('data-thought-duration-ms');
            if (block instanceof HTMLDetailsElement) {
                block.open = true;
            }
        } else if (streaming && block.classList.contains('theia-mod-thinking-live')) {
            block.classList.remove('theia-mod-thinking-live');
            if (turnStartMs !== undefined && !block.dataset.thoughtDurationMs) {
                block.dataset.thoughtDurationMs = String(Math.max(0, Date.now() - turnStartMs));
            }
            // Keep the thought brief open during the entire streaming turn
            // so the user can always see what the agent reasoned. It will be
            // collapsed once streaming ends (see the else branch below).
            if (block instanceof HTMLDetailsElement && !block.dataset.thoughtUserExpanded) {
                block.open = true;
            }
        } else if (block instanceof HTMLDetailsElement
            && !block.dataset.thoughtUserExpanded
            && !thinkingActive
            && !streaming) {
            block.open = false;
        }
        const meta = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-meta');
        meta?.remove();
        // Sync the thought brief icon: spinning loader (LobeHub Loader2) while
        // the backend is still streaming (including the Finalizing state where
        // the turn is visually settled but the backend is still active),
        // lightbulb (LobeHub Atom) when the backend is truly idle.
        const backendStreaming = streaming || (!!options.conv && options.conv.status === 'streaming');
        const briefIcon = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-icon');
        if (briefIcon) {
            this.syncTranscriptThoughtBriefIcon(briefIcon, backendStreaming || thinkingActive);
        }
        const bodyWrap = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-body-wrap');
        if (thinking) {
            if (!bodyWrap) {
                const wrap = document.createElement('div');
                wrap.className = 'theia-mobile-agent-thought-brief-body-wrap';
                const body = document.createElement('p');
                body.className = 'theia-mobile-agent-thought-brief-body';
                wrap.append(body);
                block.append(wrap);
            }
            const body = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-body');
            if (body) {
                body.textContent = excerptTranscriptThought(thinking);
            }
        } else {
            bodyWrap?.remove();
        }
        if (block instanceof HTMLDetailsElement && block.dataset.thoughtToggleBound !== '1') {
            block.dataset.thoughtToggleBound = '1';
            block.addEventListener('toggle', () => {
                if (block.open) {
                    block.dataset.thoughtUserExpanded = '1';
                } else {
                    block.removeAttribute('data-thought-user-expanded');
                }
            });
        }
        this.refreshTranscriptThoughtBriefTitle(title, block, {
            thinking,
            thinkingActive,
            streaming,
            turnStartMs,
            segments: [...segments],
        });
    }

    protected refreshTranscriptThoughtBriefTitle(
        title: HTMLElement,
        block: HTMLElement,
        options: {
            readonly thinking: string | undefined;
            readonly thinkingActive: boolean;
            readonly streaming: boolean;
            readonly turnStartMs: number | undefined;
            readonly segments?: readonly QaapAgentMessageSegmentDTO[];
        },
    ): void {
        title.classList.remove('theia-mod-shimmer');
        if (options.thinkingActive && options.turnStartMs !== undefined) {
            title.classList.add('theia-mod-shimmer');
            // LobeHub Thinking.thinking = "Deep Thinking..." — shown while
            // the model is actively reasoning (streaming). The text itself is
            // constant while thinking is active, so avoid rewriting
            // `textContent` (and triggering layout/style work) on every tick;
            // this timer's real job is watching for the live class to drop.
            const update = (): void => {
                if (!title.isConnected) {
                    return;
                }
                const next = nls.localize('qaap/lobehub/thinking/thinking', 'Deep Thinking...');
                if (title.textContent !== next) {
                    title.textContent = next;
                }
            };
            update();
            if (block.dataset.thoughtLiveTimer !== '1') {
                block.dataset.thoughtLiveTimer = '1';
                const timer = window.setInterval(() => {
                    if (!title.isConnected) {
                        window.clearInterval(timer);
                        block.removeAttribute('data-thought-live-timer');
                        return;
                    }
                    if (!block.classList.contains('theia-mod-thinking-live')) {
                        window.clearInterval(timer);
                        block.removeAttribute('data-thought-live-timer');
                        this.refreshTranscriptThoughtBriefTitle(title, block, {
                            ...options,
                            thinkingActive: false,
                        });
                        return;
                    }
                    if (!isTranscriptDocumentVisible()) {
                        return;
                    }
                    update();
                }, 1000);
            }
            return;
        }
        block.removeAttribute('data-thought-live-timer');
        // LobeHub Thinking.thoughtWithDuration = "Deeply Thought" — shown once
        // reasoning has settled (whether or not thinking content is present).
        // Kept in sync with the technical-details thinking branch and the IDE
        // React renderer (QaapLobehubThinkingRenderer).
        title.textContent = nls.localize('qaap/lobehub/thinking/thought', 'Deeply Thought');
    }

    protected syncTranscriptActivityTimelineElement(
        timeline: HTMLElement,
        items: readonly TranscriptActivityTimelineItem[],
        options?: TranscriptActivityTimelineOptions,
    ): void {
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
            this.ensureLobeTranscriptWorkflowClasses(timeline);
            const autoExpanded = options?.expanded
                ?? shouldExpandTranscriptInlineTimeline(segments, false);
            this.bindTranscriptActivityTimelineToggle(timeline);
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
            this.syncTranscriptActivityTimelineSummaryElement(timeline, segments, visibleItems, policy, options);
            timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-count')
                .forEach(count => count.textContent = String(visibleItems.filter(item => !isTranscriptExecutionTimelineNarrative(item)).length));
            const visualIdle = this.resolveTranscriptStreamVisualIdle(segments, !!options?.streaming);
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
        this.bindTranscriptActivityTimelineGapHandlers(timeline);
        const ownerRow = timeline.closest<HTMLElement>('.theia-mobile-agent-transcript-msg');
        if (list instanceof HTMLElement && ownerRow) {
            this.bindTranscriptActivityListActions(list, ownerRow);
        }
        const timelineOptionsWithTrace = { ...options, cursorTrace };
        const focusIndex = activeIndex >= 0 ? activeIndex : visibleItems.length - 1;
        const shouldVirtualizeTimeline = visibleItems.length > TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD
            && (options?.variant === 'plan' || !!options?.cursorTrace);
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
                this.syncTranscriptActivityTimelineElement(timeline, items, options);
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
                tier: resolveTranscriptTimelineItemTier(absoluteIndex, focusIndex, visibleItems.length),
            });
        });
        if (renderWindow.hiddenAfter > 0) {
            slots.push({ kind: 'gap', count: renderWindow.hiddenAfter, position: 'after' });
        }
        const existing = [...list.querySelectorAll<HTMLElement>(':scope > li')];
        slots.forEach((slot, index) => {
            let li = existing[index];
            if (!li) {
                li = document.createElement('li');
                if (!options?.streaming) {
                    li.classList.add('theia-mod-enter');
                    li.addEventListener('animationend', () => li.classList.remove('theia-mod-enter'), { once: true });
                }
                list.append(li);
            }
            if (slot.kind === 'gap') {
                this.syncTranscriptActivityHistoryGap(li, slot.count, slot.position);
                return;
            }
            this.syncTranscriptActivityItemElement(
                li,
                slot.item,
                slot.isActive,
                timelineOptionsWithTrace,
                cursorTrace ? 'recent' : slot.tier,
            );
            if (ownerRow) {
                this.attachTranscriptActivityItemAction(li, slot.item, ownerRow);
            }
        });
        while (list.children.length > slots.length) {
            list.lastElementChild?.remove();
        }
        this.syncTranscriptTraceStatus(ownerRow, segments, {
            ...options,
            streaming: options?.streaming,
            conv: options?.conv,
            cursorTrace: timeline.classList.contains('theia-mod-cursor-trace'),
        });
        transcriptActivityTimelineResync.set(timeline, () => {
            this.syncTranscriptActivityTimelineElement(timeline, items, options);
        });
    }

    protected ensureLobeTranscriptWorkflowClasses(timeline: HTMLDetailsElement): void {
        timeline.classList.add('theia-mobile-agent-lobe-workflow');
        timeline.querySelectorAll<HTMLElement>(
            '.theia-mobile-agent-activity-timeline-summary, .theia-mobile-agent-activity-timeline-sticky-bar',
        ).forEach(summary => summary.classList.add('theia-mobile-agent-lobe-workflow-summary'));
        timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-chevron')
            .forEach(chevron => chevron.classList.add('theia-mobile-agent-lobe-workflow-toggle'));
    }

    protected syncTranscriptActivityTimelineSummaryElement(
        timeline: HTMLDetailsElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        visibleItems: readonly TranscriptActivityTimelineItem[],
        policy: ReturnType<typeof resolveTranscriptTimelineVisibilityPolicy>,
        options?: TranscriptActivityTimelineOptions,
    ): void {
        const summaryLabels = timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-label');
        if (summaryLabels.length === 0) {
            return;
        }
        for (const summaryLabel of summaryLabels) {
            const summaryText = this.resolveTranscriptActivityTimelineSummary(segments, visibleItems, 0, {
                streaming: !!options?.streaming,
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
        this.bindTranscriptActivityTimelineStickyBar(timeline);
        const backendStreaming = !!options?.conv && options.conv.status === 'streaming';
        this.syncTranscriptSummaryIcons(timeline, !!options?.streaming || backendStreaming);
    }

    protected syncTranscriptSummaryIcons(timeline: HTMLElement, streaming: boolean): void {
        const icons = timeline.querySelectorAll<HTMLElement>(
            '.theia-mobile-agent-activity-timeline-summary-icon',
        );
        for (const icon of icons) {
            const existingSpinner = transcriptSummarySpinners.get(icon);
            if (streaming) {
                if (!existingSpinner) {
                    const spinner = createUnicodeSpinner();
                    spinner.classList.add('theia-mobile-agent-activity-timeline-summary-spinner');
                    spinner.setAttribute('aria-hidden', 'true');
                    icon.classList.add('theia-mod-spinner-active');
                    icon.append(spinner);
                    transcriptSummarySpinners.set(icon, spinner);
                }
            } else {
                if (existingSpinner) {
                    destroyUnicodeSpinner(existingSpinner);
                    existingSpinner.remove();
                    transcriptSummarySpinners.delete(icon);
                    icon.classList.remove('theia-mod-spinner-active');
                }
            }
        }
    }

    protected bindTranscriptActivityTimelineToggle(timeline: HTMLDetailsElement): void {
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

    protected bindTranscriptActivityTimelineStickyBar(timeline: HTMLDetailsElement): void {
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

    protected bindTranscriptActivityTimelineGapHandlers(timeline: HTMLElement): void {
        if (timeline.dataset.transcriptTimelineGapBound === '1') {
            return;
        }
        timeline.dataset.transcriptTimelineGapBound = '1';
        timeline.addEventListener('click', event => this.handleTranscriptActivityTimelineGapClick(event));
        timeline.addEventListener('keydown', event => this.handleTranscriptActivityTimelineGapKeydown(event));
    }

    protected handleTranscriptActivityTimelineGapClick(event: Event): void {
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

    protected handleTranscriptActivityTimelineGapKeydown(event: KeyboardEvent): void {
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

    protected syncTranscriptTraceStatus(
        row: HTMLElement | null,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions,
    ): void {
        if (!row) {
            return;
        }
        const status = row.querySelector<HTMLElement>(`[${TRANSCRIPT_TRACE_STATUS_ATTR}]`);
        if (!status) {
            return;
        }
        if (!options?.streaming) {
            status.hidden = true;
            status.textContent = '';
            return;
        }
        const activeTool = [...segments].reverse().find((segment): segment is Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> =>
            segment.type === 'tool' && !segment.finished);
        if (activeTool && classifyTranscriptToolActivityKind(activeTool.name) === 'terminal') {
            const messageId = row.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
            const segmentIndex = segments.findIndex(segment =>
                segment.type === 'tool' && segment.toolUseId === activeTool.toolUseId);
            const durationMs = messageId && segmentIndex >= 0
                ? this.activityTiming.resolveDurationMs(messageId, segmentIndex, activeTool)
                : undefined;
            const elapsedSec = durationMs !== undefined
                ? Math.max(1, Math.round(durationMs / 1000))
                : 1;
            const shellText = nls.localize(
                'qaap/mobileProjects/transcriptWaitingForShell',
                'Waiting {0}s for shell',
                String(elapsedSec),
            );
            if (status.textContent !== shellText) {
                status.textContent = shellText;
            }
            status.hidden = false;
            status.classList.add('theia-mod-live');
            return;
        }
        const activity = resolveTranscriptStreamingActivityFromSegments(segments, { stalled: options?.stalled });
        if (activity.kind === 'planning' || activity.kind === 'thinking' || activity.kind === 'stall') {
            if (status.textContent !== activity.title) {
                status.textContent = activity.title;
            }
            status.hidden = false;
            status.classList.toggle('theia-mod-live', activity.kind !== 'stall');
            return;
        }
        status.hidden = true;
        if (status.textContent !== '') {
            status.textContent = '';
        }
    }

    protected syncTranscriptActivityHistoryGap(
        li: HTMLElement,
        hiddenCount: number,
        position: 'before' | 'after',
    ): void {
        const gapFingerprint = fingerprintTranscriptActivityHistoryGapSlot(hiddenCount, position);
        if (li.getAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR) === gapFingerprint) {
            recordTranscriptRenderMetric('timeline_item_sync_skipped');
            return;
        }
        const labelText = position === 'before'
            ? nls.localize(
                'qaap/mobileProjects/transcriptActivityHiddenSteps',
                '+{0} earlier steps',
                String(hiddenCount),
            )
            : nls.localize(
                'qaap/mobileProjects/transcriptActivityHiddenMoreSteps',
                '+{0} more steps',
                String(hiddenCount),
            );
        const existingLabel = li.querySelector<HTMLElement>('.theia-mobile-agent-activity-label');
        if (li.classList.contains('theia-mod-history-gap') && existingLabel) {
            li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, gapFingerprint);
            if (existingLabel.textContent !== labelText) {
                existingLabel.textContent = labelText;
            }
            if (li.getAttribute('aria-label') !== labelText) {
                li.setAttribute('aria-label', labelText);
            }
            recordTranscriptRenderMetric('timeline_item_sync_light');
            return;
        }
        li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, gapFingerprint);
        recordTranscriptRenderMetric('timeline_item_sync');
        li.className = 'theia-mobile-agent-activity-item theia-mod-history-gap theia-mod-clickable';
        li.setAttribute(TRANSCRIPT_TIMELINE_GAP_POSITION_ATTR, position);
        li.removeAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR);
        li.removeAttribute('data-transcript-activity-action');
        li.removeAttribute('data-transcript-activity-segment-index');
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');
        li.setAttribute('aria-label', labelText);
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-activity-icon theia-mod-history-gap codicon codicon-ellipsis';
        icon.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('div');
        copy.className = 'theia-mobile-agent-activity-copy';
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-activity-label';
        label.textContent = labelText;
        copy.append(label);
        li.replaceChildren(icon, copy);
    }

    /** Append a new text block when a text segment appears at the tail without rebuilding tool pills. */
    appendStreamingAgentTextSegment(
        row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
    ): boolean {
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
            if (segmentIndex > lastToolIndex && !this.isLobeWorkflowProcessText(segment.content)) {
                // Repeated tool failures / retries can stream the same
                // "error" trace-event text more than once — check this new
                // tail segment against everything already rendered (and
                // against `msg.error`, shown by the failure dialog) so a
                // duplicate never gets its own block, matching the dedup a
                // full render applies (see renderMobileExecutionEventTimeline).
                const text = segment.content?.trim() ?? '';
                const seenClosingNarrativeTexts = this.collectMobileClosingNarrativeTextsBefore(nextSegments, lastToolIndex, segmentIndex);
                const error = this.resolveLastAgentMessageError(conv);
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
                const isErrorLikely = this.isConversationError(conv) || MOBILE_CLOSING_TEXT_ERROR_PREFIX.test(text);
                const action = this.resolveMobileClosingNarrativeAction(
                    text, seenClosingNarrativeTexts, normalizedFailureReason, isErrorLikely,
                );
                if (action.kind !== 'skip') {
                    const streaming = row.classList.contains('theia-mod-streaming');
                    const el = action.kind === 'error-card'
                        ? createMobileClosingErrorCardElement(action.message, this.resolveMobileClosingErrorCardRetry())
                        : this.toolUi.createTranscriptSegmentDetails(segment);
                    el.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
                    if (action.kind === 'text' && streaming) {
                        this.toolUi.renderTranscriptRichContent(el, segment.content ?? '', { streaming });
                    }
                    // Insert after the timeline but before any diff summary.
                    const diffSummary = segmentsBody.querySelector('.theia-mobile-diff-summary');
                    if (diffSummary) {
                        segmentsBody.insertBefore(el, diffSummary);
                    } else {
                        segmentsBody.append(el);
                    }
                }
            }
            this.skipExecutionTimelineRefresh(row);
            return true;
        }
        const activityTimelineShown = !!segmentsBody.querySelector(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        if (!this.shouldRenderLobeTextSegment(nextSegments, segmentIndex, activityTimelineShown)) {
            this.patchStreamingActivityTimeline(row, nextSegments, conv);
            return true;
        }
        if (segmentsBody.querySelector(`[${TRANSCRIPT_SEGMENT_INDEX_ATTR}="${segmentIndex}"]`)) {
            return false;
        }
        const textBlock = this.toolUi.createTranscriptSegmentDetails(segment);
        textBlock.setAttribute(TRANSCRIPT_SEGMENT_INDEX_ATTR, String(segmentIndex));
        const streaming = row.classList.contains('theia-mod-streaming');
        if (streaming) {
            this.toolUi.renderTranscriptRichContent(textBlock, segment.content ?? '', { streaming });
        }
        const artifacts = segmentsBody.querySelector('.theia-mobile-agent-transcript-artifacts');
        if (artifacts) {
            segmentsBody.insertBefore(textBlock, artifacts);
        } else {
            segmentsBody.append(textBlock);
        }
        this.patchStreamingActivityTimeline(row, nextSegments, conv);
        return true;
    }

    /** Append a new tool pill when a tool segment appears at the tail without rebuilding text blocks. */
    appendStreamingAgentToolSegment(
        row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
    ): boolean {
        const segment = nextSegments[nextSegments.length - 1];
        if (!segment || segment.type !== 'tool') {
            return false;
        }
        if (row.classList.contains('theia-mod-streaming')) {
            return this.patchStreamingActivityTimeline(row, nextSegments, conv);
        }
        // Non-streaming row: if it doesn't have the Codex-style timeline yet
        // (e.g. it was created during thinking and settled without tools, then
        // a late tool arrived), upgrade it to the Codex-style timeline.
        if (!hasMobileExecutionEventTimeline(row)) {
            this.upgradeToMobileExecutionEventTimeline(row, nextSegments, { streaming: false, conv });
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

    patchTranscriptToolPill(
        pill: HTMLDetailsElement,
        previous: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv?: QaapAgentConversationDTO,
    ): void {
        const manualApproval = !!conv && conversationUsesInteractiveApprovals(conv);
        const descriptors = resolveTranscriptToolPillDescriptors([segment], {
            resolvePath: args => this.resolversUi.extractTranscriptToolFullPath(args),
        });
        const descriptor = descriptors[0];
        if (!descriptor) {
            return;
        }
        const wasOpen = pill.open;
        const wasFailed = pill.classList.contains('theia-mod-failed');
        pill.className = `theia-mobile-agent-tool-pill theia-mod-${descriptor.kind}`;
        pill.classList.toggle('theia-mod-running', !descriptor.finished);
        pill.classList.toggle('theia-mod-done', descriptor.finished);
        pill.classList.toggle('theia-mod-failed', descriptor.resultFailed);
        const pendingApproval = manualApproval
            && isPendingTranscriptToolSegment(segment)
            && this.host.transcriptLiveUi.hasPendingTranscriptToolApproval(conv!.id, segment.toolUseId);
        pill.classList.toggle('theia-mod-awaiting-approval', pendingApproval);
        const rowParts = this.resolveToolRowParts(segment, descriptor.kind);
        const summary = pill.querySelector('summary');
        if (summary) {
            this.toolUi.syncTranscriptToolPillSummary(summary, {
                kind: descriptor.kind,
                verb: rowParts.verb,
                label: rowParts.detail,
                finished: descriptor.finished,
                failed: descriptor.resultFailed,
                startedAt: segment.startedAt,
                mcpServer: descriptor.kind === 'mcp'
                    ? extractTranscriptMcpServerLabel(segment.args)
                    : undefined,
                copyFrom: segment.result?.trim()
                    ? () => this.resolversUi.formatTranscriptToolResult(segment.result!)
                    : undefined,
            });
        }
        if (this.resolversUi.isTranscriptPureReadTool(segment.name)
            && !this.resolversUi.shouldShowTranscriptToolResultBody(segment, descriptor.kind)) {
            pill.querySelector('.theia-mobile-agent-tool-pill-body')?.remove();
            pill.open = wasOpen;
            return;
        }
        let body = pill.querySelector<HTMLElement>('.theia-mobile-agent-tool-pill-body');
        if (!body && lazyTranscriptToolPillBodies.has(pill)) {
            if (!pendingApproval
                && !descriptor.resultFailed
                && descriptor.finished
                && segment.result?.trim()
                && !pill.open) {
                lazyTranscriptToolPillBodies.set(pill, {
                    segment,
                    conv,
                    kind: descriptor.kind,
                    finished: descriptor.finished,
                    resultFailed: descriptor.resultFailed,
                });
                pill.open = wasOpen;
                return;
            }
            lazyTranscriptToolPillBodies.delete(pill);
        }
        if (!body) {
            body = document.createElement('div');
            body.className = 'theia-mobile-agent-tool-pill-body';
            pill.append(body);
        }
        const pendingApprovalChanged = pendingApproval !== !!body.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`);
        if (!pendingApprovalChanged
            && this.toolUi.canPatchTranscriptToolResultStream(previous, segment)
            && this.toolUi.patchTranscriptToolResultStreamBody(body, segment)) {
            pill.open = wasOpen;
            return;
        }
        const speculativeOnly = !pendingApprovalChanged
            && !segment.result?.trim()
            && !segment.finished
            && previous.toolUseId === segment.toolUseId
            && previous.name === segment.name;
        if (speculativeOnly) {
            this.toolUi.ensureTranscriptToolSpeculativePlaceholder(body, segment);
            pill.open = wasOpen;
            return;
        }
        body.replaceChildren();
        if (pendingApproval) {
            body.append(this.createTranscriptToolApprovalActions(conv!.id, segment));
        }
        const todoChecklist = isTranscriptTodoTool(segment.name) && !!parseTranscriptTodoChecklist(segment.args);
        if (segment.result?.trim() || todoChecklist) {
            body.append(this.toolUi.createTranscriptToolResultBody(
                segment,
                descriptor.kind,
                { streaming: !descriptor.finished },
            ));
        } else if (!segment.finished) {
            this.toolUi.ensureTranscriptToolSpeculativePlaceholder(body, segment);
        }
        lazyTranscriptToolPillBodies.delete(pill);
        if (descriptor.resultFailed && !wasFailed) {
            pill.open = shouldOpenTranscriptToolDetails({
                finished: descriptor.finished,
                resultFailed: descriptor.resultFailed,
            });
        } else if (descriptor.kind === 'terminal' && !descriptor.finished) {
            pill.open = true;
        } else {
            pill.open = wasOpen;
        }
    }

    protected createTranscriptThoughtBriefIcon(active: boolean): HTMLElement {
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-lobe-status-indicator theia-mod-thinking theia-mobile-agent-thought-brief-icon';
        icon.setAttribute('aria-hidden', 'true');
        const glyph = document.createElement('span');
        glyph.className = this.resolveTranscriptThoughtBriefIconClass(active);
        icon.append(glyph);
        return icon;
    }

    protected resolveTranscriptThoughtBriefIconClass(active: boolean): string {
        // LobeHub: Loader2Icon (spin) while thinking, AtomIcon when settled.
        // Codicon equivalents: `loading` (with theia-animation-spin) / `lightbulb`.
        return active
            ? 'codicon codicon-loading theia-animation-spin'
            : 'codicon codicon-lightbulb';
    }

    protected syncTranscriptThoughtBriefIcon(icon: HTMLElement, active: boolean): void {
        const glyph = icon.querySelector('.codicon');
        if (!glyph) {
            return;
        }
        glyph.className = this.resolveTranscriptThoughtBriefIconClass(active);
    }

    createTranscriptThoughtBriefBlock(
        segments: QaapAgentMessageSegmentDTO[],
        options?: { readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO },
    ): HTMLElement | undefined {
        const thinking = resolveTranscriptThinkingContent(segments);
        const stats = resolveTranscriptActivityStats(segments);
        const hasStats = hasTranscriptActivityStats(stats);
        const streaming = !!options?.streaming;
        const turnStartMs = options?.conv ? resolveTranscriptTurnStartMs(options.conv.messages) : undefined;
        if (!shouldShowTranscriptThoughtBrief(segments, streaming, {
            turnElapsedMs: resolveTranscriptTurnElapsedMs(turnStartMs),
            userPromptChars: options?.conv ? resolveLastUserPromptChars(options.conv.messages) : undefined,
            hasActivityStats: hasStats,
            thinkingContent: thinking,
        })) {
            return undefined;
        }
        const thinkingActive = isTranscriptAgentThinkingPhase(segments, streaming);

        const block = document.createElement('details');
        block.className = 'theia-mobile-agent-thought-brief theia-mod-cursor-flat';
        block.setAttribute(TRANSCRIPT_THOUGHT_BRIEF_ATTR, 'true');
        if (thinkingActive) {
            block.classList.add('theia-mod-thinking-live');
        }
        block.open = thinkingActive;

        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-thought-brief-summary';
        // LobeHub Thinking StatusIndicator (src/features/Conversation/components/
        // Thinking/StatusIndicator.tsx): a 24x24 outlined Block chip with
        // Loader2Icon (spin) while thinking, AtomIcon when settled — purple when
        // expanded, colorTextDescription when collapsed. Reuses the existing
        // .theia-mobile-agent-lobe-status-indicator chip used by tool heads so the
        // visual language is unified. The QAAQ "finalizing" state (backend still
        // streaming but turn visually settled) keeps the spinning loader so the
        // user still sees activity, matching the prior unicode-snake spinner.
        const backendStreaming = streaming || (!!options?.conv && options.conv.status === 'streaming');
        const icon = this.createTranscriptThoughtBriefIcon(backendStreaming || thinkingActive);
        const title = document.createElement('span');
        title.className = 'theia-mobile-agent-thought-brief-title';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-thought-brief-chevron codicon codicon-chevron-down';
        chevron.setAttribute('aria-hidden', 'true');
        summary.append(icon, title, chevron);
        block.append(summary);

        if (thinking) {
            const bodyWrap = document.createElement('div');
            bodyWrap.className = 'theia-mobile-agent-thought-brief-body-wrap';
            const body = document.createElement('p');
            body.className = 'theia-mobile-agent-thought-brief-body';
            body.textContent = excerptTranscriptThought(thinking);
            bodyWrap.append(body);
            if (isTranscriptThoughtExcerptTruncated(thinking)) {
                const full = document.createElement('pre');
                full.className = 'theia-mobile-agent-thought-brief-more-body';
                full.textContent = this.contentUi.cleanTranscriptDisplayText(thinking);
                bodyWrap.append(full);
            }
            block.append(bodyWrap);
        }

        if (block instanceof HTMLDetailsElement && block.dataset.thoughtToggleBound !== '1') {
            block.dataset.thoughtToggleBound = '1';
            block.addEventListener('toggle', () => {
                if (block.open) {
                    block.dataset.thoughtUserExpanded = '1';
                } else {
                    block.removeAttribute('data-thought-user-expanded');
                }
            });
        }
        this.refreshTranscriptThoughtBriefTitle(title, block, {
            thinking,
            thinkingActive,
            streaming,
            turnStartMs,
            segments: [...segments],
        });
        return block;
    }

    createTranscriptToolPillsStrip(
        segments: QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },
    ): HTMLElement | undefined {
        const rawToolSegments = segments.filter((segment): segment is Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> =>
            segment.type === 'tool',
        );
        const toolSegments = coalesceToolSegments(rawToolSegments);
        const descriptors = resolveTranscriptToolPillDescriptors(toolSegments, {
            resolvePath: args => this.resolversUi.extractTranscriptToolFullPath(args),
        });
        if (descriptors.length === 0) {
            return undefined;
        }
        const bundles = bundleToolSegmentsByUmbrella(toolSegments);
        const container = document.createElement('div');
        container.className = 'theia-mobile-agent-tool-pills-strip';
        for (const bundle of bundles) {
            const strip = document.createElement('div');
            strip.className = 'theia-mobile-agent-tool-pills';
            for (const segment of bundle.items) {
                strip.append(this.createTranscriptToolPill(segment, conv, options));
            }
            if (strip.childElementCount === 0) {
                continue;
            }
            const group = this.wrapTranscriptToolGroup(strip, bundle.umbrella, bundle.items);
            container.append(group);
        }
        if (container.childElementCount === 0) {
            return undefined;
        }
        return container;
    }

    /**
     * Claude-Code-style collapsed activity line: one `details` row summarising the tool calls
     * ("Ran 4 commands, read 6 files ›") that expands into the individual tool pills.
     */
    protected wrapTranscriptToolGroup(
        strip: HTMLElement,
        umbrella?: ToolUmbrella,
        items?: ReadonlyArray<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>>,
    ): HTMLDetailsElement {
        const group = document.createElement('details');
        group.className = 'theia-mobile-agent-tool-group';
        if (umbrella) {
            group.classList.add(`theia-mod-${umbrella}`);
            group.dataset.umbrella = umbrella;
            transcriptToolGroupUmbrella.set(group, umbrella);
            if (items) {
                transcriptToolGroupItems.set(group, [...items]);
            }
        }
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-tool-group-head';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-tool-group-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-tool-group-label';
        summary.append(chevron, label);
        group.append(summary, strip);
        if (umbrella && items) {
            label.textContent = summarizeToolBundle(umbrella, items);
        } else {
            this.refreshTranscriptToolGroupSummary(group);
        }
        if (group instanceof HTMLDetailsElement
            && group.querySelector('.theia-mobile-agent-tool-pill.theia-mod-running, .theia-mobile-agent-tool-pill.theia-mod-failed')) {
            group.open = true;
        }
        return group;
    }

    /** Recompute the group summary label and open state from the pills currently inside. */
    refreshTranscriptToolGroupSummary(group: HTMLElement): void {
        const label = group.querySelector<HTMLElement>('.theia-mobile-agent-tool-group-label');
        if (!label) {
            return;
        }
        const umbrella = transcriptToolGroupUmbrella.get(group) ?? group.dataset.umbrella as ToolUmbrella | undefined;
        if (umbrella) {
            const items = transcriptToolGroupItems.get(group) ?? [];
            label.textContent = summarizeToolBundle(umbrella, items);
        } else {
            const pills = group.querySelectorAll('.theia-mobile-agent-tool-pill');
            let shells = 0;
            let fileReads = 0;
            let searches = 0;
            let edits = 0;
            let otherTools = 0;
            for (const pill of pills) {
                if (pill.classList.contains('theia-mod-terminal')) {
                    shells++;
                } else if (pill.classList.contains('theia-mod-reading')) {
                    fileReads++;
                } else if (pill.classList.contains('theia-mod-searching')) {
                    searches++;
                } else if (pill.classList.contains('theia-mod-editing')) {
                    edits++;
                } else {
                    otherTools++;
                }
            }
            label.textContent = this.formatTranscriptToolGroupLabel({ fileReads, searches, shells, edits, otherTools });
        }
        if (group instanceof HTMLDetailsElement
            && group.querySelector('.theia-mobile-agent-tool-pill.theia-mod-running, .theia-mobile-agent-tool-pill.theia-mod-failed')) {
            group.open = true;
        }
    }

    /** "Ran 4 commands, read 6 files, edited 2 files, used 5 tools" — verb-first summary. */
    protected formatTranscriptToolGroupLabel(stats: QaapTranscriptActivityStats): string {
        const parts: string[] = [];
        if (stats.shells > 0) {
            parts.push(stats.shells === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneCommand', 'Ran 1 command')
                : nls.localize('qaap/mobileProjects/toolGroupCommands', 'Ran {0} commands', String(stats.shells)));
        }
        if (stats.edits > 0) {
            parts.push(stats.edits === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneEdit', 'edited 1 file')
                : nls.localize('qaap/mobileProjects/toolGroupEdits', 'edited {0} files', String(stats.edits)));
        }
        if (stats.fileReads > 0) {
            parts.push(stats.fileReads === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneRead', 'read 1 file')
                : nls.localize('qaap/mobileProjects/toolGroupReads', 'read {0} files', String(stats.fileReads)));
        }
        if (stats.searches > 0) {
            parts.push(stats.searches === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneSearch', 'searched once')
                : nls.localize('qaap/mobileProjects/toolGroupSearches', 'searched {0} times', String(stats.searches)));
        }
        if (stats.otherTools > 0) {
            parts.push(stats.otherTools === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneTool', 'used 1 tool')
                : nls.localize('qaap/mobileProjects/toolGroupTools', 'used {0} tools', String(stats.otherTools)));
        }
        const joined = parts.join(', ');
        return joined.charAt(0).toUpperCase() + joined.slice(1);
    }

    /** Verb-first row label parts ("Ran" + command excerpt, "Read" + file name). */
    protected resolveToolRowParts(
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        kind: string,
    ): ReturnType<typeof resolveTranscriptToolRowParts> {
        if (this.resolversUi.isTranscriptPureReadTool(segment.name)) {
            const readDetail = formatReadToolDetailFromArgs(segment.args);
            if (readDetail) {
                return { verb: 'Read', detail: readDetail };
            }
        }
        return resolveTranscriptToolRowParts(kind, segment.name, {
            path: this.resolversUi.extractTranscriptToolFullPath(segment.args),
            command: this.resolversUi.extractTranscriptToolCommand(segment.args),
        });
    }

    createTranscriptToolPill(
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },
    ): HTMLDetailsElement {
        const manualApproval = !!conv && conversationUsesInteractiveApprovals(conv);
        const descriptors = resolveTranscriptToolPillDescriptors([segment], {
            resolvePath: args => this.resolversUi.extractTranscriptToolFullPath(args),
        });
        const descriptor = descriptors[0];
        const kind = descriptor?.kind ?? this.resolversUi.resolveTranscriptToolKind(segment.name);
        const pill = document.createElement('details');
        pill.className = `theia-mobile-agent-tool-pill theia-mod-${kind}`;
        pill.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, segment.toolUseId);
        pill.classList.toggle('theia-mod-running', !(descriptor?.finished ?? segment.finished));
        pill.classList.toggle('theia-mod-done', descriptor?.finished ?? segment.finished);
        pill.classList.toggle('theia-mod-failed', descriptor?.resultFailed ?? false);
        const pendingApproval = manualApproval
            && isPendingTranscriptToolSegment(segment)
            && this.host.transcriptLiveUi.hasPendingTranscriptToolApproval(conv!.id, segment.toolUseId);
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
        const rowParts = this.resolveToolRowParts(segment, kind);
        pill.append(this.toolUi.createTranscriptToolPillSummary({
            kind,
            verb: rowParts.verb,
            label: rowParts.detail,
            finished,
            failed,
            mcpServer: kind === 'mcp' ? extractTranscriptMcpServerLabel(segment.args) : undefined,
            startedAt: segment.startedAt,
            copyFrom: segment.result?.trim()
                ? () => this.resolversUi.formatTranscriptToolResult(segment.result!)
                : undefined,
        }));
        if (this.resolversUi.isTranscriptPureReadTool(segment.name)
            && !this.resolversUi.shouldShowTranscriptToolResultBody(segment, kind)) {
            return pill;
        }
        const lazyBody = this.shouldLazyHydrateTranscriptToolPillBody({
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
            this.attachLazyTranscriptToolPillHydration(pill);
            return pill;
        }
        pill.append(this.buildTranscriptToolPillBody(segment, conv, kind, {
            pendingApproval,
            finished,
            todoChecklist: !!todoChecklist,
        }));
        return pill;
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

    protected attachLazyTranscriptToolPillHydration(pill: HTMLDetailsElement): void {
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
            pill.append(this.buildTranscriptToolPillBody(payload.segment, payload.conv, payload.kind, {
                pendingApproval: false,
                finished: payload.finished,
                todoChecklist: false,
            }));
        });
    }

    protected buildTranscriptToolPillBody(
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv: QaapAgentConversationDTO | undefined,
        kind: string,
        options: {
            readonly pendingApproval: boolean;
            readonly finished: boolean;
            readonly todoChecklist: boolean;
        },
    ): HTMLElement {
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-tool-pill-body';
        if (options.pendingApproval && conv) {
            body.append(this.createTranscriptToolApprovalActions(conv.id, segment));
        }
        const richPayload = resolveTranscriptToolUiPayloadFromSegment(segment.name, segment.args, segment.result);
        if (richPayload && !segment.result?.trim()) {
            body.append(buildTranscriptToolUiPayloadElement(richPayload));
        }
        if (segment.result?.trim() || options.todoChecklist) {
            body.append(this.toolUi.createTranscriptToolResultBody(
                segment,
                kind,
                { streaming: !options.finished },
            ));
        } else if (!options.finished) {
            this.toolUi.ensureTranscriptToolSpeculativePlaceholder(body, segment);
        }
        return body;
    }

    createTranscriptToolApprovalActions(
        conversationId: string,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    ): HTMLElement {
        const pending = this.host.transcriptLiveUi.getPendingTranscriptToolApproval(conversationId, segment.toolUseId);
        const onSettled = (): void => {
            void this.host.transcriptLiveUi.refreshTranscriptApprovals();
            this.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
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

    protected resolveTranscriptActivityTimelineSummary(
        segments: readonly QaapAgentMessageSegmentDTO[],
        items: readonly TranscriptActivityTimelineItem[],
        hiddenCount = 0,
        options?: { readonly streaming?: boolean },
    ): string {
        const summaryItems = items.filter(item => !isTranscriptExecutionTimelineNarrative(item));
        return resolveTranscriptActivityTimelineSummaryText(segments, summaryItems, hiddenCount, {
            streaming: options?.streaming,
            formatExploredSummary: exploredSegments => {
                const stats = resolveTranscriptActivityStats(exploredSegments);
                return hasTranscriptActivityStats(stats)
                    ? this.formatTranscriptActivityMeta(stats)
                    : undefined;
            },
        });
    }

    createTranscriptActivityTimeline(
        segments: QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions & { readonly includeThinkingSteps?: boolean },
    ): HTMLElement | undefined {
        const variant = options?.variant ?? 'inline';
        const includeThinkingSteps = options?.includeThinkingSteps ?? (variant === 'inline' || variant === 'plan');
        const items = this.resolveTranscriptActivityItemsForDisplay(segments, {
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
            label.textContent = this.resolveTranscriptActivityTimelineSummary(segments, items, 0, {
                streaming: !!options?.streaming,
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
            this.syncTranscriptActivityTimelineElement(timeline, timelineItems, timelineOptions);
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
        timeline.append(this.createTranscriptPremiumHead(
            'codicon-checklist',
            nls.localize('qaap/mobileProjects/planLabel', 'Execution plan'),
            { count: timelineItems.filter(item => !isTranscriptExecutionTimelineNarrative(item)).length, variant: 'todos' },
        ));
        const list = document.createElement('ol');
        list.className = 'theia-mobile-agent-activity-list';
        bindTranscriptActivityListKeyboard(list);
        timeline.append(list);
        this.syncTranscriptActivityTimelineElement(timeline, timelineItems, timelineOptions);
        return timeline;
    }

    protected syncTranscriptActivityItemElement(
        li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier> = isActive ? 'current' : 'recent',
    ): void {
        if (isTranscriptExecutionTimelineNarrative(item)) {
            this.syncTranscriptExecutionNarrativeItemElement(li, item, tier);
            return;
        }
        const shimmerActive = isActive
            && !!options?.streaming
            && !options?.stalled
            && !options?.timedOut
            && isTranscriptActivityLiveState(item.state)
            && !this.resolveTranscriptStreamVisualIdle(options?.segments ?? [], !!options?.streaming);
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
            this.applyTranscriptActivityItemChrome(li, item, isActive, options, tierClass, shimmerActive);
            li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, itemFingerprint);
            li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_CONTENT_FP_ATTR, contentFingerprint);
            recordTranscriptRenderMetric('timeline_item_sync_light');
            return;
        }
        li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR, itemFingerprint);
        li.setAttribute(TRANSCRIPT_ACTIVITY_ITEM_CONTENT_FP_ATTR, contentFingerprint);
        recordTranscriptRenderMetric('timeline_item_sync');
        const nestClass = transcriptActivityNestDepthClassName(item.nestDepth ?? 0) ?? '';
        const expandableThinking = item.thinkingContent || item.navigate === 'thought';
        const expandableStep = !expandableThinking && this.shouldShowTranscriptActivityItemExpand(item, options);
        const roleClass = item.timelineRole ? ` theia-mod-${item.timelineRole}` : '';
        li.className = `theia-mobile-agent-activity-item theia-mod-${item.state}${roleClass}${isActive ? ' theia-mod-active' : ''}${item.grouped ? ' theia-mod-grouped' : ''}${item.subagentRoot ? ' theia-mod-subagent-root' : ''}${expandableThinking ? ' theia-mod-expandable-thinking' : ''}${expandableStep ? ' theia-mod-expandable-step' : ''}${nestClass ? ` ${nestClass}` : ''} ${tierClass}`;
        if (isActive) {
            li.setAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR, 'true');
            li.setAttribute('aria-current', 'step');
        } else {
            li.removeAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR);
            li.removeAttribute('aria-current');
        }
        const newIcon = this.createTranscriptActivityIcon(
            item.thinkingContent || item.navigate === 'thought' ? 'thinking' : item.state,
            isActive,
            item.thinkingContent || item.navigate === 'thought' ? 'thinking' : item.toolKind,
            !!options?.streaming || (!!options?.conv && options.conv.status === 'streaming'),
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
                copy.append(this.createTranscriptActivityLabel(item.label, false));
            }
            li.append(copy);
        }
        this.populateTranscriptActivityStepCopy(copy, item, isActive, options);

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
        this.syncTranscriptCheckpointRestoreAction(li, item);
    }

    protected syncTranscriptExecutionNarrativeItemElement(
        li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier>,
    ): void {
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

    protected syncTranscriptCheckpointRestoreAction(
        li: HTMLElement,
        item: TranscriptActivityTimelineItem,
    ): void {
        const checkpointId = item.checkpointId;
        const conv = this.host.transcriptLastConv;
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
            void this.restoreTranscriptCheckpoint(checkpointId!, label);
        };
    }

    /** Evita ghost-tap en filas clickables al cerrar un expand del timeline (móvil). */
    protected guardTranscriptActivityExpandClose(host: HTMLElement | null | undefined): void {
        const row = host?.closest('li.theia-mobile-agent-activity-item');
        if (!(row instanceof HTMLElement)) {
            return;
        }
        row.classList.add('theia-mod-expand-close-guarded');
        window.setTimeout(() => {
            row.classList.remove('theia-mod-expand-close-guarded');
        }, 420);
    }

    async restoreTranscriptCheckpoint(checkpointId: string, checkpointLabel?: string): Promise<void> {
        const conv = this.host.transcriptLastConv;
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
            this.host.conversations?.recordSnapshot(conversationToSummary(updated));
            if (this.onConversationMutation) {
                this.onConversationMutation(updated);
            } else {
                this.host.transcriptLastConv = updated;
                this.host.transcriptLastFingerprint = undefined;
                this.host.transcriptStickyComposerUi.refreshComposerActivityStack();
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

    protected applyTranscriptActivityItemChrome(
        li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options: TranscriptActivityTimelineOptions | undefined,
        tierClass: string,
        shimmerActive: boolean,
    ): void {
        const nestClass = transcriptActivityNestDepthClassName(item.nestDepth ?? 0) ?? '';
        const expandableThinking = item.thinkingContent || item.navigate === 'thought';
        const expandableStep = !expandableThinking && this.shouldShowTranscriptActivityItemExpand(item, options);
        const roleClass = item.timelineRole ? ` theia-mod-${item.timelineRole}` : '';
        li.className = `theia-mobile-agent-activity-item theia-mod-${item.state}${roleClass}${isActive ? ' theia-mod-active' : ''}${item.grouped ? ' theia-mod-grouped' : ''}${item.subagentRoot ? ' theia-mod-subagent-root' : ''}${expandableThinking ? ' theia-mod-expandable-thinking' : ''}${expandableStep ? ' theia-mod-expandable-step' : ''}${nestClass ? ` ${nestClass}` : ''} ${tierClass}`;
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
                this.populateTranscriptActivityStepCopy(copy, item, isActive, options);
            } else {
                this.applyTranscriptActivityStepShimmer(copy, isActive, shimmerActive, !!options?.stalled);
            }
        }
        this.syncTranscriptCheckpointRestoreAction(li, item);
    }

    protected applyTranscriptActivityStepShimmer(
        copy: HTMLElement,
        isActive: boolean,
        shimmerActive: boolean,
        stalled: boolean,
    ): void {
        const labelForShimmer = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-label')
            ?? copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-row');
        labelForShimmer?.classList.toggle('theia-mod-shimmer', shimmerActive);
        labelForShimmer?.classList.toggle('theia-mod-stall', isActive && stalled);
    }

    protected syncTranscriptActivityStepCopyCursorTrace(
        rowEl: HTMLElement,
        item: TranscriptActivityTimelineItem,
    ): boolean {
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
        const detailAsPill = this.shouldRenderTranscriptActivityDetailAsPill(item.detail, item.toolKind);
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
            const iconClass = `theia-mobile-agent-activity-file-icon codicon ${this.transcriptFileIconClass(item.detail ?? '')}`;
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
        this.ensureTranscriptActivityVerbDetailSpacing(rowEl);
        return true;
    }

    protected ensureTranscriptActivityVerbDetailSpacing(rowEl: HTMLElement): void {
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

    protected appendTranscriptActivityEditDiffTail(
        rowEl: HTMLElement,
        added: number,
        removed: number,
    ): void {
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

    protected resolveTranscriptActivityExpandDeps(): TranscriptActivityExpandDeps {
        return {
            extractToolPath: args => this.resolversUi.extractTranscriptToolPath(args),
            extractToolCommand: args => this.resolversUi.extractTranscriptToolCommand(args),
            formatToolLabel: (toolName, args) => formatToolActivityLabel(toolName, args),
        };
    }

    protected resolveTranscriptActivityExpandContent(
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,
    ): TranscriptActivityExpandContent | undefined {
        const content = resolveTranscriptActivityExpandContent(item, options?.segments, this.resolveTranscriptActivityExpandDeps());
        if (!content) {
            return undefined;
        }
        return this.enrichTranscriptActivityExpandContent(content, item, options);
    }

    protected enrichTranscriptActivityExpandContent(
        content: TranscriptActivityExpandContent,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,
    ): TranscriptActivityExpandContent {
        if (content.kind === 'text' || content.kind === 'todo' || content.kind === 'search-matches' || content.kind === 'question_flow') {
            return content;
        }
        if (content.kind === 'read') {
            const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
            return {
                kind: 'read',
                entry: this.enrichTranscriptActivityReadExpandEntry(content.entry, segment),
            };
        }
        if (content.kind === 'read-group') {
            return {
                kind: 'read-group',
                entries: content.entries.map((entry, index) => {
                    const segmentIndex = item.segmentIndices?.[index];
                    const segment = segmentIndex !== undefined ? options?.segments?.[segmentIndex] : undefined;
                    return this.enrichTranscriptActivityReadExpandEntry(entry, segment);
                }),
            };
        }
        if (content.kind === 'edit') {
            const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
            return {
                kind: 'edit',
                entry: this.enrichTranscriptActivityEditExpandEntry(content.entry, segment, options),
            };
        }
        if (content.kind === 'edit-group') {
            return {
                kind: 'edit-group',
                entries: content.entries.map((entry, index) => {
                    const segmentIndex = item.segmentIndices?.[index];
                    const segment = segmentIndex !== undefined ? options?.segments?.[segmentIndex] : undefined;
                    return this.enrichTranscriptActivityEditExpandEntry(entry, segment, options);
                }),
            };
        }
        const enrich = (
            entry: TranscriptActivityTerminalExpandEntry,
            segment?: QaapAgentMessageSegmentDTO,
        ): TranscriptActivityTerminalExpandEntry => {
            const rawOutput = segment?.type === 'tool' ? segment.result : entry.output;
            const failed = this.resolversUi.transcriptToolResultFailed(rawOutput, segment?.type === 'tool' ? segment.name : undefined);
            const finished = entry.finished ?? (segment?.type === 'tool' ? segment.finished : true);
            const output = rawOutput?.trim() && !/^ok$/i.test(rawOutput.trim())
                ? this.resolversUi.formatTranscriptToolResult(rawOutput)
                : undefined;
            const exitCode = finished
                ? (this.toolUi.parseTranscriptShellExitCode(rawOutput) ?? (failed ? 1 : undefined))
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

    protected enrichTranscriptActivityReadExpandEntry(
        entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,
    ): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityReadExpandEntry {
        const raw = segment?.type === 'tool' ? segment.result : entry.text;
        const text = raw?.trim() && !/^ok$/i.test(raw.trim())
            ? this.resolversUi.formatTranscriptToolResult(raw)
            : entry.text;
        return {
            path: entry.path ?? (segment?.type === 'tool' ? this.resolversUi.extractTranscriptToolPath(segment.args) : undefined),
            text,
        };
    }

    protected enrichTranscriptActivityEditExpandEntry(
        entry: import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry,
        segment?: QaapAgentMessageSegmentDTO,
        options?: TranscriptActivityTimelineOptions,
    ): import('../common/qaap-transcript-activity-expand-core').TranscriptActivityEditExpandEntry {
        const stats = options?.segments
            ? this.resolversUi.resolveTranscriptFileDiffStats([...options.segments], entry.path)
            : {};
        return {
            path: entry.path,
            added: stats.added ?? entry.added,
            removed: stats.removed ?? entry.removed,
        };
    }

    protected shouldShowTranscriptActivityItemExpand(
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,
    ): boolean {
        const content = this.resolveTranscriptActivityExpandContent(item, options);
        return shouldShowTranscriptActivityExpandContent(item, content);
    }

    protected unwrapTranscriptActivityExpandCopy(copy: HTMLElement): void {
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

    protected syncTranscriptActivityExpandCopy(copy: HTMLElement, content: TranscriptActivityExpandContent): void {
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
                        this.guardTranscriptActivityExpandClose(copy);
                    }
                });
            }
            details = created;
        }
        const bodyEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-expand-body');
        if (bodyEl) {
            this.renderTranscriptActivityExpandBody(bodyEl, content);
        }
        if (!details.dataset.expandUserExpanded) {
            details.open = false;
        }
    }

    protected renderTranscriptActivityExpandBody(body: HTMLElement, content: TranscriptActivityExpandContent): void {
        body.replaceChildren();
        body.className = `theia-mobile-agent-activity-expand-body theia-mod-${content.kind}`;
        if (content.kind === 'text') {
            body.textContent = content.text;
            return;
        }
        if (content.kind === 'search-matches') {
            body.append(this.toolUi.createTranscriptActivitySearchMatchesPanel(content.matches));
            return;
        }
        if (content.kind === 'read') {
            body.append(this.toolUi.createTranscriptActivityReadExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'read-group') {
            body.append(this.toolUi.createTranscriptActivityReadExpandPanel(content.entries));
            return;
        }
        if (content.kind === 'edit') {
            body.append(this.toolUi.createTranscriptActivityEditExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'edit-group') {
            body.append(this.toolUi.createTranscriptActivityEditExpandPanel(content.entries));
            return;
        }
        if (content.kind === 'terminal') {
            body.append(this.toolUi.createTranscriptActivityTerminalExpandPanel([content.entry], { single: true }));
            return;
        }
        if (content.kind === 'todo') {
            body.append(this.toolUi.createTranscriptActivityTodoExpandPanel(content.items));
            return;
        }
        if (content.kind === 'question_flow') {
            body.append(buildTranscriptToolUiPayloadElement(content.payload));
            return;
        }
        body.append(this.toolUi.createTranscriptActivityTerminalExpandPanel(content.entries));
    }

    protected syncTranscriptActivityRunningBadge(
        copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
    ): void {
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
            badge = this.toolUi.createTranscriptActivityRunningBadge();
            const anchor = copy.querySelector('.theia-mobile-agent-activity-row')
                ?? copy.querySelector('.theia-mobile-agent-activity-label');
            anchor?.after(badge);
        }
    }

    protected syncTranscriptActivityErrorCopy(
        copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        options?: TranscriptActivityTimelineOptions,
    ): void {
        const segment = item.segmentIndex !== undefined ? options?.segments?.[item.segmentIndex] : undefined;
        const raw = segment?.type === 'tool' ? segment.result : item.errorSummary;
        const display = resolveTranscriptToolErrorDisplay(raw ?? item.errorSummary);
        if (!display) {
            copy.querySelector('.theia-mobile-agent-activity-error-panel')?.remove();
            return;
        }
        let panel = copy.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-error-panel');
        const retry = item.state === 'error' ? this.host.retryOpenTranscriptStream : undefined;
        if (!panel) {
            panel = this.toolUi.createTranscriptActivityErrorPanel(display, {
                defaultOpen: false,
                onRetry: retry ? () => this.host.retryOpenTranscriptStream?.() : undefined,
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
                    this.guardTranscriptActivityExpandClose(copy);
                }
            });
        }
    }

    protected syncTranscriptActivityThinkingCopy(
        copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
    ): void {
        copy.querySelector('.theia-mobile-agent-activity-row:not(.theia-mobile-agent-activity-thinking-summary .theia-mobile-agent-activity-row)')?.remove();
        copy.querySelector('.theia-mobile-agent-activity-label')?.remove();
        let details = copy.querySelector<HTMLDetailsElement>('.theia-mobile-agent-activity-thinking');
        if (!details) {
            details = document.createElement('details');
            details.className = 'theia-mobile-agent-activity-thinking';
            const summary = document.createElement('summary');
            summary.className = 'theia-mobile-agent-activity-thinking-summary';
            const rowEl = document.createElement('span');
            rowEl.className = 'theia-mobile-agent-activity-row';
            const verb = document.createElement('span');
            verb.className = 'theia-mobile-agent-activity-verb';
            rowEl.append(verb);
            const chevron = document.createElement('span');
            chevron.className = 'theia-mobile-agent-activity-thinking-chevron codicon codicon-chevron-right';
            chevron.setAttribute('aria-hidden', 'true');
            summary.append(rowEl, chevron);
            const body = document.createElement('div');
            body.className = 'theia-mobile-agent-activity-thinking-body';
            details.append(summary, body);
            copy.prepend(details);
            summary.addEventListener('click', event => event.stopPropagation());
        }
        if (item.segmentIndex !== undefined) {
            details.dataset.transcriptThinkingSegment = String(item.segmentIndex);
        } else {
            details.removeAttribute('data-transcript-thinking-segment');
        }
        const summaryEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-thinking-summary');
        summaryEl?.querySelector('.theia-mobile-agent-activity-tail')?.remove();
        copy.querySelector(':scope > .theia-mobile-agent-activity-meta')?.remove();
        details.querySelector(':scope > .theia-mobile-agent-activity-meta')?.remove();
        const verbEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-verb');
        const bodyEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-thinking-body');
        const rowEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-row');
        const shimmerActive = isActive
            && !!options?.streaming
            && !options?.stalled
            && isTranscriptActivityLiveState(item.state)
            && !this.resolveTranscriptStreamVisualIdle(options?.segments ?? [], !!options?.streaming);
        if (verbEl) {
            verbEl.textContent = nls.localize('qaap/mobileProjects/transcriptThinking', 'Thinking');
            verbEl.classList.toggle('theia-mod-shimmer', shimmerActive);
        }
        // Add a duration detail inline so the row reads like Devin's
        // "Thought for 1s" instead of a separate meta tag.
        let durationEl = rowEl?.querySelector<HTMLElement>('.theia-mobile-agent-activity-detail.theia-mod-thinking-duration');
        if (rowEl && item.durationMs !== undefined) {
            const durationText = formatTranscriptActivityStepDuration(item.durationMs);
            if (durationText) {
                if (!durationEl) {
                    durationEl = document.createElement('span');
                    durationEl.className = 'theia-mobile-agent-activity-detail theia-mod-thinking-duration';
                    rowEl.append(document.createTextNode(' '), durationEl);
                }
                durationEl.textContent = nls.localize('qaap/mobileProjects/transcriptThoughtForDuration', 'for {0}', durationText);
                durationEl.classList.toggle('theia-mod-shimmer', shimmerActive);
            }
        } else {
            durationEl?.remove();
        }
        // Add a dim excerpt preview below the verb so the user can see what the
        // model was reasoning about. Always visible — even when the thinking
        // details is open — to show a chain of thought below each reasoning step.
        const thinkingSummaryEl = details.querySelector<HTMLElement>('.theia-mobile-agent-activity-thinking-summary');
        const excerptEl = thinkingSummaryEl?.querySelector<HTMLElement>('.theia-mobile-agent-activity-detail.theia-mod-thinking-excerpt');
        if (thinkingSummaryEl && item.thinkingContent) {
            const excerpt = excerptTranscriptThought(item.thinkingContent, 120);
            if (excerpt) {
                let detail = excerptEl;
                if (!detail) {
                    detail = document.createElement('span');
                    detail.className = 'theia-mobile-agent-activity-detail theia-mod-thinking-excerpt';
                    thinkingSummaryEl.append(detail);
                }
                detail.textContent = excerpt;
                detail.classList.toggle('theia-mod-shimmer', shimmerActive);
            } else {
                excerptEl?.remove();
            }
        } else {
            excerptEl?.remove();
        }
        // Duration is rendered inline as 'for 1s'; remove any legacy meta tag.
        rowEl?.querySelector('.theia-mobile-agent-activity-meta')?.remove();
        if (bodyEl && item.thinkingContent) {
            bodyEl.textContent = this.contentUi.cleanTranscriptDisplayText(item.thinkingContent);
        }
        details.classList.toggle('theia-mod-live', shimmerActive);
        // Track if the thinking was ever shown live so we can keep it expanded
        // while tools run after thinking (don't auto-collapse reasoning mid-turn).
        if (shimmerActive) {
            details.dataset.thinkingWasLive = '1';
        }
        // Detect the overall message phase: while the model is writing its
        // final text response (or once the turn has settled), auto-collapse
        // the chain of thought so the summary takes focus. While tools are
        // still acting, keep the reasoning visible.
        const segments = options?.segments ?? [];
        const phase = resolveTranscriptTraceDisplayPhase(segments, !!options?.streaming);
        const isStreaming = !!options?.streaming;
        const writingOrSettled = phase === 'writing' || phase === 'settled';
        if (writingOrSettled) {
            details.dataset.thinkingCollapsedForWriting = '1';
        }
        if (!details.dataset.thinkingUserToggled) {
            // Once opened during streaming, keep thinking visible while tools
            // run; collapse only when the model starts writing the final text.
            if (isStreaming && !writingOrSettled) {
                if (details.dataset.thinkingWasLive === '1' && !details.open) {
                    details.dataset.thinkingProgrammaticToggle = '1';
                    details.open = true;
                }
            } else {
                // Writing or settled — auto-collapse unless user toggled.
                const collapsedForWriting = details.dataset.thinkingCollapsedForWriting === '1';
                const desiredOpen = shimmerActive
                    || (details.dataset.thinkingWasLive === '1' && !collapsedForWriting);
                if (details.open !== desiredOpen) {
                    details.dataset.thinkingProgrammaticToggle = '1';
                    details.open = desiredOpen;
                }
            }
        }
        // Reflect the open state on the copy element so CSS can hide the
        // streaming cursor when the thinking body is already visible.
        copy.classList.toggle('theia-mod-thinking-open', details.open);
        if (!details.dataset.thinkingToggleBound) {
            details.dataset.thinkingToggleBound = '1';
            details.addEventListener('toggle', () => {
                if (details.dataset.thinkingProgrammaticToggle) {
                    details.removeAttribute('data-thinking-programmatic-toggle');
                    copy.classList.toggle('theia-mod-thinking-open', details.open);
                    return;
                }
                details.dataset.thinkingUserToggled = '1';
                copy.classList.toggle('theia-mod-thinking-open', details.open);
                if (!details.open) {
                    this.guardTranscriptActivityExpandClose(copy);
                }
            });
        }
    }

    protected populateTranscriptActivityStepCopy(
        copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
    ): void {
        if (item.thinkingContent || item.navigate === 'thought') {
            this.syncTranscriptActivityThinkingCopy(copy, item, isActive, options);
            return;
        }
        this.unwrapTranscriptActivityExpandCopy(copy);

        let label: HTMLElement | undefined = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-label') ?? undefined;
        if (options?.cursorTrace && item.verb && item.detail) {
            let rowEl = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-row');
            if (!rowEl) {
                label?.remove();
                label = undefined;
                rowEl = document.createElement('span');
                rowEl.className = 'theia-mobile-agent-activity-row';
                copy.prepend(rowEl);
            }
            if (!this.syncTranscriptActivityStepCopyCursorTrace(rowEl, item)) {
                rowEl.replaceChildren();
                const verb = document.createElement('span');
                verb.className = 'theia-mobile-agent-activity-verb';
                verb.textContent = item.verb;
                const detail = document.createElement('span');
                detail.className = 'theia-mobile-agent-activity-detail';
                const detailAsPill = this.shouldRenderTranscriptActivityDetailAsPill(item.detail, item.toolKind);
                detail.classList.toggle('theia-mod-pill', detailAsPill);
                detail.classList.toggle('theia-mod-command', item.toolKind === 'terminal' && !detailAsPill);
                detail.classList.toggle('theia-mod-edit-file', item.toolKind === 'editing' && detailAsPill);
                if (detailAsPill && item.detail) {
                    detail.append(this.createTranscriptActivityFileChip(item.detail, item.toolKind));
                } else {
                    detail.textContent = item.detail ?? '';
                }
                rowEl.append(verb, document.createTextNode(' '), detail);
                if (item.editAdded !== undefined || item.editRemoved !== undefined) {
                    this.appendTranscriptActivityEditDiffTail(rowEl, item.editAdded ?? 0, item.editRemoved ?? 0);
                } else if (item.tail) {
                    const tail = document.createElement('span');
                    tail.className = 'theia-mobile-agent-activity-tail';
                    tail.textContent = ` ${item.tail}`;
                    rowEl.append(tail);
                }
            }
        } else {
            copy.querySelector('.theia-mobile-agent-activity-row')?.remove();
            if (!label) {
                label = this.createTranscriptActivityLabel(item.label, false);
                copy.prepend(label);
            }
            label.textContent = item.label;
        }

        this.applyTranscriptActivityStepShimmer(
            copy,
            isActive,
            isActive
            && !!options?.streaming
            && !options?.stalled
            && isTranscriptActivityLiveState(item.state),
            !!options?.stalled,
        );
        this.syncTranscriptActivityRunningBadge(copy, item, isActive, options);

        let mcpBadge = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-mcp-badge');
        if (item.toolKind === 'mcp') {
            if (!mcpBadge) {
                mcpBadge = document.createElement('span');
                mcpBadge.className = 'theia-mobile-agent-activity-mcp-badge';
                mcpBadge.setAttribute('aria-hidden', 'true');
                (copy.querySelector('.theia-mobile-agent-activity-row') ?? label)?.after(mcpBadge);
            }
            mcpBadge.textContent = 'MCP';
        } else {
            mcpBadge?.remove();
        }

        const metaText = formatTranscriptActivityStepMeta(item.durationMs, item.timestamp);
        let meta = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-meta');
        if (metaText) {
            if (!meta) {
                meta = document.createElement('span');
                meta.className = 'theia-mobile-agent-activity-meta';
                if (options?.cursorTrace) {
                    (copy.querySelector('.theia-mobile-agent-activity-row') ?? label)?.after(meta);
                } else {
                    copy.append(meta);
                }
            }
            meta.textContent = metaText;
        } else {
            meta?.remove();
        }

        let errorDetail = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-error-detail');
        if (item.errorSummary && item.state === 'error') {
            errorDetail?.remove();
            copy.querySelector('.theia-mobile-agent-activity-error-expand')?.remove();
            this.syncTranscriptActivityErrorCopy(copy, item, options);
        } else {
            copy.querySelector('.theia-mobile-agent-activity-error-panel')?.remove();
            errorDetail?.remove();
            copy.querySelector('.theia-mobile-agent-activity-error-expand')?.remove();
        }

        let waitingBadge = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-waiting-badge');
        if (item.state === 'waiting') {
            if (!waitingBadge) {
                waitingBadge = document.createElement('span');
                waitingBadge.className = 'theia-mobile-agent-activity-waiting-badge';
                const badgeIcon = document.createElement('span');
                badgeIcon.className = 'codicon codicon-shield';
                badgeIcon.setAttribute('aria-hidden', 'true');
                const badgeLabel = document.createElement('span');
                badgeLabel.className = 'theia-mobile-agent-activity-waiting-badge-label';
                badgeLabel.textContent = nls.localize('qaap/mobileProjects/transcriptWaitingApproval', 'Awaiting approval');
                waitingBadge.append(badgeIcon, badgeLabel);
                (copy.querySelector('.theia-mobile-agent-activity-row') ?? label)?.after(waitingBadge);
            }
        } else {
            waitingBadge?.remove();
        }

        let resultPreview = copy.querySelector<HTMLElement>('.theia-mobile-agent-activity-result-preview');
        const expandContent = this.resolveTranscriptActivityExpandContent(item, options);
        const showExpand = shouldShowTranscriptActivityExpandContent(item, expandContent);
        if (showExpand && expandContent) {
            resultPreview?.remove();
            this.syncTranscriptActivityExpandCopy(copy, expandContent);
        } else {
            copy.querySelector('.theia-mobile-agent-activity-expand')?.remove();
            if (item.resultPreview && item.toolKind === 'reading' && !item.grouped) {
                if (!resultPreview) {
                    resultPreview = document.createElement('div');
                    resultPreview.className = 'theia-mobile-agent-activity-result-preview';
                    copy.append(resultPreview);
                }
                if (resultPreview.textContent !== item.resultPreview) {
                    resultPreview.textContent = item.resultPreview;
                }
            } else {
                resultPreview?.remove();
            }
        }
    }

    protected shouldRenderTranscriptActivityDetailAsPill(
        detail: string | undefined,
        toolKind?: string,
    ): boolean {
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

    protected createTranscriptActivityFileChip(detail: string, toolKind?: string): HTMLElement {
        const chip = document.createElement('span');
        chip.className = 'theia-mobile-agent-activity-file-chip';
        if (toolKind === 'editing') {
            chip.classList.add('theia-mod-edit-link');
        }
        chip.setAttribute('role', 'button');
        chip.tabIndex = 0;
        const icon = document.createElement('span');
        icon.className = `codicon ${this.transcriptFileIconClass(detail)}`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-activity-file-chip-label';
        label.textContent = detail;
        chip.append(icon, label);
        return chip;
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

    createTranscriptActivityIcon(
        state: TranscriptActivityStepState,
        active: boolean,
        toolKind?: string,
        streaming?: boolean,
    ): HTMLElement {
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-activity-icon';
        icon.setAttribute('aria-hidden', 'true');
        const kindIconClass = toolKind ? this.activityToolKindIconMap[toolKind] : undefined;
        if (state === 'thinking' || toolKind === 'thinking') {
            if (active && isTranscriptActivityLiveState(state) && streaming) {
                const spinner = createUnicodeSpinner();
                spinner.classList.add('theia-mobile-agent-activity-icon-spinner');
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
        if (active && isTranscriptActivityLiveState(state)) {
            if (streaming) {
                const spinner = createUnicodeSpinner();
                spinner.classList.add('theia-mobile-agent-activity-icon-spinner');
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
                break;
            case 'running':
            default:
                if (toolKind && kindIconClass) {
                    icon.classList.add('theia-mod-kind', 'theia-mod-running', 'codicon', kindIconClass);
                } else {
                    icon.classList.add('theia-mod-running', 'codicon', 'codicon-sync');
                }
                break;
        }
        return icon;
    }

    createTranscriptActivityLabel(text: string, active = false): HTMLElement {
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-activity-label';
        label.textContent = text;
        label.classList.toggle('theia-mod-shimmer', active);
        return label;
    }

    /** Consistent card header: a muted leading codicon plus a label, shared by the premium cards. */

    createTranscriptPremiumHead(
        iconClass: string,
        label: string,
        options?: { readonly count?: number; readonly variant?: 'default' | 'todos' },
    ): HTMLElement {
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

    createTranscriptDiffSummaryCard(segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        const stats = this.resolversUi.resolveTranscriptDiffStats(segments);
        if (!stats || (stats.added === 0 && stats.removed === 0)) {
            return undefined;
        }
        const card = document.createElement('section');
        card.className = 'theia-mobile-agent-premium-card theia-mobile-agent-diff-summary';
        card.append(this.createTranscriptPremiumHead(
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

    createTranscriptChangedFilesCard(segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        const files = this.resolversUi.resolveTranscriptChangedFiles(segments);
        if (files.length === 0) {
            return undefined;
        }
        const stats = this.resolversUi.resolveTranscriptDiffStats(segments);

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
            this.appendTranscriptChangedFileDiffStats(statsRow, summaryStats.added ?? 0, summaryStats.removed ?? 0);
            summary.append(statsRow);
        } else if (files.length > 1 && stats && (stats.added > 0 || stats.removed > 0)) {
            const statsRow = document.createElement('span');
            statsRow.className = 'theia-mobile-agent-changed-files-stats';
            this.appendTranscriptChangedFileDiffStats(statsRow, stats.added, stats.removed);
            summary.append(statsRow);
        }
        summary.append(this.createTranscriptChangedFilesReviewButton());
        card.append(summary);

        const collapsedPreview = document.createElement('div');
        collapsedPreview.className = 'theia-mobile-agent-changed-files-collapsed-preview';
        if (files.length === 1) {
            const miniDiff = this.createTranscriptChangedFileMiniDiffPreview(segments, files[0]!);
            if (miniDiff) {
                collapsedPreview.append(miniDiff);
            } else {
                collapsedPreview.append(this.createTranscriptChangedFileRow(files[0]!, { compact: true }));
            }
        } else {
            const previewFiles = files.slice(0, 4);
            for (const file of previewFiles) {
                collapsedPreview.append(this.createTranscriptChangedFileRow(file, { compact: true }));
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
            list.append(this.createTranscriptChangedFileRow(file));
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

    protected createTranscriptChangedFileMiniDiffPreview(
        segments: readonly QaapAgentMessageSegmentDTO[],
        file: { readonly path: string },
    ): HTMLElement | undefined {
        for (const segment of segments) {
            if (segment.type !== 'tool') {
                continue;
            }
            const path = this.resolversUi.extractTranscriptToolPath(segment.args);
            if (path !== file.path || !segment.result?.trim()) {
                continue;
            }
            const card = extractTranscriptDiffCard(
                this.resolversUi.formatTranscriptToolResult(segment.result),
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

    /** "Review" button in the changed-files header — jumps to the transcript's diff Review tab. */

    createTranscriptChangedFilesReviewButton(): HTMLButtonElement {
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
            const project = this.host.transcriptComposerProject;
            const convSummary = this.host.transcriptComposerSummary;
            if (project && convSummary) {
                this.host.executionSurfaceTabsUi.selectTranscriptTab('review', project, convSummary);
            }
        });
        return review;
    }

    protected appendTranscriptChangedFileDiffStats(
        parent: HTMLElement,
        added: number,
        removed: number,
    ): void {
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

    createTranscriptChangedFileRow(
        file: { readonly path: string; readonly kind: 'edited' | 'created'; readonly added?: number; readonly removed?: number },
        options?: { readonly compact?: boolean },
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = `theia-mobile-agent-changed-file theia-mod-${file.kind}${options?.compact ? ' theia-mod-compact' : ''}`;

        const icon = document.createElement('span');
        icon.className = `theia-mobile-agent-changed-file-icon codicon ${this.transcriptFileIconClass(file.path)}`;
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
            this.appendTranscriptChangedFileDiffStats(stats, added, removed);
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
        this.toolUi.attachTranscriptReviewFileOpenAction(row, file.path);
        return row;
    }

    /** Codicon for a changed-file row, derived from the file extension. */

    transcriptFileIconClass(path: string): string {
        return getFileIconClass(path);
    }

    createTranscriptVerificationCard(segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
        const checks = this.resolversUi.resolveTranscriptVerificationChecks(segments);
        if (checks.length === 0) {
            return undefined;
        }
        const card = document.createElement('section');
        card.className = 'theia-mobile-agent-premium-card theia-mobile-agent-verification';
        card.append(this.createTranscriptPremiumHead(
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

    createTranscriptTechnicalDetailsCard(
        segments: QaapAgentMessageSegmentDTO[],
        options?: { readonly activityTimelineShown?: boolean },
    ): HTMLElement | undefined {
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
            body.append(this.toolUi.createTranscriptSegmentDetails(segment));
        }
        details.append(body);
        return details;
    }

    createTranscriptStreamingActivityRow(conv: QaapAgentConversationDTO): HTMLElement | undefined {
        const segments = [...resolveTranscriptStreamingAgentSegments(conv)];
        const awaitingFirstAgentOutput = isAwaitingFirstTranscriptAgentOutput(conv);
        const turnStartMs = resolveTranscriptTurnStartMs(conv.messages);
        const stalled = this.resolveTranscriptStreamStalled(conv);
        const timedOut = this.resolveTranscriptStreamTimedOut(conv);
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
        const state = this.resolveTranscriptStreamingActivity(conv, { stalled, timedOut });

        // CloudCode-style setup animation: show whimsical phrases + unicode spinner
        // + per-letter shimmer while the agent is in its initial setup or thinking
        // phase (no tool calls or answer text yet). Once the agent starts producing
        // output, fall back to the stream line with the real status.
        const phase = resolveTranscriptTraceDisplayPhase(segments, !stalled && !timedOut);
        const useSetupAnimation = (awaitingFirstAgentOutput || phase === 'thinking') && !stalled && !timedOut;
        if (useSetupAnimation) {
            const setupEl = createAgentSetupElement(state.title);
            const meta = this.createTranscriptStreamMeta(conv);
            if (meta) {
                setupEl.append(meta);
            }
            row.append(setupEl);
            const cleanupObserver = new MutationObserver(() => {
                if (!setupEl.isConnected) {
                    destroyAgentSetupElement(setupEl);
                    cleanupObserver.disconnect();
                }
            });
            cleanupObserver.observe(row, { childList: true, subtree: true });
        } else {
            const line = document.createElement('div');
            line.className = `theia-mobile-agent-stream-line theia-mod-${state.kind}`;
            const spinner = createUnicodeSpinner();
            spinner.classList.add('theia-mobile-agent-stream-dot');
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-stream-label';
            label.textContent = timedOut ? state.title : `${state.title}…`;
            label.classList.toggle('theia-mod-shimmer', shouldTranscriptStreamLabelShimmer(state.kind, stalled, timedOut));
            label.classList.toggle('theia-mod-stall', stalled || timedOut);
            line.append(spinner, label);
            const meta = this.createTranscriptStreamMeta(conv);
            if (meta) {
                line.append(meta);
            }
            row.append(line);
            const spinnerCleanup = new MutationObserver(() => {
                if (!spinner.isConnected) {
                    destroyUnicodeSpinner(spinner);
                    spinnerCleanup.disconnect();
                }
            });
            spinnerCleanup.observe(row, { childList: true, subtree: true });
        }
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
            row.classList.toggle('theia-mod-stream-stalled', stalled);
            row.classList.toggle('theia-mod-stream-timed-out', timedOut);
            if (timedOut) {
                row.append(this.createTranscriptStreamTimeoutBanner());
            }
            this.ensureTranscriptStreamStallWatch(row);
        }
        return row;
    }

    /**
     * Claude-Code-style live status suffix: "· 1m 23s · ~4.2k tokens", ticking once per second.
     * With `ownerRow`, the meta removes itself once the row leaves streaming.
     */
    protected createTranscriptStreamMeta(conv: QaapAgentConversationDTO, ownerRow?: HTMLElement): HTMLElement | undefined {
        const turnStart = resolveTranscriptTurnStartMs(conv.messages);
        if (turnStart === undefined) {
            return undefined;
        }
        const meta = document.createElement('span');
        meta.className = 'theia-mobile-agent-stream-meta';
        const update = (): void => {
            const parts = [formatTranscriptStreamElapsed(Date.now() - turnStart)];
            const tokens = formatTranscriptStreamTokens(resolveTranscriptTurnStreamChars(
                this.host.transcriptLastConv?.id === conv.id ? this.host.transcriptLastConv.messages : conv.messages,
            ));
            if (tokens) {
                parts.push(tokens);
            }
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

    resolveTranscriptStreamingActivity(
        conv: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean; readonly timedOut?: boolean },
    ): { kind: string; title: string; detail: string } {
        const segments = [...resolveTranscriptStreamingAgentSegments(conv)] as QaapAgentMessageSegmentDTO[];
        return resolveTranscriptStreamingActivityFromSegments(segments, {
            stalled: options?.stalled,
            timedOut: options?.timedOut,
            stallTitle: this.resolveTranscriptStreamStallLabel(),
            localizeToolTitle: label => this.host.projectRowsUi.localizeActivityLabel(label),
        });
    }
}
