// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { normalizeAgentMessageContentForDisplay } from '../common/qaap-agent-message-content';
import { parseAgentLogForTranscript } from '../common/qaap-cli-transcript-stream';
import { dedupeAgentMessageTextSegments } from '../common/qaap-qaiq-stream';
import { resolveQaapTranscriptTrace, segmentsToTraceEvents, traceEventsToSegments, type QaapTranscriptTrace } from '../common/qaap-transcript-trace-model';
import { agentMessageHasStructuredTrace } from '../common/qaap-transcript-trace-lifecycle';
import { isStreamingTranscriptTailUnchanged, resolveStreamingTranscriptPatchKind, TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, canStreamPatchAgentAppendTextSegment, canStreamPatchAgentAppendToolSegment, canStreamPatchAgentSegmentsInPlace, canStreamPatchStdoutAgentContentOnly } from '../common/qaap-transcript-incremental-update';
import {
    isTranscriptAgentTailStreaming,
    resolveTranscriptEffectiveStatus,
    shouldShowTranscriptEmptyQuickActions,
} from '../common/qaap-transcript-turn-status';
import { isTranscriptScrollNearBottom } from '../common/qaap-transcript-user-scroll-pin';
import { scrollElementToEnd } from '../common/qaap-prefers-reduced-motion';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';
import { attachTranscriptScrollToBottomButton } from './qaap-transcript-scroll-to-bottom';
import { attachTranscriptActivityTimelineStickySummary } from './qaap-transcript-activity-timeline-sticky-summary';
import {
    attachTranscriptRowDeferObserver,
    shouldDeferTranscriptRowHeavyContent,
} from './qaap-transcript-row-defer';
import { normalizeAgentConversationFailures, type QaapAgentConversationDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesUserUi } from './mobile-projects-transcript-messages-user-ui';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';

export class MobileProjectsTranscriptMessagesRenderUi {
    constructor(
        protected readonly host: MobileProjectsTranscriptMessagesHost,
        protected readonly workHub: WorkHubTranscriptBridge,
        protected readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        protected readonly userUi: MobileProjectsTranscriptMessagesUserUi,
        protected readonly artifactsUi: MobileProjectsTranscriptMessagesArtifactsUi,
        protected readonly toolUi: MobileProjectsTranscriptMessagesToolUi,
    ) { }

    resolveTranscriptMessageHost(host: HTMLElement): HTMLElement {
        if (!host.classList.contains('theia-mobile-agent-transcript-real-chat')) {
            host.className = 'theia-mobile-agent-transcript';
            return host;
        }
        const existing = host.querySelector(':scope > .theia-mobile-agent-transcript');
        if (existing instanceof HTMLElement) {
            return existing;
        }
        const list = document.createElement('div');
        list.className = 'theia-mobile-agent-transcript';
        host.replaceChildren(list);
        return list;
    }

    resolveTranscriptAgentSegments(
        conv: QaapAgentConversationDTO,
        msg: QaapAgentMessageDTO,
    ): QaapAgentMessageSegmentDTO[] | undefined {
        let trace: QaapTranscriptTrace = resolveQaapTranscriptTrace(msg);
        if (
            trace.segments.length === 0
            && !agentMessageHasStructuredTrace(msg)
            && msg.role === 'agent'
            && msg.content?.trim()
        ) {
            const parsed = parseAgentLogForTranscript(conv.agentId, msg.content);
            if (parsed.segments.length > 0) {
                trace = {
                    source: 'legacy-content',
                    events: parsed.traceEvents.length > 0
                        ? parsed.traceEvents
                        : segmentsToTraceEvents(parsed.segments),
                    segments: parsed.segments,
                };
            }
        }
        if (trace.segments.length > 0) {
            return dedupeAgentMessageTextSegments([...trace.segments]);
        }
        return undefined;
    }

    /** Derive legacy segments[] from traceEvents so incremental DOM patches can reuse segment logic. */
    protected withDerivedTranscriptSegments(msg: QaapAgentMessageDTO): QaapAgentMessageDTO {
        if (!msg.traceEvents?.length || msg.segments?.length) {
            return msg;
        }
        const segments = dedupeAgentMessageTextSegments(traceEventsToSegments(msg.traceEvents));
        return segments.length ? { ...msg, segments } : msg;
    }

