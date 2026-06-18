// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import { formatReadToolDetailFromArgs } from '../common/qaap-agent-conversation-list-metrics';
import { classifyTranscriptToolActivityKind, excerptTranscriptThought, extractTranscriptDiffCard, extractTranscriptMcpServerLabel, hasTranscriptActivityStats, isTranscriptThoughtExcerptTruncated, isTranscriptTodoTool, parseTranscriptTodoChecklist, resolveTranscriptActivityStats, resolveTranscriptThinkingContent, resolveTranscriptToolPillDescriptors, resolveTranscriptToolRowParts, shouldOpenTranscriptToolDetails, shouldRenderTranscriptToolSegmentInline, type QaapTranscriptActivityStats } from '../common/qaap-agent-transcript-segments';
import { formatTranscriptStreamElapsed, formatTranscriptStreamTokens, formatTranscriptThoughtDuration, isTranscriptAgentThinkingPhase, isTranscriptStreamStalled, resolveLastUserPromptChars, resolveTranscriptTurnElapsedMs, resolveTranscriptTurnStartMs, resolveTranscriptTurnStreamChars, shouldExpandTranscriptInlineTimeline, shouldShowTranscriptInlineTimeline, shouldShowTranscriptStreamingActivity, shouldShowTranscriptThoughtBrief } from '../common/qaap-transcript-stream-status';
import { resolveTranscriptStreamingActivityFromSegments } from '../common/qaap-transcript-streaming-activity';
import type { TranscriptActivityNavigationItem, TranscriptActivityNavigationOptions } from '../common/qaap-transcript-activity-navigation';
import { groupTranscriptActivityNavigationItems, resolveTranscriptLifecycleActivityItems } from '../common/qaap-transcript-activity-navigation';
import { isTranscriptActivityLiveState, type TranscriptActivityStepState } from '../common/qaap-transcript-activity-step-state';
import { formatTranscriptActivityStepMeta, TranscriptActivityTimingStore } from '../common/qaap-transcript-activity-timing';
import {
    resolveTranscriptTimelineItemTier,
    transcriptTimelineTierClassName,
} from '../common/qaap-transcript-timeline-tier';
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

const TRANSCRIPT_TRACE_STATUS_ATTR = 'data-transcript-trace-status';

const transcriptActivityTimelineResync = new WeakMap<HTMLElement, () => void>();

export interface TranscriptActivityTimelineOptions {
    /** Last N steps in chat; omit or ≤0 to show the full trace (Plan tab). */
    readonly maxVisibleItems?: number;
    readonly variant?: 'inline' | 'plan';
    readonly streaming?: boolean;
    readonly stalled?: boolean;
    /** When set, controls collapsible inline timeline open state. */
    readonly expanded?: boolean;
    readonly segments?: readonly QaapAgentMessageSegmentDTO[];
    readonly row?: HTMLElement;
    readonly conv?: QaapAgentConversationDTO;
    readonly cursorTrace?: boolean;
}

