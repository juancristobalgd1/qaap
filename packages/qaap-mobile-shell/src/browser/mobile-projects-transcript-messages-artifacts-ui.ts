// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import { formatReadToolDetailFromArgs } from '../common/qaap-agent-conversation-list-metrics';
import { excerptTranscriptThought, extractTranscriptDiffCard, hasTranscriptActivityStats, isTranscriptThoughtExcerptTruncated, isTranscriptTodoTool, parseTranscriptTodoChecklist, resolveTranscriptActivityStats, resolveTranscriptThinkingContent, resolveTranscriptToolPillDescriptors, resolveTranscriptToolRowParts, shouldOpenTranscriptToolDetails, shouldRenderTranscriptToolSegmentInline, type QaapTranscriptActivityStats } from '../common/qaap-agent-transcript-segments';
import { formatTranscriptStreamElapsed, formatTranscriptStreamTokens, formatTranscriptThoughtDuration, isTranscriptAgentThinkingPhase, isTranscriptStreamStalled, resolveTranscriptTurnStartMs, resolveTranscriptTurnStreamChars, shouldExpandTranscriptInlineTimeline, shouldShowTranscriptInlineTimeline } from '../common/qaap-transcript-stream-status';
import { resolveTranscriptStreamingActivityFromSegments } from '../common/qaap-transcript-streaming-activity';
import type { TranscriptActivityNavigationItem } from '../common/qaap-transcript-activity-navigation';
import { groupTranscriptActivityNavigationItems } from '../common/qaap-transcript-activity-navigation';
import { isPendingTranscriptToolSegment } from '../common/qaap-transcript-approval-inline';
import { buildTranscriptApprovalCard, TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { respondToTranscriptApproval } from './qaap-transcript-approval-respond';
import { buildTranscriptDiffCardFromExtracted, buildTranscriptToolUiPayloadElement } from './qaap-transcript-rich-content-ui';
import { resolveTranscriptToolUiPayloadFromSegment } from '../common/qaap-transcript-tool-ui-payloads';
import { TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, TRANSCRIPT_SEGMENT_INDEX_ATTR, TRANSCRIPT_THOUGHT_BRIEF_ATTR, TRANSCRIPT_TOOL_USE_ID_ATTR } from '../common/qaap-transcript-incremental-update';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';

export interface TranscriptActivityTimelineOptions {
    /** Last N steps in chat; omit or ≤0 to show the full trace (Plan tab). */
    readonly maxVisibleItems?: number;
    readonly variant?: 'inline' | 'plan';
    readonly streaming?: boolean;
    readonly stalled?: boolean;
    /** When set, controls collapsible inline timeline open state. */
    readonly expanded?: boolean;
    readonly segments?: readonly QaapAgentMessageSegmentDTO[];
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
        const inlineDiff = this.createTranscriptInlineDiffStrip(segments);
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
        const timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        if (timeline) {
            const items = this.resolveTranscriptActivityItemsForDisplay([...segments]);
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
        options?: { readonly stalled?: boolean; readonly includeThinkingSteps?: boolean },
    ): readonly TranscriptActivityTimelineItem[] {
        const items = groupTranscriptActivityNavigationItems(this.resolversUi.resolveTranscriptActivityItems(
            [...segments],
            options?.includeThinkingSteps ?? true,
        ));
        if (!options?.stalled || items.length === 0) {
            return items;
        }
        const activeIndex = items.findIndex(item => item.state === 'running' || item.state === 'thinking');
        if (activeIndex < 0) {
            return items;
        }
        const stallLabel = this.resolveTranscriptStreamStallLabel();
        return items.map((item, index) => index === activeIndex
            ? { ...item, label: stallLabel }
            : item);
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
                    { stalled },
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
            if (message?.segments?.length) {
                return [...message.segments];
            }
        }
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        return lastAgent?.segments ? [...lastAgent.segments] : [];
    }

    protected syncTranscriptStreamingActivityLine(
        line: Element,
        conv: QaapAgentConversationDTO,
        stalled: boolean,
    ): void {
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
        const items = this.resolveTranscriptActivityItemsForDisplay([...nextSegments], { stalled });
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
        const thinkingActive = isTranscriptAgentThinkingPhase(segments, streaming);
        const thinking = resolveTranscriptThinkingContent([...segments]);
        const stats = resolveTranscriptActivityStats([...segments]);
        const hasStats = hasTranscriptActivityStats(stats);
        if (!thinking && !hasStats && !thinkingActive) {
            return true;
        }
        let brief = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_THOUGHT_BRIEF_ATTR}]`);
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
        const stats = resolveTranscriptActivityStats([...segments]);
        const hasStats = hasTranscriptActivityStats(stats);
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
        } else if (streaming && block.classList.contains('theia-mod-thinking-live')) {
            block.classList.remove('theia-mod-thinking-live');
            if (turnStartMs !== undefined && !block.dataset.thoughtDurationMs) {
                block.dataset.thoughtDurationMs = String(Math.max(0, Date.now() - turnStartMs));
            }
        }
        const meta = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-meta');
        if (meta) {
            meta.textContent = hasStats ? this.formatTranscriptActivityMeta(stats) : '';
            meta.hidden = !hasStats;
        } else if (hasStats) {
            const summary = block.querySelector('.theia-mobile-agent-thought-brief-summary');
            const nextMeta = document.createElement('span');
            nextMeta.className = 'theia-mobile-agent-thought-brief-meta';
            nextMeta.textContent = this.formatTranscriptActivityMeta(stats);
            summary?.append(nextMeta);
        }
        const bodyWrap = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-body-wrap');
        if (thinking) {
            if (!bodyWrap) {
                const summary = block.querySelector('summary');
                const wrap = document.createElement('div');
                wrap.className = 'theia-mobile-agent-thought-brief-body-wrap';
                const body = document.createElement('p');
                body.className = 'theia-mobile-agent-thought-brief-body';
                wrap.append(body);
                summary?.insertAdjacentElement('afterend', wrap);
            }
            const body = block.querySelector<HTMLElement>('.theia-mobile-agent-thought-brief-body');
            if (body) {
                body.textContent = excerptTranscriptThought(thinking);
            }
        } else {
            bodyWrap?.remove();
        }
        this.refreshTranscriptThoughtBriefTitle(title, block, {
            thinking,
            thinkingActive,
            streaming,
            turnStartMs,
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
            if (options.streaming && frozenMs !== undefined && Number.isFinite(frozenMs)) {
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
        const limit = options?.maxVisibleItems ?? 8;
        const visibleItems = limit > 0 ? items.slice(-limit) : items;
        const activeIndex = visibleItems.findIndex(item => item.state === 'running' || item.state === 'thinking');
        const segments = options?.segments ?? [];
        if (timeline instanceof HTMLDetailsElement) {
            const expanded = options?.expanded ?? shouldExpandTranscriptInlineTimeline(segments, !!options?.streaming);
            timeline.open = expanded;
            const summaryLabel = timeline.querySelector<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-label');
            if (summaryLabel) {
                summaryLabel.textContent = this.resolveTranscriptActivityTimelineSummary(segments, visibleItems);
            }
            const summaryCount = timeline.querySelector<HTMLElement>('.theia-mobile-agent-activity-timeline-summary-count');
            if (summaryCount) {
                summaryCount.textContent = String(visibleItems.length);
                summaryCount.hidden = visibleItems.length === 0;
            }
        } else {
            const count = timeline.querySelector('.theia-mobile-agent-premium-head-count');
            if (count) {
                count.textContent = String(visibleItems.length);
            }
        }
        const list = timeline.querySelector('.theia-mobile-agent-activity-list');
        if (!list) {
            return;
        }
        const ownerRow = timeline.closest<HTMLElement>('.theia-mobile-agent-transcript-msg');
        const existing = [...list.querySelectorAll<HTMLElement>('.theia-mobile-agent-activity-item')];
        visibleItems.forEach((item, index) => {
            const isActive = index === activeIndex;
            let li = existing[index];
            if (!li) {
                li = document.createElement('li');
                li.className = `theia-mobile-agent-activity-item theia-mod-${item.state}${isActive ? ' theia-mod-active' : ''}${item.grouped ? ' theia-mod-grouped' : ''}`;
                const label = this.createTranscriptActivityLabel(item.label, isActive && !!options?.streaming && !options?.stalled);
                if (isActive && options?.stalled) {
                    label.classList.add('theia-mod-stall');
                }
                li.append(
                    this.createTranscriptActivityIcon(item.state, isActive, item.toolKind),
                    label,
                );
                li.classList.add('theia-mod-enter');
                li.addEventListener('animationend', () => li.classList.remove('theia-mod-enter'), { once: true });
                if (ownerRow) {
                    this.attachTranscriptActivityItemAction(li, item, ownerRow);
                }
                list.append(li);
                return;
            }
            li.className = `theia-mobile-agent-activity-item theia-mod-${item.state}${isActive ? ' theia-mod-active' : ''}${item.grouped ? ' theia-mod-grouped' : ''}`;
            const label = li.querySelector<HTMLElement>('.theia-mobile-agent-activity-label');
            if (label) {
                label.textContent = item.label;
                const shimmer = isActive && !!options?.streaming && !options?.stalled;
                label.classList.toggle('theia-mod-shimmer', shimmer);
                label.classList.toggle('theia-mod-stall', isActive && !!options?.stalled);
            }
            const icon = li.querySelector('.theia-mobile-agent-activity-icon');
            if (icon) {
                icon.replaceWith(this.createTranscriptActivityIcon(item.state, isActive, item.toolKind));
            }
            if (ownerRow) {
                this.attachTranscriptActivityItemAction(li, item, ownerRow);
            }
        });
        while (list.children.length > visibleItems.length) {
            list.lastElementChild?.remove();
        }
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
                verb: rowParts.verb,
                label: rowParts.detail,
                finished: descriptor.finished,
                failed: descriptor.resultFailed,
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
        const thinkingActive = isTranscriptAgentThinkingPhase(segments, streaming);
        if (!thinking && !hasStats && !thinkingActive) {
            return undefined;
        }

        const block = document.createElement('details');
        block.className = 'theia-mobile-agent-thought-brief';
        block.setAttribute(TRANSCRIPT_THOUGHT_BRIEF_ATTR, 'true');
        if (thinkingActive) {
            block.classList.add('theia-mod-thinking-live');
        }

        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-thought-brief-summary';
        const glyph = document.createElement('span');
        glyph.className = 'theia-mobile-agent-thought-brief-glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = '∴';
        const title = document.createElement('span');
        title.className = 'theia-mobile-agent-thought-brief-title';
        summary.append(glyph, title);
        if (hasStats) {
            const meta = document.createElement('span');
            meta.className = 'theia-mobile-agent-thought-brief-meta';
            meta.textContent = this.formatTranscriptActivityMeta(stats);
            summary.append(meta);
        }
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

        const turnStartMs = options?.conv ? resolveTranscriptTurnStartMs(options.conv.messages) : undefined;
        this.refreshTranscriptThoughtBriefTitle(title, block, {
            thinking,
            thinkingActive,
            streaming,
            turnStartMs,
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
        pill.open = shouldOpenTranscriptToolDetails({
            finished: descriptor?.finished ?? segment.finished,
            resultFailed: descriptor?.resultFailed ?? false,
        });
        const todoChecklist = isTranscriptTodoTool(segment.name) && !!parseTranscriptTodoChecklist(segment.args);
        if (todoChecklist) {
            // The live task checklist stays visible, Claude-Code-style.
            pill.open = true;
        }
        const rowParts = this.resolveToolRowParts(segment, kind);
        const finished = descriptor?.finished ?? segment.finished;
        const failed = descriptor?.resultFailed ?? false;
        pill.append(this.toolUi.createTranscriptToolPillSummary({
            kind,
            verb: rowParts.verb,
            label: rowParts.detail,
            finished,
            failed,
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
                ? nls.localize('qaap/mobileProjects/transcriptMetaOneCommand', '1 command')
                : nls.localize('qaap/mobileProjects/transcriptMetaCommands', '{0} commands', String(stats.shells)));
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
    ): string {
        const stats = resolveTranscriptActivityStats(segments);
        if (hasTranscriptActivityStats(stats)) {
            return this.formatTranscriptActivityMeta(stats);
        }
        const active = [...items].reverse().find(item => item.state === 'running' || item.state === 'thinking');
        if (active) {
            return active.label;
        }
        if (items.length > 0) {
            return items[items.length - 1].label;
        }
        return nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity');
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
        });
        if (items.length === 0) {
            return undefined;
        }
        const limit = options?.maxVisibleItems ?? 8;
        const visibleItems = limit > 0 ? items.slice(-limit) : items;
        const timelineOptions = { ...options, segments, includeThinkingSteps };

        if (variant === 'inline') {
            const timeline = document.createElement('details');
            timeline.className = 'theia-mobile-agent-premium-card theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible';
            timeline.setAttribute(TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, 'true');
            timeline.setAttribute(
                'aria-label',
                nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity'),
            );
            timeline.classList.toggle('theia-mod-stalled', !!options?.stalled);
            timeline.open = options?.expanded ?? shouldExpandTranscriptInlineTimeline(segments, !!options?.streaming);

            const summary = document.createElement('summary');
            summary.className = 'theia-mobile-agent-activity-timeline-summary';
            const icon = document.createElement('span');
            icon.className = 'theia-mobile-agent-activity-timeline-summary-icon codicon codicon-checklist';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-activity-timeline-summary-label';
            label.textContent = this.resolveTranscriptActivityTimelineSummary(segments, visibleItems);
            const count = document.createElement('span');
            count.className = 'theia-mobile-agent-activity-timeline-summary-count';
            count.textContent = String(visibleItems.length);
            count.hidden = visibleItems.length === 0;
            summary.append(icon, label, count);
            const list = document.createElement('ol');
            list.className = 'theia-mobile-agent-activity-list';
            timeline.append(summary, list);
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
            { count: visibleItems.length, variant: 'todos' },
        ));
        const list = document.createElement('ol');
        list.className = 'theia-mobile-agent-activity-list';
        timeline.append(list);
        this.syncTranscriptActivityTimelineElement(timeline, items, timelineOptions);
        return timeline;
    }

    createTranscriptActivityIcon(
        state: 'done' | 'running' | 'thinking',
        active: boolean,
        toolKind?: string,
    ): HTMLElement {
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-activity-icon';
        icon.setAttribute('aria-hidden', 'true');
        if (active) {
            icon.classList.add('theia-mod-active', 'theia-mod-pulse');
            const arrow = document.createElement('span');
            arrow.className = 'codicon codicon-arrow-small-right';
            arrow.setAttribute('aria-hidden', 'true');
            icon.append(arrow);
            return icon;
        }
        if (state === 'thinking') {
            icon.classList.add('theia-mod-thinking', 'codicon', 'codicon-lightbulb');
            return icon;
        }
        if (toolKind) {
            const kindClass = this.toolUi.transcriptToolIconClass(toolKind);
            icon.classList.add('theia-mod-kind', 'codicon', kindClass);
            if (state === 'done') {
                icon.classList.add('theia-mod-done');
            } else {
                icon.classList.add('theia-mod-running');
            }
            return icon;
        }
        if (state === 'done') {
            icon.classList.add('theia-mod-done', 'codicon', 'codicon-check');
            return icon;
        }
        icon.classList.add('theia-mod-pending');
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

    createTranscriptStreamingActivityRow(conv: QaapAgentConversationDTO): HTMLElement {
        const row = document.createElement('div');
        row.setAttribute(TRANSCRIPT_ACTIVITY_ROW_ATTR, 'true');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent theia-mod-streaming theia-mobile-agent-activity';
        const stalled = this.resolveTranscriptStreamStalled(conv);
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