    createTranscriptMessageRowAtIndex(conv: QaapAgentConversationDTO, index: number): HTMLElement {
        const normalized = normalizeAgentConversationFailures(conv);
        const msg = normalized.messages[index];
        const sameConversation = this.host.transcriptLastRenderedConversationId === normalized.id;
        const previousLastMessageId = this.host.transcriptLastRenderedMessageId;
        const deferHeavyContent = shouldDeferTranscriptRowHeavyContent({
            messageIndex: index,
            messageCount: normalized.messages.length,
            conversationStreaming: resolveTranscriptEffectiveStatus(normalized) === 'streaming',
        });
        const streamingTail = index === normalized.messages.length - 1
            && msg.role === 'agent'
            && isTranscriptAgentTailStreaming(normalized);
        let row: HTMLElement;
        const agentSegments = this.resolveTranscriptAgentSegments(normalized, msg);
        if (msg.role === 'user') {
            row = this.userUi.createTranscriptUserMessageRow(msg, normalized, { deferHeavyContent });
        } else if (agentSegments && agentSegments.length > 0) {
            row = this.artifactsUi.createTranscriptAgentSegmentsRow(agentSegments, msg.error, normalized, {
                deferHeavyContent,
                streaming: streamingTail,
            });
            if (msg.id) {
                row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, msg.id);
            }
        } else if (msg.role === 'agent' && msg.error?.trim()) {
            row = this.createTranscriptAgentFailureRow(msg, { deferHeavyContent });
            if (msg.id) {
                row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, msg.id);
            }
        } else {
            row = this.createTranscriptMessageRow(
                msg.role,
                normalizeAgentMessageContentForDisplay(msg.content),
                undefined,
                { deferHeavyContent, streaming: streamingTail },
            );
        }
        if (index === conv.messages.length - 1 && sameConversation && previousLastMessageId && msg.id && msg.id !== previousLastMessageId) {
            row.classList.add('theia-mod-new-message');
        }
        if (streamingTail) {
            row.classList.add('theia-mod-streaming');
        }
        return row;
    }

    buildTranscriptVirtualFooter(conv: QaapAgentConversationDTO): HTMLElement[] {
        const footers: HTMLElement[] = [];
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming' && conv.messages.at(-1)?.role === 'user') {
            const row = this.artifactsUi.createTranscriptStreamingActivityRow(conv);
            if (row) {
                footers.push(row);
            }
        }
        return footers;
    }

    renderTranscriptMessagesVirtual(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        const normalized = normalizeAgentConversationFailures(conv);
        this.host.transcriptLastConv = normalized;
        const messageHost = this.resolveTranscriptMessageHost(host);
        messageHost.classList.remove('theia-mod-empty-chat');
        messageHost.classList.add('theia-mod-virtual-scroll');

        const list = this.host.transcriptUi.mount(messageHost, normalized, index => {
            const current = this.host.transcriptLastConv;
            if (!current) {
                return document.createElement('div');
            }
            return this.createTranscriptMessageRowAtIndex(current, index);
        });

        const wasNearBottom = list.isNearBottom() || resolveTranscriptEffectiveStatus(normalized) === 'streaming';
        list.setItemCount(normalized.messages.length);
        list.setFooter(this.buildTranscriptVirtualFooter(normalized));
        this.host.transcriptLastRenderedConversationId = normalized.id;
        this.host.transcriptLastRenderedMessageId = normalized.messages.at(-1)?.id;
        if (wasNearBottom) {
            list.scrollToEnd();
        }
        this.attachTranscriptScrollChrome(host, messageHost, conv);
    }

    renderTranscriptMessages(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        const conversationSwitched = this.host.transcriptLastRenderedConversationId !== undefined
            && this.host.transcriptLastRenderedConversationId !== conv.id;
        if (!conversationSwitched && this.tryPatchStreamingTranscriptMessages(host, conv)) {
            return;
        }
        if (isStreamingTranscriptTailUnchanged(this.host.transcriptLastConv, conv)) {
            recordTranscriptRenderMetric('render_skip_unchanged_tail');
            this.host.transcriptLastConv = conv;
            this.clearTranscriptEmptyQuickActions(this.resolveTranscriptMessageHost(host), conv);
            return;
        }
        recordTranscriptRenderMetric('render_full');
        this.host.transcriptLastConv = conv;
        const shouldVirtualize = this.host.transcriptUi.shouldVirtualize(conv);
        const messageHost = this.resolveTranscriptMessageHost(host);
        const showQuickActions = shouldShowTranscriptEmptyQuickActions(conv, this.host.transcriptLastConv);
        const isEmptyChat = conv.messages.length === 0 && resolveTranscriptEffectiveStatus(conv) !== 'streaming';
        if (isEmptyChat && showQuickActions) {
            this.host.transcriptUi.disposeList();
            messageHost.classList.remove('theia-mod-virtual-scroll');
            messageHost.replaceChildren();
            messageHost.classList.toggle('theia-mod-empty-chat', true);
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = undefined;
            const project = this.host.transcriptOpenProject;
            if (project && this.workHub.shouldEmbedAgentsHubRecentsInWorkspaceTranscript()) {
                messageHost.append(this.workHub.createAgentsHubRecentsBlock(project));
            }
            const empty = document.createElement('div');
            empty.className = 'theia-mobile-agent-transcript-empty';
            empty.append(this.workHub.createAgentsHubQuickActionsBlock());
            messageHost.append(empty);
            this.host.transcriptUserScrollPinDispose.dispose();
            this.host.transcriptUserScrollPinDispose = new DisposableCollection(
                attachTranscriptScrollToBottomButton(host),
            );
            return;
        }
        if (isEmptyChat) {
            this.host.transcriptUi.disposeList();
            messageHost.classList.remove('theia-mod-virtual-scroll', 'theia-mod-empty-chat');
            messageHost.replaceChildren();
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = undefined;
            const project = this.host.transcriptOpenProject;
            if (project && this.workHub.shouldEmbedAgentsHubRecentsInWorkspaceTranscript()) {
                messageHost.append(this.workHub.createAgentsHubRecentsBlock(project));
            }
            this.host.transcriptUserScrollPinDispose.dispose();
            this.host.transcriptUserScrollPinDispose = new DisposableCollection(
                attachTranscriptScrollToBottomButton(host),
            );
            return;
        }
        if (shouldVirtualize) {
            this.renderTranscriptMessagesVirtual(host, conv);
            return;
        }
        this.host.transcriptUi.disposeList();
        messageHost.classList.remove('theia-mod-virtual-scroll');
        messageHost.replaceChildren();
        messageHost.classList.toggle('theia-mod-empty-chat', false);
        for (let index = 0; index < conv.messages.length; index++) {
            messageHost.append(this.createTranscriptMessageRowAtIndex(conv, index));
        }
        this.host.transcriptLastRenderedConversationId = conv.id;
        this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
        const last = conv.messages[conv.messages.length - 1];
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
            if (last?.role === 'agent') {
                messageHost.lastElementChild?.classList.add('theia-mod-streaming');
            } else {
                const activityRow = this.artifactsUi.createTranscriptStreamingActivityRow(conv);
                if (activityRow) {
                    messageHost.append(activityRow);
                }
            }
        }
        scrollElementToEnd(messageHost);
        this.attachTranscriptScrollChrome(host, messageHost, conv);
    }

    protected attachTranscriptScrollChrome(
        host: HTMLElement,
        messageHost: HTMLElement,
        conv: QaapAgentConversationDTO,
    ): void {
        this.host.transcriptUserScrollPinDispose.dispose();
        this.host.transcriptUserScrollPinDispose = new DisposableCollection(
            attachTranscriptActivityTimelineStickySummary(messageHost),
            attachTranscriptScrollToBottomButton(host),
            attachTranscriptRowDeferObserver(messageHost, {
                renderMarkdown: (target, content, streaming) => {
                    if (streaming) {
                        this.contentUi.renderTranscriptStreamingMarkdown(target, content);
                    } else {
                        this.contentUi.renderTranscriptMarkdown(target, content);
                    }
                },
                renderToolBody: (target, segment, kind, streaming) => {
                    target.append(this.toolUi.createTranscriptToolResultBody(segment, kind, { streaming }));
                },
            }),
        );
        this.workHub.renderTeamSectionInTranscript(host, conv);
        this.workHub.renderInlineApproval(host, conv);
        this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
            for (const row of messageHost.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-streaming')) {
                this.artifactsUi.ensureTranscriptStreamStallWatch(row);
            }
            const activityRow = messageHost.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`);
            if (activityRow) {
                this.artifactsUi.ensureTranscriptStreamStallWatch(activityRow);
            }
        }
    }

    /**
     * Live SSE streaming: patch only the tail of the transcript instead of rebuilding the
     * whole list so tool expand state and scroll position stay stable.
     */

    tryPatchStreamingTranscriptMessages(host: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        const messageHost = this.resolveTranscriptMessageHost(host);
        this.clearTranscriptEmptyQuickActions(messageHost, conv);
        const patchKind = resolveStreamingTranscriptPatchKind(this.host.transcriptLastConv, conv);
        if (patchKind === 'none') {
            if (isStreamingTranscriptTailUnchanged(this.host.transcriptLastConv, conv)) {
                recordTranscriptRenderMetric('render_skip_unchanged_tail');
                this.host.transcriptLastConv = conv;
                return true;
            }
            recordTranscriptRenderMetric('render_patch_none');
            return false;
        }
        if (this.host.transcriptUi.shouldVirtualize(conv)) {
            const list = this.host.transcriptUi.activeList;
            if (!list || this.host.transcriptUi.activeConversationId !== conv.id) {
                return false;
            }
            return this.tryPatchStreamingTranscriptVirtual(host, conv, patchKind);
        }
        const wasNearBottom = isTranscriptScrollNearBottom(
            messageHost.scrollTop,
            messageHost.clientHeight,
            messageHost.scrollHeight,
        );

        if (patchKind === 'activity-only') {
            recordTranscriptRenderMetric('render_patch_activity');
            this.syncTranscriptActivityRow(messageHost, conv);
            this.host.transcriptLastConv = conv;
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            if (wasNearBottom) {
                scrollElementToEnd(messageHost);
            }
            return true;
        }

        const lastAgent = conv.messages[conv.messages.length - 1];
        if (!lastAgent || !lastAgent.id || lastAgent.role !== 'agent') {
            return false;
        }
        const prevLast = this.host.transcriptLastConv?.messages[this.host.transcriptLastConv.messages.length - 1];
        const segments = this.resolveTranscriptAgentSegments(conv, lastAgent);

        if (patchKind === 'last-agent') {
            const existing = messageHost.querySelector<HTMLElement>(
                `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
            );
            if (existing && this.tryPatchStreamingAgentTextContent(existing, prevLast, lastAgent, segments, conv)) {
                recordTranscriptRenderMetric('render_patch_last_agent');
                this.markTranscriptMessageRow(existing, lastAgent.id, isTranscriptAgentTailStreaming(conv));
                this.removeTranscriptActivityRow(messageHost);
                this.host.transcriptLastConv = conv;
                this.host.transcriptLastRenderedConversationId = conv.id;
                this.host.transcriptLastRenderedMessageId = lastAgent.id;
                if (wasNearBottom) {
                    scrollElementToEnd(messageHost);
                }
                return true;
            }
        }

        this.removeTranscriptActivityRow(messageHost);
        messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
            if (element instanceof HTMLElement) {
                this.contentUi.settleTranscriptStreamingContent(element);
            }
            element.classList.remove('theia-mod-streaming');
        });

        const row = segments?.length
            ? this.artifactsUi.createTranscriptAgentSegmentsRow(segments, lastAgent.error, conv, { streaming: true })
            : this.createTranscriptMessageRowAtIndex(conv, conv.messages.length - 1);
        this.markTranscriptMessageRow(row, lastAgent.id, isTranscriptAgentTailStreaming(conv));

        if (patchKind === 'last-agent') {
            recordTranscriptRenderMetric('render_patch_last_agent');
            const existing = messageHost.querySelector<HTMLElement>(
                `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
            );
            if (existing) {
                existing.replaceWith(row);
            } else {
                messageHost.append(row);
            }
        } else {
            recordTranscriptRenderMetric('render_patch_append');
            messageHost.append(row);
        }

        this.host.transcriptLastConv = conv;
        this.host.transcriptLastRenderedConversationId = conv.id;
        this.host.transcriptLastRenderedMessageId = lastAgent.id;
        if (wasNearBottom) {
            scrollElementToEnd(messageHost);
        }
        return true;
    }

    /** Upgrade hybrid/plain streaming markdown once the agent turn looks complete. */
    settleVisuallySettledAgentTranscript(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!lastAgent?.id) {
            return;
        }
        const row = messageHost.querySelector<HTMLElement>(
            `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
        );
        if (!row) {
            return;
        }
        row.classList.remove('theia-mod-streaming');
        this.contentUi.settleTranscriptStreamingContent(row);
        const segments = this.resolveTranscriptAgentSegments(conv, lastAgent);
        if (segments?.length) {
            this.artifactsUi.finalizeStreamingAgentTrace(row, segments, conv);
        }
    }

    tryPatchStreamingTranscriptVirtual(
        _host: HTMLElement,
        conv: QaapAgentConversationDTO,
        patchKind: ReturnType<typeof resolveStreamingTranscriptPatchKind>,
    ): boolean {
        const list = this.host.transcriptUi.activeList;
        if (!list) {
            return false;
        }
        const wasNearBottom = list.isNearBottom();

        if (patchKind === 'activity-only') {
            this.host.transcriptLastConv = conv;
            list.setItemCount(conv.messages.length);
            list.setFooter(this.buildTranscriptVirtualFooter(conv));
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            if (wasNearBottom) {
                list.scrollToEnd();
            }
            return true;
        }

        const lastAgent = conv.messages[conv.messages.length - 1];
        if (!lastAgent || !lastAgent.id || lastAgent.role !== 'agent') {
            return false;
        }
        const prevLast = this.host.transcriptLastConv?.messages[this.host.transcriptLastConv.messages.length - 1];
        const segments = this.resolveTranscriptAgentSegments(conv, lastAgent);

        if (patchKind === 'last-agent') {
            const existing = list.findRowByAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, lastAgent.id);
            if (existing && this.tryPatchStreamingAgentTextContent(existing, prevLast, lastAgent, segments, conv)) {
                this.markTranscriptMessageRow(existing, lastAgent.id, isTranscriptAgentTailStreaming(conv));
                this.host.transcriptLastConv = conv;
                list.setItemCount(conv.messages.length);
                list.setFooter(this.buildTranscriptVirtualFooter(conv));
                this.host.transcriptLastRenderedConversationId = conv.id;
                this.host.transcriptLastRenderedMessageId = lastAgent.id;
                if (wasNearBottom) {
                    list.scrollToEnd();
                }
                return true;
            }
        }

        this.host.transcriptLastConv = conv;
        const row = segments?.length
            ? this.artifactsUi.createTranscriptAgentSegmentsRow(segments, lastAgent.error, conv, { streaming: true })
            : this.createTranscriptMessageRowAtIndex(conv, conv.messages.length - 1);
        this.markTranscriptMessageRow(row, lastAgent.id, isTranscriptAgentTailStreaming(conv));

        if (patchKind === 'last-agent') {
            list.replaceRowByAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, lastAgent.id, row);
        }
        list.setItemCount(conv.messages.length);
        list.setFooter(this.buildTranscriptVirtualFooter(conv));
        this.host.transcriptLastRenderedConversationId = conv.id;
        this.host.transcriptLastRenderedMessageId = lastAgent.id;
        if (wasNearBottom) {
            list.scrollToEnd();
        }
        return true;
    }

    markTranscriptMessageRow(row: HTMLElement, messageId: string, streaming: boolean): void {
        const wasStreaming = row.classList.contains('theia-mod-streaming');
        row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, messageId);
        row.classList.toggle('theia-mod-streaming', streaming);
        if (wasStreaming && !streaming) {
            this.contentUi.settleTranscriptStreamingContent(row);
        }
    }

    tryPatchStreamingAgentTextContent(
        existingRow: HTMLElement,
        prevMsg: QaapAgentMessageDTO | undefined,
        nextMsg: QaapAgentMessageDTO,
        resolvedSegments: QaapAgentMessageSegmentDTO[] | undefined,
        conv?: QaapAgentConversationDTO,
    ): boolean {
        const prevComparable = prevMsg ? this.withDerivedTranscriptSegments(prevMsg) : undefined;
        const nextComparable = this.withDerivedTranscriptSegments(nextMsg);
        if (canStreamPatchStdoutAgentContentOnly(prevComparable, nextComparable)) {
            const contentEl = existingRow.querySelector<HTMLElement>('.theia-mobile-agent-transcript-content');
            if (!contentEl) {
                return false;
            }
            this.toolUi.renderTranscriptRichContent(
                contentEl,
                normalizeAgentMessageContentForDisplay(nextMsg.content),
                { streaming: existingRow.classList.contains('theia-mod-streaming') },
            );
            return true;
        }
        if (!prevComparable) {
            return false;
        }
        const nextSegments = nextComparable.segments ?? [];
        const prevSegments = prevComparable.segments ?? [];
        const segmentsInPlace = canStreamPatchAgentSegmentsInPlace(prevComparable, nextComparable);
        const appendTool = canStreamPatchAgentAppendToolSegment(prevComparable, nextComparable);
        const appendText = canStreamPatchAgentAppendTextSegment(prevComparable, nextComparable);
        if (!segmentsInPlace && !appendTool && !appendText) {
            return false;
        }
        if (segmentsInPlace) {
            if (resolvedSegments?.length) {
                if (!this.artifactsUi.patchStreamingAgentTextSegments(existingRow, prevSegments, nextSegments)) {
                    return false;
                }
            } else {
                const contentEl = existingRow.querySelector<HTMLElement>('.theia-mobile-agent-transcript-content');
                const lastText = [...nextSegments].reverse().find(segment => segment.type === 'text');
                if (contentEl && lastText?.type === 'text') {
                    this.toolUi.renderTranscriptRichContent(
                        contentEl,
                        lastText.content ?? '',
                        { streaming: existingRow.classList.contains('theia-mod-streaming') },
                    );
                }
            }
            if (prevSegments.length === nextSegments.length) {
                if (!this.artifactsUi.patchStreamingAgentToolSegments(existingRow, prevSegments, nextSegments, conv)) {
                    if (existingRow.classList.contains('theia-mod-streaming')) {
                        this.artifactsUi.patchStreamingActivityTimeline(existingRow, nextSegments, conv);
                    } else {
                        return false;
                    }
                }
            }
        }
        if (appendTool) {
            if (!this.artifactsUi.appendStreamingAgentToolSegment(existingRow, nextSegments, conv)) {
                return false;
            }
        }
        if (appendText) {
            if (!this.artifactsUi.appendStreamingAgentTextSegment(existingRow, nextSegments, conv)) {
                return false;
            }
        }
        this.artifactsUi.patchStreamingActivityTimeline(existingRow, nextSegments, conv);
        return true;
    }

    removeTranscriptActivityRow(messageHost: HTMLElement): void {
        messageHost.querySelector(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`)?.remove();
    }

    protected clearTranscriptEmptyQuickActions(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        if (shouldShowTranscriptEmptyQuickActions(conv, this.host.transcriptLastConv)) {
            return;
        }
        messageHost.classList.remove('theia-mod-empty-chat');
        messageHost.querySelector('.theia-mobile-agent-transcript-empty')?.remove();
    }

    syncTranscriptActivityRow(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        this.clearTranscriptEmptyQuickActions(messageHost, conv);
        this.removeTranscriptActivityRow(messageHost);
        messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
            element.classList.remove('theia-mod-streaming');
            if (element instanceof HTMLElement) {
                this.contentUi.settleTranscriptStreamingContent(element);
            }
        });
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming' && conv.messages.at(-1)?.role === 'user') {
            const activityRow = this.artifactsUi.createTranscriptStreamingActivityRow(conv);
            if (activityRow) {
                messageHost.append(activityRow);
            }
        }
    }

    createTranscriptAgentFailureRow(
        msg: QaapAgentMessageDTO,
        options?: { readonly deferHeavyContent?: boolean },
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
        if (options?.deferHeavyContent) {
            row.setAttribute('data-transcript-row-deferred', '1');
        }
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-transcript-segments';
        body.append(this.toolUi.createTranscriptAgentFailureDialog(msg.error ?? '', msg.content));
        row.append(body);
        return row;
    }

    createTranscriptMessageRow(
        role: 'user' | 'agent',
        content: string,
        _error?: string,
        options?: { readonly deferHeavyContent?: boolean; readonly streaming?: boolean },
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = `theia-mobile-agent-transcript-msg theia-mod-${role}`;
        if (options?.deferHeavyContent) {
            row.setAttribute('data-transcript-row-deferred', '1');
        }
        // Ownership is conveyed by alignment and the bubble surface, so no redundant "You" label.
        const contentEl = document.createElement('div');
        contentEl.className = 'theia-mobile-agent-transcript-content';
        this.toolUi.renderTranscriptRichContent(
            contentEl,
            normalizeAgentMessageContentForDisplay(content),
            { defer: options?.deferHeavyContent, streaming: options?.streaming },
        );
        row.append(contentEl);
        return row;
    }
}