interface TranscriptActivityTimelineItem extends TranscriptActivityNavigationItem { }

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
    ) { }

    createTranscriptAgentSegmentsRow(
        segments: QaapAgentMessageSegmentDTO[],
        error?: string,
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean; readonly streaming?: boolean },
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

        const thoughtBrief = this.createTranscriptThoughtBriefBlock(segments, {
            streaming,
            conv,
        });
        if (thoughtBrief) {
            body.append(thoughtBrief);
        }

        const stalled = streaming ? this.resolveTranscriptStreamStalled(conv) : false;
        const activityTimeline = shouldShowTranscriptInlineTimeline(segments, streaming)
            ? this.createTranscriptActivityTimeline(segments, {
                streaming,
                stalled,
                expanded: shouldExpandTranscriptInlineTimeline(segments, streaming),
                segments,
            })
            : undefined;
        if (activityTimeline) {
            body.append(activityTimeline);
            if (streaming) {
                const status = document.createElement('div');
                status.className = 'theia-mobile-agent-trace-status';
                status.setAttribute(TRANSCRIPT_TRACE_STATUS_ATTR, 'true');
                status.hidden = true;
                body.append(status);
            }
        }

        // Hero answer after the trace — Cursor-style: thought → timeline → response → expandable tool details.
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

        const artifacts = document.createElement('div');
        artifacts.className = 'theia-mobile-agent-transcript-artifacts';
        const activityTimelineShown = !!activityTimeline;
        const toolPills = streaming
            ? undefined
            : this.createTranscriptToolPillsStrip(segments, conv, { deferHeavyContent: defer });
        if (toolPills) {
            artifacts.append(toolPills);
        }
        const inlineDiff = (!streaming || !activityTimeline)
            ? this.createTranscriptInlineDiffStrip(segments)
            : undefined;
        if (inlineDiff) {
            artifacts.append(inlineDiff);
        }
        const changedFiles = this.createTranscriptChangedFilesCard(segments);
        if (changedFiles) {
            artifacts.append(changedFiles);
        } else {
            const diffSummary = this.createTranscriptDiffSummaryCard(segments);
            if (diffSummary) {
                artifacts.append(diffSummary);
            }
        }
        const verification = this.createTranscriptVerificationCard(segments);
        if (verification) {
            artifacts.append(verification);
        }
        if (!toolPills) {
            for (const segment of segments) {
                if (segment.type !== 'tool') {
                    continue;
                }
                if (!shouldRenderTranscriptToolSegmentInline({
                    activityTimelineShown,
                    finished: segment.finished,
                    resultFailed: this.resolversUi.transcriptToolResultFailed(segment.result),
                    toolKind: classifyTranscriptToolActivityKind(segment.name),
                    hasToolOutput: !!segment.result?.trim(),
                })) {
                    continue;
                }
                artifacts.append(this.toolUi.createTranscriptSegmentDetails(segment));
            }
        }
        if (artifacts.childElementCount > 0) {
            body.append(artifacts);
        }

        if (!thoughtBrief) {
            const technicalDetails = this.createTranscriptTechnicalDetailsCard(segments);
            if (technicalDetails) {
                body.append(technicalDetails);
            }
        }

        if (error) {
            body.append(this.toolUi.createTranscriptAgentFailureDialog(error));
        }
        row.append(body);
        if (streaming) {
            this.ensureTranscriptStreamStallWatch(row);
        }
        return row;
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
        const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
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
            const items = this.resolveTranscriptActivityItemsForDisplay([...segments], { row, conv });
            this.syncTranscriptActivityTimelineElement(timeline, items, {
                streaming: false,
                segments,
                expanded: false,
            });
        }
        if (!segmentsBody.querySelector('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')) {
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
            const project = this.host.transcriptOpenProject ?? this.host.transcriptComposerProject;
            const summary = this.host.transcriptOpenSummary ?? this.host.transcriptComposerSummary;
            if (project && summary) {
                this.host.executionSurfaceTabsUi.selectTranscriptTab('terminal', project, summary);
            }
            return;
        }
        if (item.navigate === 'thought') {
            const brief = ownerRow.querySelector('.theia-mobile-agent-thought-brief');
            if (brief instanceof HTMLDetailsElement) {
                brief.open = true;
                brief.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    protected attachTranscriptActivityItemAction(
        li: HTMLElement,
        item: TranscriptActivityNavigationItem,
        ownerRow: HTMLElement,
    ): void {
        li.removeAttribute('data-transcript-activity-action');
        li.classList.remove('theia-mod-clickable');
        if (!item.navigate) {
            return;
        }
        li.classList.add('theia-mod-clickable');
        li.dataset.transcriptActivityAction = item.navigate;
        if (item.segmentIndex !== undefined) {
            li.dataset.transcriptActivitySegmentIndex = String(item.segmentIndex);
        }
        if (li.dataset.transcriptActivityBound === '1') {
            return;
        }
        li.dataset.transcriptActivityBound = '1';
        li.addEventListener('click', event => {
            const target = event.target;
            if (target instanceof Element && target.closest('button,a,[role="button"]')) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.handleTranscriptActivityNavigation(item, ownerRow);
        });
        li.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            this.handleTranscriptActivityNavigation(item, ownerRow);
        });
        if (!li.hasAttribute('tabindex')) {
            li.tabIndex = 0;
        }
        li.setAttribute('role', 'button');
        const hint = item.navigate === 'file'
            ? nls.localize('qaap/mobileProjects/transcriptOpenFile', 'Open in editor')
            : item.navigate === 'terminal'
                ? nls.localize('qaap/mobileProjects/transcriptOpenTerminal', 'Open terminal')
                : nls.localize('qaap/mobileProjects/transcriptOpenThought', 'Show reasoning');
        li.setAttribute('aria-label', `${item.label}. ${hint}`);
    }

    /** In-place markdown refresh for streaming text segments — preserves tool pill expand state. */
    patchStreamingAgentTextSegments(
        row: HTMLElement,
        prevSegments: readonly QaapAgentMessageSegmentDTO[],
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
    ): boolean {
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
                this.refreshTranscriptToolGroupSummary(group);
            }
        }
        return true;
    }

    /** In-place activity timeline refresh — append steps and toggle the active marker during SSE. */
    protected resolveTranscriptStreamStalled(conv?: QaapAgentConversationDTO): boolean {
        return isTranscriptStreamStalled(
            this.host.transcriptLastStreamProgressAt,
            conv?.status === 'streaming',
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
        const items = annotateTranscriptActivityNestMetadata(
            groupTranscriptActivityNavigationItems([...segmentItems, ...lifecycleItems]),
            segments,
        );
        if (!options?.stalled || items.length === 0) {
            return items;
        }
        const activeIndex = items.findIndex(item => isTranscriptActivityLiveState(item.state));
        if (activeIndex < 0) {
            return items;
        }
        const stallLabel = this.resolveTranscriptStreamStallLabel();
        return items.map((item, index) => index === activeIndex
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
        if (messageId) {
            this.activityTiming.observe(messageId, segments);
        }
        const streaming = options?.streaming
            ?? row?.classList.contains('theia-mod-streaming')
            ?? conv?.status === 'streaming';
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
            const conv = this.host.transcriptLastConv;
            if (!conv || conv.status !== 'streaming') {
                return;
            }
            this.syncTranscriptStreamStallChrome(row, conv);
        }, 1000);
    }

    syncTranscriptStreamStallChrome(row: HTMLElement, conv: QaapAgentConversationDTO): void {
        const stalled = this.resolveTranscriptStreamStalled(conv);
        row.classList.toggle('theia-mod-stream-stalled', stalled);
        const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
        if (segmentsBody) {
            const timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
            if (timeline) {
                timeline.classList.toggle('theia-mod-stalled', stalled);
                const items = this.resolveTranscriptActivityItemsForDisplay(
                    this.resolveTranscriptRowSegments(conv, row),
                    { stalled, row, conv, streaming: true },
                );
                this.syncTranscriptActivityTimelineElement(timeline, items, {
                    streaming: true,
                    stalled,
                    expanded: shouldExpandTranscriptInlineTimeline(
                        this.resolveTranscriptRowSegments(conv, row),
                        true,
                    ),
                    segments: this.resolveTranscriptRowSegments(conv, row),
                });
            }
            const streamLine = segmentsBody.querySelector('.theia-mobile-agent-stream-line');
            if (streamLine) {
                this.syncTranscriptStreamingActivityLine(streamLine, conv, stalled);
            }
        }
        if (row.hasAttribute(TRANSCRIPT_ACTIVITY_ROW_ATTR)) {
            const line = row.querySelector('.theia-mobile-agent-stream-line');
            if (line) {
                this.syncTranscriptStreamingActivityLine(line, conv, stalled);
            }
            row.classList.toggle('theia-mod-stream-stalled', stalled);
        }
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
    ): void {
        const ownerRow = line.closest<HTMLElement>('.theia-mobile-agent-transcript-msg');
        const segments = ownerRow
            ? this.resolveTranscriptRowSegments(conv, ownerRow)
            : [...(conv.messages.at(-1)?.role === 'agent' ? conv.messages.at(-1)?.segments ?? [] : [])];
        const turnStartMs = resolveTranscriptTurnStartMs(conv.messages);
        const show = shouldShowTranscriptStreamingActivity(segments, true, {
            turnElapsedMs: resolveTranscriptTurnElapsedMs(turnStartMs),
            userPromptChars: resolveLastUserPromptChars(conv.messages),
            stalled,
        });
        const host = line.closest<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`) ?? line.parentElement;
        if (host instanceof HTMLElement) {
            host.hidden = !show;
        }
        if (!show) {
            return;
        }
        const state = this.resolveTranscriptStreamingActivity(conv, { stalled });
        line.className = `theia-mobile-agent-stream-line theia-mod-${state.kind}`;
        const label = line.querySelector('.theia-mobile-agent-stream-label');
        if (label) {
            label.textContent = `${state.title}…`;
            label.classList.toggle('theia-mod-shimmer', !stalled && (state.kind === 'planning' || state.kind === 'thinking'));
            label.classList.toggle('theia-mod-stall', stalled);
        }
    }

    patchStreamingActivityTimeline(
        row: HTMLElement,
        nextSegments: readonly QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
    ): boolean {
        const stalled = this.resolveTranscriptStreamStalled(conv);
        const streaming = row.classList.contains('theia-mod-streaming');
        if (!shouldShowTranscriptInlineTimeline(nextSegments, streaming)) {
            const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
            segmentsBody?.querySelector(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`)?.remove();
            this.patchStreamingThoughtBrief(row, nextSegments, conv, true);
            return true;
        }
        const items = this.resolveTranscriptActivityItemsForDisplay([...nextSegments], {
            stalled,
            row,
            conv,
            streaming,
        });
        if (items.length === 0) {
            this.patchStreamingThoughtBrief(row, nextSegments, conv, true);
            return true;
        }
        const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return false;
        }
        let timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        const timelineOptions = {
            streaming: true,
            stalled,
            expanded: shouldExpandTranscriptInlineTimeline([...nextSegments], true),
            segments: nextSegments,
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
            this.syncTranscriptActivityTimelineElement(timeline, items, timelineOptions);
        }
        this.patchStreamingThoughtBrief(row, nextSegments, conv, true);
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
            brief?.remove();
            return true;
        }
        const thinkingActive = isTranscriptAgentThinkingPhase(segments, streaming);
        if (!thinking && !hasStats && !thinkingActive) {
            brief?.remove();
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
            if (block instanceof HTMLDetailsElement && !block.dataset.thoughtUserExpanded) {
                block.open = false;
            }
        } else if (block instanceof HTMLDetailsElement
            && !block.dataset.thoughtUserExpanded
            && !thinkingActive) {
            block.open = false;
        }
        const meta = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-meta');
        meta?.remove();
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
            const update = (): void => {
                if (!title.isConnected) {
                    return;
                }
                const elapsed = formatTranscriptThoughtDuration(Date.now() - options.turnStartMs!);
                title.textContent = nls.localize('qaap/mobileProjects/transcriptThinkingFor', 'Thinking for {0}', elapsed);
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
                    update();
                }, 1000);
            }
            return;
        }
        block.removeAttribute('data-thought-live-timer');
        if (options.thinking) {
            const frozenMs = block.dataset.thoughtDurationMs ? Number(block.dataset.thoughtDurationMs) : undefined;
            if (frozenMs !== undefined && Number.isFinite(frozenMs) && frozenMs >= 500) {
                title.textContent = nls.localize(
                    'qaap/mobileProjects/transcriptThoughtFor',
                    'Thought for {0}',
                    formatTranscriptThoughtDuration(frozenMs),
                );
                return;
            }
            title.textContent = nls.localize('qaap/mobileProjects/transcriptThoughtBriefly', 'Thought briefly');
            return;
        }
        title.textContent = nls.localize('qaap/mobileProjects/transcriptExploredWorkspace', 'Explored the workspace');
    }

    protected syncTranscriptActivityTimelineElement(
        timeline: HTMLElement,
        items: readonly TranscriptActivityTimelineItem[],
        options?: TranscriptActivityTimelineOptions,
    ): void {
        const expandState = readTranscriptTimelineExpandState(timeline);
        const policy = resolveTranscriptTimelineVisibilityPolicy(items, {
            maxVisibleItems: options?.maxVisibleItems,
            revealAll: expandState.revealAll,
        });
        const visibleItems = policy.visibleItems;
        const activeIndex = visibleItems.findIndex(item => isTranscriptActivityLiveState(item.state));
        const segments = options?.segments ?? [];
        if (timeline instanceof HTMLDetailsElement) {
            const autoExpanded = false;
            this.bindTranscriptActivityTimelineToggle(timeline);
            const expanded = timeline.dataset.transcriptTimelineUserToggled === '1'
                ? timeline.open
                : autoExpanded;
            if (!timeline.dataset.transcriptTimelineUserToggled && timeline.open !== autoExpanded) {
                timeline.open = autoExpanded;
            }
            timeline.classList.toggle('theia-mod-collapsed-history', policy.collapsed);
            timeline.classList.toggle('theia-mod-stalled', !!options?.stalled);
            timeline.classList.toggle('theia-mod-streaming', !!options?.streaming);
            this.syncTranscriptActivityTimelineSummaryElement(timeline, segments, visibleItems, policy);
            timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-count')
                .forEach(count => count.textContent = String(visibleItems.length));
            const progressText = options?.stalled
                ? nls.localize('qaap/mobileProjects/transcriptActivityStillWorking', 'Still working')
                : options?.streaming
                    ? nls.localize('qaap/mobileProjects/transcriptActivityWorking', 'Working')
                    : '';
            timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-label').forEach(label => {
                label.classList.toggle('theia-mod-shimmer', !!options?.streaming && !options?.stalled);
                label.classList.toggle('theia-mod-stall', !!options?.stalled);
            });
            timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-status').forEach(status => {
                status.hidden = !progressText;
                status.textContent = progressText;
                status.classList.toggle('theia-mod-shimmer', !!options?.streaming && !options?.stalled);
                status.classList.toggle('theia-mod-stall', !!options?.stalled);
            });
            const stickyBar = timeline.querySelector<HTMLElement>('.theia-mobile-agent-activity-timeline-sticky-bar');
            stickyBar?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        } else {
            timeline.classList.toggle('theia-mod-streaming', !!options?.streaming);
            const count = timeline.querySelector('.theia-mobile-agent-premium-head-count');
            if (count) {
                count.textContent = String(visibleItems.length);
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
        const cursorTrace = timeline.classList.contains('theia-mod-cursor-trace');
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

    protected syncTranscriptActivityTimelineSummaryElement(
        timeline: HTMLDetailsElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        visibleItems: readonly TranscriptActivityTimelineItem[],
        policy: ReturnType<typeof resolveTranscriptTimelineVisibilityPolicy>,
    ): void {
        const summaryLabels = timeline.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-label');
        if (summaryLabels.length === 0) {
            return;
        }
        for (const summaryLabel of summaryLabels) {
            const summaryText = this.resolveTranscriptActivityTimelineSummary(segments, visibleItems, 0);
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
    }

    protected bindTranscriptActivityTimelineToggle(timeline: HTMLDetailsElement): void {
        if (timeline.dataset.transcriptTimelineToggleBound === '1') {
            return;
        }
        timeline.dataset.transcriptTimelineToggleBound = '1';
        timeline.addEventListener('toggle', () => {
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
        const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return false;
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
        const segmentsBody = row.querySelector('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return false;
        }
        let artifacts = segmentsBody.querySelector('.theia-mobile-agent-transcript-artifacts');
        if (!artifacts) {
            artifacts = document.createElement('div');
            artifacts.className = 'theia-mobile-agent-transcript-artifacts';
            segmentsBody.append(artifacts);
        }
        let strip = artifacts.querySelector<HTMLElement>('.theia-mobile-agent-tool-pills');
        if (!strip) {
            strip = document.createElement('div');
            strip.className = 'theia-mobile-agent-tool-pills';
            const group = this.wrapTranscriptToolGroup(strip);
            artifacts.prepend(group);
        }
        if (strip.querySelector(`[${TRANSCRIPT_TOOL_USE_ID_ATTR}="${CSS.escape(segment.toolUseId)}"]`)) {
            return false;
        }
        strip.append(this.createTranscriptToolPill(segment, conv));
        const group = strip.closest('.theia-mobile-agent-tool-group');
        if (group instanceof HTMLElement) {
            this.refreshTranscriptToolGroupSummary(group);
        }
        this.patchStreamingActivityTimeline(row, nextSegments, conv);
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
        const title = document.createElement('span');
        title.className = 'theia-mobile-agent-thought-brief-title';
        summary.append(title);
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
        const toolSegments = segments.filter((segment): segment is Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> =>
            segment.type === 'tool',
        );
        const descriptors = resolveTranscriptToolPillDescriptors(toolSegments, {
            resolvePath: args => this.resolversUi.extractTranscriptToolFullPath(args),
        });
        if (descriptors.length === 0) {
            return undefined;
        }
        const strip = document.createElement('div');
        strip.className = 'theia-mobile-agent-tool-pills';
        for (const descriptor of descriptors) {
            const segment = segments.find(entry =>
                entry.type === 'tool' && entry.toolUseId === descriptor.toolUseId,
            );
            if (segment?.type !== 'tool') {
                continue;
            }
            strip.append(this.createTranscriptToolPill(segment, conv, options));
        }
        if (strip.childElementCount === 0) {
            return undefined;
        }
        return this.wrapTranscriptToolGroup(strip);
    }

    /**
     * Claude-Code-style collapsed activity line: one `details` row summarising the tool calls
     * ("Ran 4 commands, read 6 files ›") that expands into the individual tool pills.
     */
    protected wrapTranscriptToolGroup(strip: HTMLElement): HTMLDetailsElement {
        const group = document.createElement('details');
        group.className = 'theia-mobile-agent-tool-group';
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-tool-group-head';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-tool-group-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-tool-group-label';
        summary.append(chevron, label);
        group.append(summary, strip);
        this.refreshTranscriptToolGroupSummary(group);
        return group;
    }

    /** Recompute the group summary label and open state from the pills currently inside. */
    refreshTranscriptToolGroupSummary(group: HTMLElement): void {
        const label = group.querySelector<HTMLElement>('.theia-mobile-agent-tool-group-label');
        if (!label) {
            return;
        }
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
    ): string {
        const stats = resolveTranscriptActivityStats(segments);
        let summary: string;
        if (hasTranscriptActivityStats(stats)) {
            summary = this.formatTranscriptActivityMeta(stats);
        } else {
            const active = [...items].reverse().find(item => isTranscriptActivityLiveState(item.state));
            if (active) {
                summary = active.label;
            } else if (items.length > 0) {
                summary = items[items.length - 1].label;
            } else {
                summary = nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity');
            }
        }
        if (hiddenCount > 0) {
            return nls.localize(
                'qaap/mobileProjects/transcriptActivityCollapsedSummary',
                '{0} · {1} earlier steps',
                summary,
                String(hiddenCount),
            );
        }
        return summary;
    }

    createTranscriptActivityTimeline(
        segments: QaapAgentMessageSegmentDTO[],
        options?: TranscriptActivityTimelineOptions & { readonly includeThinkingSteps?: boolean },
    ): HTMLElement | undefined {
        const variant = options?.variant ?? 'inline';
        const includeThinkingSteps = options?.includeThinkingSteps ?? variant === 'plan';
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
        const timelineOptions = { ...options, segments, includeThinkingSteps, cursorTrace: true };

        if (variant === 'inline') {
            const timeline = document.createElement('details');
            timeline.className = 'theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible theia-mod-cursor-trace';
            timeline.setAttribute(TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, 'true');
            timeline.setAttribute(
                'aria-label',
                nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity'),
            );
            timeline.classList.toggle('theia-mod-stalled', !!options?.stalled);
            timeline.open = false;

            const summary = document.createElement('summary');
            summary.className = 'theia-mobile-agent-activity-timeline-summary';
            const summaryIcon = document.createElement('span');
            summaryIcon.className = 'theia-mobile-agent-activity-timeline-summary-icon codicon codicon-tools';
            summaryIcon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-activity-timeline-summary-label';
            label.textContent = this.resolveTranscriptActivityTimelineSummary(segments, items);
            const count = document.createElement('span');
            count.className = 'theia-mobile-agent-activity-timeline-summary-count';
            count.textContent = String(items.length);
            const status = document.createElement('span');
            status.className = 'theia-mobile-agent-activity-timeline-summary-status';
            status.setAttribute('aria-live', 'polite');
            status.hidden = true;
            const chevron = document.createElement('span');
            chevron.className = 'theia-mobile-agent-activity-timeline-summary-chevron codicon codicon-chevron-down';
            chevron.setAttribute('aria-hidden', 'true');
            summary.append(summaryIcon, label, count, status, chevron);
            const openPanel = document.createElement('div');
            openPanel.className = 'theia-mobile-agent-activity-timeline-open-panel';
            const stickyBar = document.createElement('button');
            stickyBar.type = 'button';
            stickyBar.className = 'theia-mobile-agent-activity-timeline-sticky-bar';
            stickyBar.setAttribute('aria-expanded', 'true');
            const stickyIcon = document.createElement('span');
            stickyIcon.className = 'theia-mobile-agent-activity-timeline-summary-icon codicon codicon-tools';
            stickyIcon.setAttribute('aria-hidden', 'true');
            const stickyLabel = document.createElement('span');
            stickyLabel.className = 'theia-mobile-agent-activity-timeline-summary-label';
            const stickyCount = document.createElement('span');
            stickyCount.className = 'theia-mobile-agent-activity-timeline-summary-count';
            const stickyStatus = document.createElement('span');
            stickyStatus.className = 'theia-mobile-agent-activity-timeline-summary-status';
            stickyStatus.setAttribute('aria-live', 'polite');
            stickyStatus.hidden = true;
            const stickyChevron = document.createElement('span');
            stickyChevron.className = 'theia-mobile-agent-activity-timeline-summary-chevron codicon codicon-chevron-down';
            stickyChevron.setAttribute('aria-hidden', 'true');
            stickyBar.append(stickyIcon, stickyLabel, stickyCount, stickyStatus, stickyChevron);
            const list = document.createElement('ol');
            list.className = 'theia-mobile-agent-activity-list';
            bindTranscriptActivityListKeyboard(list);
            openPanel.append(stickyBar, list);
            timeline.append(summary, openPanel);
            this.syncTranscriptActivityTimelineElement(timeline, items, timelineOptions);
            return timeline;
        }

        const timeline = document.createElement('section');
        timeline.className = `theia-mobile-agent-premium-card theia-mobile-agent-activity-timeline theia-mod-${variant}`;
        timeline.setAttribute(TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, 'true');
        timeline.setAttribute(
            'aria-label',
            nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity'),
        );
        timeline.classList.toggle('theia-mod-stalled', !!options?.stalled);
        timeline.append(this.createTranscriptPremiumHead(
            'codicon-checklist',
            nls.localize('qaap/mobileProjects/planLabel', 'Execution plan'),
            { count: items.length, variant: 'todos' },
        ));
        const list = document.createElement('ol');
        list.className = 'theia-mobile-agent-activity-list';
        bindTranscriptActivityListKeyboard(list);
        timeline.append(list);
        this.syncTranscriptActivityTimelineElement(timeline, items, timelineOptions);
        return timeline;
    }

    protected syncTranscriptActivityItemElement(
        li: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
        tier: ReturnType<typeof resolveTranscriptTimelineItemTier> = isActive ? 'current' : 'recent',
    ): void {
        const shimmerActive = isActive
            && !!options?.streaming
            && !options?.stalled
            && isTranscriptActivityLiveState(item.state);
        const tierClass = transcriptTimelineTierClassName(tier);
        const contentFingerprint = fingerprintTranscriptActivityItemContent(item);
        const itemFingerprint = fingerprintTranscriptActivityItemSlot(item, isActive, tierClass, shimmerActive);
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
        li.className = `theia-mobile-agent-activity-item theia-mod-${item.state}${isActive ? ' theia-mod-active' : ''}${item.grouped ? ' theia-mod-grouped' : ''}${item.subagentRoot ? ' theia-mod-subagent-root' : ''}${nestClass ? ` ${nestClass}` : ''} ${tierClass}`;
        if (isActive) {
            li.setAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR, 'true');
            li.setAttribute('aria-current', 'step');
        } else {
            li.removeAttribute(TRANSCRIPT_ACTIVITY_ACTIVE_ATTR);
            li.removeAttribute('aria-current');
        }
        const newIcon = options?.cursorTrace
            ? undefined
            : this.createTranscriptActivityIcon(item.state, isActive, item.toolKind);
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
        li.className = `theia-mobile-agent-activity-item theia-mod-${item.state}${isActive ? ' theia-mod-active' : ''}${item.grouped ? ' theia-mod-grouped' : ''}${item.subagentRoot ? ' theia-mod-subagent-root' : ''}${nestClass ? ` ${nestClass}` : ''} ${tierClass}`;
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
        const detailText = item.detail ? ` ${item.detail}` : '';
        if (verbEl.textContent !== verbText) {
            verbEl.textContent = verbText;
        }
        if (detailEl.textContent !== detailText) {
            detailEl.textContent = detailText;
        }
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
        return true;
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

    protected populateTranscriptActivityStepCopy(
        copy: HTMLElement,
        item: TranscriptActivityTimelineItem,
        isActive: boolean,
        options?: TranscriptActivityTimelineOptions,
    ): void {
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
                detail.textContent = ` ${item.detail}`;
                rowEl.append(verb, detail);
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
            if (!errorDetail) {
                errorDetail = document.createElement('span');
                errorDetail.className = 'theia-mobile-agent-activity-error-detail';
                copy.append(errorDetail);
            }
            errorDetail.textContent = item.errorSummary;
        } else {
            errorDetail?.remove();
        }
    }

    createTranscriptActivityIcon(
        state: TranscriptActivityStepState,
        active: boolean,
        toolKind?: string,
    ): HTMLElement {
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-activity-icon';
        icon.setAttribute('aria-hidden', 'true');
        if (active && isTranscriptActivityLiveState(state)) {
            icon.classList.add('theia-mod-active', 'theia-mod-pulse');
            const arrow = document.createElement('span');
            arrow.className = 'codicon codicon-arrow-small-right';
            arrow.setAttribute('aria-hidden', 'true');
            icon.append(arrow);
            return icon;
        }
        switch (state) {
            case 'thinking':
                icon.classList.add('theia-mod-thinking', 'codicon', 'codicon-lightbulb');
                break;
            case 'waiting':
                icon.classList.add('theia-mod-waiting', 'codicon', 'codicon-watch');
                break;
            case 'streaming':
                icon.classList.add('theia-mod-streaming', 'codicon', 'codicon-loading');
                break;
            case 'success':
                if (toolKind) {
                    icon.classList.add('theia-mod-kind', 'theia-mod-success', 'codicon', this.toolUi.transcriptToolIconClass(toolKind));
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
                if (toolKind) {
                    icon.classList.add('theia-mod-kind', 'theia-mod-running', 'codicon', this.toolUi.transcriptToolIconClass(toolKind));
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
        title.textContent = files.length === 1
            ? nls.localize('qaap/mobileProjects/transcriptChangedFilesOne', '{0} file changed', '1')
            : nls.localize('qaap/mobileProjects/transcriptChangedFilesCount', '{0} files changed', String(files.length));
        summary.append(chevron, title);
        if (stats && (stats.added > 0 || stats.removed > 0)) {
            const statsRow = document.createElement('span');
            statsRow.className = 'theia-mobile-agent-changed-files-stats';
            const added = document.createElement('span');
            added.className = 'theia-mobile-agent-diff-stat theia-mod-added';
            added.textContent = `+${stats.added}`;
            const removed = document.createElement('span');
            removed.className = 'theia-mobile-agent-diff-stat theia-mod-removed';
            removed.textContent = `-${stats.removed}`;
            statsRow.append(added, removed);
            summary.append(statsRow);
        }
        summary.append(this.createTranscriptChangedFilesReviewButton());
        card.append(summary);

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

    createTranscriptChangedFileRow(
        file: { readonly path: string; readonly kind: 'edited' | 'created' },
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = `theia-mobile-agent-changed-file theia-mod-${file.kind}`;

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
        if (slash > 0) {
            const dir = document.createElement('span');
            dir.className = 'theia-mobile-agent-changed-file-dir';
            dir.textContent = file.path.slice(0, slash);
            info.append(dir);
        }

        const badge = document.createElement('span');
        badge.className = `theia-mobile-agent-changed-file-badge theia-mod-${file.kind}`;
        badge.textContent = file.kind === 'created'
            ? nls.localize('qaap/mobileProjects/transcriptChangedFileNew', 'New')
            : nls.localize('qaap/mobileProjects/transcriptChangedFileEdited', 'Edited');

        row.append(icon, info, badge);
        return row;
    }

    /** Codicon for a changed-file row, derived from the file extension. */

    transcriptFileIconClass(path: string): string {
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'sh'].includes(ext)) {
            return 'codicon-file-code';
        }
        if (['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env'].includes(ext)) {
            return 'codicon-settings-gear';
        }
        if (['md', 'mdx', 'txt', 'rst'].includes(ext)) {
            return 'codicon-markdown';
        }
        if (['css', 'scss', 'less', 'html', 'svg'].includes(ext)) {
            return 'codicon-symbol-color';
        }
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)) {
            return 'codicon-file-media';
        }
        return 'codicon-file';
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

    createTranscriptTechnicalDetailsCard(segments: QaapAgentMessageSegmentDTO[]): HTMLElement | undefined {
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
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        const segments = lastAgent?.segments ?? [];
        const turnStartMs = resolveTranscriptTurnStartMs(conv.messages);
        const stalled = this.resolveTranscriptStreamStalled(conv);
        if (!shouldShowTranscriptStreamingActivity(segments, true, {
            turnElapsedMs: resolveTranscriptTurnElapsedMs(turnStartMs),
            userPromptChars: resolveLastUserPromptChars(conv.messages),
            stalled,
        })) {
            return undefined;
        }
        const row = document.createElement('div');
        row.setAttribute(TRANSCRIPT_ACTIVITY_ROW_ATTR, 'true');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent theia-mod-streaming theia-mobile-agent-activity';
        const state = this.resolveTranscriptStreamingActivity(conv, { stalled });

        // A single, live "thinking/acting" line — minimalist, with an animated dot and a shimmering
        // label that reflects what the agent is doing right now.
        const line = document.createElement('div');
        line.className = `theia-mobile-agent-stream-line theia-mod-${state.kind}`;
        const dot = document.createElement('span');
        dot.className = 'theia-mobile-agent-stream-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-stream-label';
        label.textContent = `${state.title}…`;
        label.classList.toggle('theia-mod-shimmer', !stalled && (state.kind === 'planning' || state.kind === 'thinking'));
        label.classList.toggle('theia-mod-stall', stalled);
        line.append(dot, label);
        const meta = this.createTranscriptStreamMeta(conv);
        if (meta) {
            line.append(meta);
        }
        row.append(line);
        if (conv.status === 'streaming') {
            row.classList.toggle('theia-mod-stream-stalled', stalled);
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
        const timer = window.setInterval(() => {
            if (!meta.isConnected) {
                window.clearInterval(timer);
                return;
            }
            if (ownerRow && !ownerRow.classList.contains('theia-mod-streaming')) {
                window.clearInterval(timer);
                (meta.closest('.theia-mobile-agent-stream-status') ?? meta).remove();
                return;
            }
            update();
        }, 1000);
        return meta;
    }

    resolveTranscriptStreamingActivity(
        conv: QaapAgentConversationDTO,
        options?: { readonly stalled?: boolean },
    ): { kind: string; title: string; detail: string } {
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        const segments = lastAgent?.segments ?? [];
        return resolveTranscriptStreamingActivityFromSegments(segments, {
            stalled: options?.stalled,
            stallTitle: this.resolveTranscriptStreamStallLabel(),
            localizeToolTitle: label => this.host.projectRowsUi.localizeActivityLabel(label),
        });
    }
}
