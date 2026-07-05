// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { normalizeAgentMessageContentForDisplay } from '../common/qaap-agent-message-content';
import { parseAgentLogForTranscript } from '../common/qaap-cli-transcript-stream';
import { dedupeAgentMessageTextSegments } from '../common/qaap-qaiq-stream';
import { resolveQaapTranscriptTrace, segmentsToTraceEvents, traceEventsToSegments, type QaapTranscriptTrace } from '../common/qaap-transcript-trace-model';
import { agentMessageHasStructuredTrace } from '../common/qaap-transcript-trace-lifecycle';
import { buildConversationTranscriptFingerprint, isStreamingTranscriptTailUnchanged, resolveStreamingTranscriptPatchKind, TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, canStreamPatchAgentAppendTextSegment, canStreamPatchAgentAppendToolSegment, canStreamPatchAgentSegmentsInPlace, canStreamPatchStdoutAgentContentOnly } from '../common/qaap-transcript-incremental-update';
import {
    isTranscriptAgentTailStreaming,
    resolveTranscriptEffectiveStatus,
    shouldShowTranscriptEmptyQuickActions,
} from '../common/qaap-transcript-turn-status';
import { isTranscriptScrollNearBottom } from '../common/qaap-transcript-user-scroll-pin';
import { scrollElementToEnd, scrollElementToEndAfterLayout } from '../common/qaap-prefers-reduced-motion';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';
import { attachTranscriptScrollToBottomButton } from './qaap-transcript-scroll-to-bottom';
import {
    attachTranscriptScrollIntentObserver,
    shouldPauseTranscriptAutoFollow,
} from './qaap-transcript-scroll-intent';
import { attachTranscriptUserScrollPin } from './qaap-transcript-user-scroll-pin';
import { attachTranscriptInlineSearch } from './qaap-transcript-inline-search';
import { attachTranscriptDensityToggle } from './qaap-transcript-density';
import { attachTranscriptTurnNavigator } from './qaap-transcript-turn-navigator';
import {
    attachTranscriptReadPositionPersistence,
    resolveStoredTranscriptReadMessageIndex,
    restoreTranscriptReadPosition,
} from './qaap-transcript-read-position';
import { attachTranscriptActivityTimelineStickySummary } from './qaap-transcript-activity-timeline-sticky-summary';
import {
    attachTranscriptRowDeferObserver,
    shouldDeferTranscriptRowHeavyContent,
} from './qaap-transcript-row-defer';
import { normalizeAgentConversationFailures, type QaapAgentConversationDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import {
    extractLastFailedToolFromMessage,
    resolveAgentTurnFailureTechnicalContent,
} from '../common/qaap-agent-failure-message';
import type { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import type { MobileProjectsTranscriptMessagesUserUi } from './mobile-projects-transcript-messages-user-ui';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';

export class MobileProjectsTranscriptMessagesRenderUi {
    protected readonly transcriptAgentSegmentsCache = new Map<string, readonly QaapAgentMessageSegmentDTO[]>();
    protected transcriptAgentSegmentsCacheConversationId: string | undefined;
    /**
     * Tracks the most recent cache key inserted per message (`${conv.id}|${msg.id}`).
     * The cache key embeds a content signature that changes every streamed token, so
     * without this, a streaming tail message would insert a brand-new entry on every
     * tick — unbounded growth until the 1000-entry cap wipes the whole cache. Deleting
     * the message's previous entry before inserting the new one caps live growth at one
     * entry per message while still caching finished messages across re-renders.
     */
    protected readonly transcriptAgentSegmentsCacheKeyByMessage = new Map<string, string>();

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
        this.syncTranscriptAgentSegmentsCache(conv.id);
        const cacheKey = this.transcriptAgentSegmentsCacheKey(conv, msg);
        const cached = this.transcriptAgentSegmentsCache.get(cacheKey);
        if (cached) {
            return cached.length ? [...cached] : undefined;
        }
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
            const segments = dedupeAgentMessageTextSegments([...trace.segments]);
            this.setTranscriptAgentSegmentsCacheEntry(conv, msg, cacheKey, segments);
            return [...segments];
        }
        this.setTranscriptAgentSegmentsCacheEntry(conv, msg, cacheKey, []);
        return undefined;
    }

    protected syncTranscriptAgentSegmentsCache(conversationId: string): void {
        if (this.transcriptAgentSegmentsCacheConversationId === conversationId && this.transcriptAgentSegmentsCache.size < 1_000) {
            return;
        }
        this.transcriptAgentSegmentsCacheConversationId = conversationId;
        this.transcriptAgentSegmentsCache.clear();
        this.transcriptAgentSegmentsCacheKeyByMessage.clear();
    }

    /**
     * Inserts a cache entry, evicting the message's previous entry first so a
     * streaming tail message (whose cache key changes every tick) never holds
     * more than one live entry — see {@link transcriptAgentSegmentsCacheKeyByMessage}.
     */
    protected setTranscriptAgentSegmentsCacheEntry(
        conv: QaapAgentConversationDTO,
        msg: QaapAgentMessageDTO,
        cacheKey: string,
        segments: readonly QaapAgentMessageSegmentDTO[],
    ): void {
        const messageKey = `${conv.id}|${msg.id ?? ''}`;
        const previousKey = this.transcriptAgentSegmentsCacheKeyByMessage.get(messageKey);
        if (previousKey !== undefined && previousKey !== cacheKey) {
            this.transcriptAgentSegmentsCache.delete(previousKey);
        }
        this.transcriptAgentSegmentsCacheKeyByMessage.set(messageKey, cacheKey);
        this.transcriptAgentSegmentsCache.set(cacheKey, segments);
    }

    protected transcriptAgentSegmentsCacheKey(conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO): string {
        return [
            conv.id,
            msg.id ?? '',
            msg.role,
            this.transcriptTextSignature(msg.content),
            msg.error?.length ?? 0,
            msg.traceEvents?.length ?? 0,
            this.transcriptSegmentsSignature(msg.segments),
        ].join('|');
    }

    protected transcriptTextSignature(text: string | undefined): string {
        if (!text) {
            return '0';
        }
        return `${text.length}:${text.slice(0, 32)}:${text.slice(-32)}`;
    }

    protected transcriptSegmentsSignature(segments: readonly QaapAgentMessageSegmentDTO[] | undefined): string {
        if (!segments?.length) {
            return '0';
        }
        const last = segments[segments.length - 1];
        if (last.type === 'tool') {
            return [
                segments.length,
                last.toolUseId,
                last.name,
                last.finished ? '1' : '0',
                this.transcriptTextSignature(last.args),
                this.transcriptTextSignature(last.result),
            ].join(':');
        }
        return [
            segments.length,
            last.type,
            this.transcriptTextSignature(last.content),
        ].join(':');
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
                message: msg,
            });
            if (msg.id) {
                row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, msg.id);
            }
        } else if (msg.role === 'agent' && msg.error?.trim()) {
            row = this.createTranscriptAgentFailureRow(msg, normalized, { deferHeavyContent });
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
        if (msg.id && !row.hasAttribute(TRANSCRIPT_MESSAGE_ID_ATTR)) {
            row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, msg.id);
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

    protected shouldFollowTranscriptTail(scroller: HTMLElement): boolean {
        return isTranscriptScrollNearBottom(
            scroller.scrollTop,
            scroller.clientHeight,
            scroller.scrollHeight,
        ) && !shouldPauseTranscriptAutoFollow(scroller);
    }

    protected captureTranscriptScrollAnchor(scroller: HTMLElement): {
        readonly top: number;
        readonly element?: HTMLElement;
        readonly offsetTop?: number;
    } {
        const scrollerRect = scroller.getBoundingClientRect();
        const candidates = [...scroller.querySelectorAll<HTMLElement>(
            '.theia-mobile-agent-transcript-msg, [data-transcript-message-id], [data-transcript-activity-row]',
        )];
        const element = candidates.find(candidate => candidate.getBoundingClientRect().bottom >= scrollerRect.top + 8);
        return {
            top: scroller.scrollTop,
            element,
            offsetTop: element ? element.getBoundingClientRect().top - scrollerRect.top : undefined,
        };
    }

    protected restoreTranscriptScrollAnchor(
        scroller: HTMLElement,
        anchor: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,
    ): void {
        if (!anchor.element?.isConnected || anchor.offsetTop === undefined) {
            scroller.scrollTop = anchor.top;
            return;
        }
        const scrollerRect = scroller.getBoundingClientRect();
        const currentOffset = anchor.element.getBoundingClientRect().top - scrollerRect.top;
        scroller.scrollTop += currentOffset - anchor.offsetTop;
    }

    protected scrollTranscriptTurnStartIntoReadingPosition(messageHost: HTMLElement, row: HTMLElement): void {
        const scrollerRect = messageHost.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const contextPx = Math.min(96, Math.max(40, Math.round(messageHost.clientHeight * 0.14)));
        const nextTop = messageHost.scrollTop + rowRect.top - scrollerRect.top - contextPx;
        messageHost.scrollTo({
            top: Math.max(0, Math.min(nextTop, Math.max(0, messageHost.scrollHeight - messageHost.clientHeight))),
            behavior: 'auto',
        });
    }

    protected findLastUserMessageRow(messageHost: HTMLElement): HTMLElement | undefined {
        return [...messageHost.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-msg.theia-mod-user')].at(-1);
    }

    protected findLastUserMessageIndex(conv: QaapAgentConversationDTO): number {
        for (let index = conv.messages.length - 1; index >= 0; index--) {
            if (conv.messages[index]?.role === 'user') {
                return index;
            }
        }
        return -1;
    }

    protected hasExplicitTranscriptMessageHash(): boolean {
        return typeof window !== 'undefined' && window.location.hash.startsWith('#qaap-transcript-message-');
    }

    protected scrollTranscriptVirtualListToIndex(
        list: { scrollToIndex?: (index: number, contextPx?: number) => void },
        index: number,
        contextPx: number,
    ): void {
        list.scrollToIndex?.(index, contextPx);
    }

    protected restoreTranscriptOpeningPositionVirtual(
        list: { scrollToIndex?: (index: number, contextPx?: number) => void },
        conv: QaapAgentConversationDTO,
        contextPx: number,
    ): boolean {
        const storedIndex = resolveStoredTranscriptReadMessageIndex(conv.id, conv.messages);
        if (storedIndex !== undefined) {
            this.scrollTranscriptVirtualListToIndex(list, storedIndex, contextPx);
            return true;
        }
        return false;
    }

    protected createTranscriptEmptyWelcome(): HTMLElement {
        const welcome = document.createElement('section');
        welcome.className = 'theia-mobile-agent-transcript-empty-welcome';
        welcome.setAttribute(
            'aria-label',
            nls.localize('qaap/mobileProjects/transcriptEmptyWelcomeAria', 'Qaaq welcome'),
        );

        const logo = document.createElement('div');
        logo.className = 'theia-mobile-agent-transcript-empty-logo';
        logo.setAttribute('aria-hidden', 'true');

        const title = document.createElement('h2');
        title.className = 'theia-mobile-agent-transcript-empty-title';
        title.textContent = nls.localize('qaap/mobileProjects/transcriptEmptyWelcomeTitle', 'Ready when you are.');

        const subtitle = document.createElement('p');
        subtitle.className = 'theia-mobile-agent-transcript-empty-subtitle';
        subtitle.textContent = nls.localize(
            'qaap/mobileProjects/transcriptEmptyWelcomeSubtitle',
            'Describe the outcome. Qaaq will plan, execute, and keep every step visible.',
        );

        welcome.append(logo, title, subtitle);
        return welcome;
    }

    renderTranscriptMessagesVirtual(host: HTMLElement, conv: QaapAgentConversationDTO, options?: { readonly openingConversation?: boolean }): void {
        const normalized = normalizeAgentConversationFailures(conv);
        this.host.transcriptLastConv = normalized;
        const messageHost = this.resolveTranscriptMessageHost(host);
        messageHost.classList.remove('theia-mod-empty-chat');
        messageHost.classList.add('theia-mod-virtual-scroll');
        this.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');

        const list = this.host.transcriptUi.mount(messageHost, normalized, index => {
            const current = this.host.transcriptLastConv;
            if (!current) {
                return document.createElement('div');
            }
            return this.createTranscriptMessageRowAtIndex(current, index);
        });

        const wasFollowingTail = list.isNearBottom() && !shouldPauseTranscriptAutoFollow(messageHost);
        list.setItemCount(normalized.messages.length);
        list.setFooter(this.buildTranscriptVirtualFooter(normalized));
        this.host.transcriptLastRenderedConversationId = normalized.id;
        this.host.transcriptLastRenderedMessageId = normalized.messages.at(-1)?.id;
        if (options?.openingConversation && !this.hasExplicitTranscriptMessageHash()) {
            const contextPx = Math.min(96, Math.max(40, Math.round(messageHost.clientHeight * 0.14)));
            if (!this.restoreTranscriptOpeningPositionVirtual(list, normalized, contextPx)) {
                const lastUserIndex = this.findLastUserMessageIndex(normalized);
                if (lastUserIndex >= 0) {
                    this.scrollTranscriptVirtualListToIndex(
                        list,
                        lastUserIndex,
                        contextPx,
                    );
                }
            }
        } else if (wasFollowingTail) {
            list.scrollToEnd();
        }
        this.attachTranscriptScrollChrome(host, messageHost, conv);
    }

    protected restoreTranscriptOpeningPosition(messageHost: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        if (this.hasExplicitTranscriptMessageHash()) {
            return false;
        }
        return restoreTranscriptReadPosition(messageHost, conv.id);
    }

    protected scrollTranscriptToLastUserTurn(messageHost: HTMLElement): void {
        const userRow = this.findLastUserMessageRow(messageHost);
        if (userRow) {
            this.scrollTranscriptTurnStartIntoReadingPosition(messageHost, userRow);
        }
    }

    renderTranscriptMessages(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        const conversationSwitched = this.host.transcriptLastRenderedConversationId !== undefined
            && this.host.transcriptLastRenderedConversationId !== conv.id;
        // Settled (non-streaming) snapshots can never take the stream-patch fast path and never
        // satisfy `isStreamingTranscriptTailUnchanged` (both bail on `status !== 'streaming'`), so
        // any re-render of one falls straight through to a full rebuild. A background/idle host that
        // re-runs this on every SSE tick of *another* streaming conversation therefore rebuilds an
        // unchanged transcript ~8x/s. Short-circuit host-locally when the settled snapshot is
        // byte-identical to what this host already shows. The key is stamped on the host element
        // itself (not the shared `transcriptLast*` fields, which thrash between hosts) and includes
        // the conversation id, so a switch to a different conversation always repaints. Streaming
        // renders bypass this and clear the stamp, so a later re-settle still repaints exactly once.
        if (conv.status !== 'streaming') {
            const settledHost = this.resolveTranscriptMessageHost(host);
            const settledKey = `${conv.id} ${buildConversationTranscriptFingerprint(conv)}`;
            if (settledHost.childElementCount > 0 && settledHost.dataset.qaapSettledRenderKey === settledKey) {
                recordTranscriptRenderMetric('render_skip_unchanged_settled');
                this.clearTranscriptEmptyQuickActions(settledHost, conv);
                return;
            }
            settledHost.dataset.qaapSettledRenderKey = settledKey;
        } else {
            const streamingHost = this.resolveTranscriptMessageHost(host);
            if (streamingHost.dataset.qaapSettledRenderKey !== undefined) {
                delete streamingHost.dataset.qaapSettledRenderKey;
            }
        }
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
        const previousConversation = this.host.transcriptLastConv;
        const shouldVirtualize = this.host.transcriptUi.shouldVirtualize(conv);
        const messageHost = this.resolveTranscriptMessageHost(host);
        const openingConversation = previousConversation?.id !== conv.id && messageHost.childElementCount === 0;
        this.host.transcriptLastConv = conv;
        const showQuickActions = shouldShowTranscriptEmptyQuickActions(conv, previousConversation);
        const isEmptyChat = conv.messages.length === 0 && resolveTranscriptEffectiveStatus(conv) !== 'streaming';
        if (isEmptyChat && showQuickActions) {
            this.host.transcriptUi.disposeList();
            messageHost.classList.remove('theia-mod-virtual-scroll');
            messageHost.replaceChildren();
            messageHost.classList.toggle('theia-mod-empty-chat', true);
            messageHost.append(this.createTranscriptEmptyWelcome());
            this.host.transcriptComposerHost?.classList.toggle('theia-mod-show-quick-actions', true);
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
        if (isEmptyChat) {
            this.host.transcriptUi.disposeList();
            messageHost.classList.remove('theia-mod-virtual-scroll', 'theia-mod-empty-chat');
            this.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');
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
            this.renderTranscriptMessagesVirtual(host, conv, { openingConversation });
            return;
        }
        this.host.transcriptUi.disposeList();
        messageHost.classList.remove('theia-mod-virtual-scroll');
        const sameConversation = previousConversation?.id === conv.id;
        const previousLastMessageId = previousConversation?.messages.at(-1)?.id;
        const nextLastMessage = conv.messages.at(-1);
        const newTurnStarted = sameConversation
            && nextLastMessage?.role === 'user'
            && !!nextLastMessage.id
            && nextLastMessage.id !== previousLastMessageId;
        const shouldFollowTail = this.shouldFollowTranscriptTail(messageHost);
        const anchor = shouldFollowTail || newTurnStarted
            ? undefined
            : this.captureTranscriptScrollAnchor(messageHost);
        messageHost.replaceChildren();
        messageHost.classList.toggle('theia-mod-empty-chat', false);
        this.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');
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
        if (newTurnStarted) {
            this.scrollTranscriptToLastUserTurn(messageHost);
        } else if (openingConversation && !this.hasExplicitTranscriptMessageHash()) {
            if (!this.restoreTranscriptOpeningPosition(messageHost, conv)) {
                this.scrollTranscriptToLastUserTurn(messageHost);
            }
        } else if (shouldFollowTail) {
            scrollElementToEndAfterLayout(messageHost);
        } else if (anchor) {
            this.restoreTranscriptScrollAnchor(messageHost, anchor);
            window.requestAnimationFrame(() => this.restoreTranscriptScrollAnchor(messageHost, anchor));
        }
        this.attachTranscriptScrollChrome(host, messageHost, conv);
    }

    protected attachTranscriptScrollChrome(
        host: HTMLElement,
        messageHost: HTMLElement,
        conv: QaapAgentConversationDTO,
    ): void {
        this.host.transcriptUserScrollPinDispose.dispose();
        this.host.transcriptUserScrollPinDispose = new DisposableCollection(
            attachTranscriptUserScrollPin(messageHost),
            attachTranscriptScrollIntentObserver(messageHost),
            attachTranscriptInlineSearch(host, messageHost),
            attachTranscriptDensityToggle(host, messageHost),
            attachTranscriptTurnNavigator(host, messageHost),
            attachTranscriptReadPositionPersistence(messageHost, conv.id),
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
        const shouldFollowTail = this.shouldFollowTranscriptTail(messageHost);
        const anchor = shouldFollowTail ? undefined : this.captureTranscriptScrollAnchor(messageHost);

        if (patchKind === 'activity-only') {
            recordTranscriptRenderMetric('render_patch_activity');
            this.syncTranscriptActivityRow(messageHost, conv);
            this.host.transcriptLastConv = conv;
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            if (shouldFollowTail) {
                scrollElementToEnd(messageHost);
            } else if (anchor) {
                this.restoreTranscriptScrollAnchor(messageHost, anchor);
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
                recordTranscriptRenderMetric('render_patch_last_agent_in_place');
                this.markTranscriptMessageRow(existing, lastAgent.id, isTranscriptAgentTailStreaming(conv));
                this.removeTranscriptActivityRow(messageHost);
                this.host.transcriptLastConv = conv;
                this.host.transcriptLastRenderedConversationId = conv.id;
                this.host.transcriptLastRenderedMessageId = lastAgent.id;
                if (shouldFollowTail) {
                    scrollElementToEnd(messageHost);
                } else if (anchor) {
                    this.restoreTranscriptScrollAnchor(messageHost, anchor);
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
            ? this.artifactsUi.createTranscriptAgentSegmentsRow(segments, lastAgent.error, conv, { streaming: true, message: lastAgent })
            : this.createTranscriptMessageRowAtIndex(conv, conv.messages.length - 1);
        this.markTranscriptMessageRow(row, lastAgent.id, isTranscriptAgentTailStreaming(conv));

        if (patchKind === 'last-agent') {
            recordTranscriptRenderMetric('render_patch_last_agent');
            recordTranscriptRenderMetric('render_patch_last_agent_replace');
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
            if (!shouldFollowTail) {
                row.classList.add('theia-mod-new-message');
            }
            messageHost.append(row);
        }

        this.host.transcriptLastConv = conv;
        this.host.transcriptLastRenderedConversationId = conv.id;
        this.host.transcriptLastRenderedMessageId = lastAgent.id;
        if (shouldFollowTail) {
            scrollElementToEnd(messageHost);
        } else if (anchor) {
            this.restoreTranscriptScrollAnchor(messageHost, anchor);
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
        const messageHost = this.resolveTranscriptMessageHost(_host);
        const wasFollowingTail = list.isNearBottom() && !shouldPauseTranscriptAutoFollow(messageHost);

        if (patchKind === 'activity-only') {
            recordTranscriptRenderMetric('render_patch_activity');
            recordTranscriptRenderMetric('render_patch_activity_in_place');
            this.host.transcriptLastConv = conv;
            list.setItemCount(conv.messages.length);
            list.setFooter(this.buildTranscriptVirtualFooter(conv));
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            if (wasFollowingTail) {
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
                recordTranscriptRenderMetric('render_patch_last_agent');
                recordTranscriptRenderMetric('render_patch_last_agent_in_place');
                this.markTranscriptMessageRow(existing, lastAgent.id, isTranscriptAgentTailStreaming(conv));
                this.host.transcriptLastConv = conv;
                list.setItemCount(conv.messages.length);
                list.setFooter(this.buildTranscriptVirtualFooter(conv));
                this.host.transcriptLastRenderedConversationId = conv.id;
                this.host.transcriptLastRenderedMessageId = lastAgent.id;
                if (wasFollowingTail) {
                    list.scrollToEnd();
                }
                return true;
            }
        }

        this.host.transcriptLastConv = conv;
        const row = segments?.length
            ? this.artifactsUi.createTranscriptAgentSegmentsRow(segments, lastAgent.error, conv, { streaming: true, message: lastAgent })
            : this.createTranscriptMessageRowAtIndex(conv, conv.messages.length - 1);
        this.markTranscriptMessageRow(row, lastAgent.id, isTranscriptAgentTailStreaming(conv));

        if (patchKind === 'last-agent') {
            recordTranscriptRenderMetric('render_patch_last_agent');
            recordTranscriptRenderMetric('render_patch_last_agent_replace');
            list.replaceRowByAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, lastAgent.id, row);
        } else {
            recordTranscriptRenderMetric('render_patch_append');
        }
        list.setItemCount(conv.messages.length);
        list.setFooter(this.buildTranscriptVirtualFooter(conv));
        this.host.transcriptLastRenderedConversationId = conv.id;
        this.host.transcriptLastRenderedMessageId = lastAgent.id;
        if (wasFollowingTail) {
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
                if (!this.artifactsUi.patchStreamingAgentTextSegments(existingRow, prevSegments, nextSegments, conv)) {
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
        this.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');
    }

    syncTranscriptActivityRow(messageHost: HTMLElement, conv: QaapAgentConversationDTO): void {
        this.clearTranscriptEmptyQuickActions(messageHost, conv);
        const existingActivityRow = messageHost.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`);
        messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
            if (element === existingActivityRow) {
                return;
            }
            element.classList.remove('theia-mod-streaming');
            if (element instanceof HTMLElement) {
                this.contentUi.settleTranscriptStreamingContent(element);
            }
        });
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming' && conv.messages.at(-1)?.role === 'user') {
            if (existingActivityRow && this.artifactsUi.syncTranscriptStreamingActivityRow(existingActivityRow, conv)) {
                recordTranscriptRenderMetric('render_patch_activity_in_place');
                return;
            }
            this.removeTranscriptActivityRow(messageHost);
            recordTranscriptRenderMetric('render_patch_activity_replace');
            const activityRow = this.artifactsUi.createTranscriptStreamingActivityRow(conv);
            if (activityRow) {
                messageHost.append(activityRow);
            }
            return;
        }
        this.removeTranscriptActivityRow(messageHost);
    }

    createTranscriptAgentFailureRow(
        msg: QaapAgentMessageDTO,
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
        if (options?.deferHeavyContent) {
            row.setAttribute('data-transcript-row-deferred', '1');
        }
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-transcript-segments';
        const failedTool = extractLastFailedToolFromMessage(msg);
        const canRetry = conv?.status === 'failed' && !!this.host.retryOpenFailedConversationTask;
        body.append(this.toolUi.createTranscriptAgentFailureDialog(
            msg.error ?? '',
            resolveAgentTurnFailureTechnicalContent(msg),
            {
                failedToolName: failedTool?.name,
                onRetry: canRetry ? () => this.host.retryOpenFailedConversationTask?.() : undefined,
            },
        ));
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
