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
import { buildConversationTranscriptFingerprint, fingerprintTranscriptMessage, isStreamingTranscriptTailUnchanged, resolveStreamingTranscriptPatchDecision, resolveStreamingTranscriptPatchKind, TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, canStreamPatchAgentAppendTextSegment, canStreamPatchAgentAppendThinkingSegment, canStreamPatchAgentAppendToolSegment, canStreamPatchAgentSegmentsInPlace, canStreamPatchAgentSegmentsInPlaceWithAppend, canStreamPatchStdoutAgentContentOnly, type QaapTranscriptStreamingPatchNoneReason } from '../common/qaap-transcript-incremental-update';
import { TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS } from './qaap-transcript-inline-approval-ui';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { hasMobileExecutionEventTimeline } from './qaap-execution-event-timeline';
import {
    isTranscriptAgentTailStreaming,
    resolveTranscriptEffectiveStatus,
    shouldShowTranscriptEmptyQuickActions,
} from '../common/qaap-transcript-turn-status';
import { recordTranscriptRenderMetric, type QaapTranscriptRenderMetricKind } from '../common/qaap-transcript-render-metrics';

/** Telemetry: attribute every patch-miss to the guard that rejected it. */
const PATCH_NONE_REASON_METRIC: Record<QaapTranscriptStreamingPatchNoneReason, QaapTranscriptRenderMetricKind> = {
    'not-streaming': 'render_patch_none_not_streaming',
    'conversation-switched': 'render_patch_none_conversation_switched',
    'prior-diverged': 'render_patch_none_prior_diverged',
    'tail-empty': 'render_patch_none_tail_empty',
    'tail-unchanged': 'render_patch_none_tail_unchanged',
    'count-shrunk': 'render_patch_none_count_shrunk',
    'tail-role-unknown': 'render_patch_none_tail_role',
};

type TranscriptAgentPatchRejectReason = 'no_prev' | 'predicates' | 'applier' | 'thinking';

const AGENT_REPLACE_REASON_METRIC: Record<TranscriptAgentPatchRejectReason, QaapTranscriptRenderMetricKind> = {
    no_prev: 'render_patch_last_agent_replace_no_prev',
    predicates: 'render_patch_last_agent_replace_predicates',
    applier: 'render_patch_last_agent_replace_applier',
    thinking: 'render_patch_last_agent_replace_thinking',
};
import { attachTranscriptScrollToBottomButton } from './qaap-transcript-scroll-to-bottom';
import {
    attachTranscriptScrollIntentObserver,
    transcriptHasActiveSelection,
    transcriptHasInteractiveFocus,
} from './qaap-transcript-scroll-intent';
import {
    ensureTranscriptScrollController,
    type TranscriptScrollController,
} from './qaap-transcript-scroll-controller';
import { attachTranscriptUserScrollPin } from './qaap-transcript-user-scroll-pin';
import { attachTranscriptInlineSearch } from './qaap-transcript-inline-search';
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
        // Preserve the legacy stream-footer host (empty/hidden). Live-status mounts
        // as the last child of the scroller list after messages render.
        const streamFooter = host.querySelector(':scope > .theia-mobile-agent-transcript-stream-footer');
        if (streamFooter instanceof HTMLElement) {
            host.replaceChildren(list, streamFooter);
        } else {
            host.replaceChildren(list);
        }
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

    /** Derive segments[] from traceEvents so incremental DOM patches match {@link resolveQaapTranscriptTrace}. */
    protected withDerivedTranscriptSegments(msg: QaapAgentMessageDTO): QaapAgentMessageDTO {
        if (!msg.traceEvents?.length) {
            return msg;
        }
        const segments = dedupeAgentMessageTextSegments(traceEventsToSegments(msg.traceEvents));
        return segments.length ? { ...msg, segments } : msg;
    }

    /**
     * Failure normalization is O(messages); memoized per snapshot so the full
     * rebuild loop (which calls {@link createTranscriptMessageRowAtIndex} once
     * per row) stays O(N) instead of O(N²). Snapshots are immutable per tick,
     * so keying by object identity is safe.
     */
    private readonly normalizedFailuresCache = new WeakMap<QaapAgentConversationDTO, QaapAgentConversationDTO>();

    protected normalizeConversationFailuresCached(conv: QaapAgentConversationDTO): QaapAgentConversationDTO {
        let normalized = this.normalizedFailuresCache.get(conv);
        if (!normalized) {
            normalized = normalizeAgentConversationFailures(conv);
            this.normalizedFailuresCache.set(conv, normalized);
        }
        return normalized;
    }

    /**
     * Stable render key for full-rebuild row reuse. Undefined when the row must
     * always rebuild: no id, failure rows (their retry affordance depends on
     * conv.status), or rows containing live approval UI (checked at reuse time).
     */
    protected transcriptRowRenderKey(conv: QaapAgentConversationDTO, index: number): string | undefined {
        const msg = conv.messages[index];
        if (!msg?.id || msg.error?.trim()) {
            return undefined;
        }
        return `${conv.id}|${msg.role}|${fingerprintTranscriptMessage(msg)}`;
    }

    createTranscriptMessageRowAtIndex(conv: QaapAgentConversationDTO, index: number): HTMLElement {
        const normalized = this.normalizeConversationFailuresCached(conv);
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
        // A completed compaction seam is rendered inline, glued to the top of the first
        // message that survived compaction, so the user can see exactly where the context
        // was folded (everything above the seam was summarized). The running/live shimmer
        // stays in the footer — see buildTranscriptVirtualFooter.
        if (this.transcriptContextCompactionBoundaryIndex(normalized) === index) {
            const seam = this.createTranscriptContextCompactionRow(normalized);
            if (seam) {
                const wrap = document.createElement('div');
                wrap.className = 'theia-mobile-agent-transcript-compaction-seam';
                wrap.append(seam, row);
                return wrap;
            }
        }
        return row;
    }

    /**
     * Index of the first message that survived a *completed* compaction, i.e. the seam where the
     * inline "Context automatically compacted" marker is glued. When the backend has already
     * trimmed compacted messages out of the live list, the original boundary can be beyond the
     * current array; in that case anchor the seam to the first visible message.
     */
    protected transcriptContextCompactionBoundaryIndex(conv: QaapAgentConversationDTO): number | undefined {
        const compaction = conv.contextCompaction;
        if (!compaction || compaction.status !== 'complete') {
            return undefined;
        }
        const boundary = compaction.compactedMessageCount;
        if (boundary <= 0 || boundary >= conv.messages.length) {
            return conv.messages.length > 0 && boundary > 0 ? 0 : undefined;
        }
        return boundary;
    }

    buildTranscriptVirtualFooter(
        conv: QaapAgentConversationDTO,
        options?: { readonly existingActivityRow?: HTMLElement | null },
    ): HTMLElement[] {
        const footers: HTMLElement[] = [];
        // Only the live shimmer belongs in the footer; the completed seam is rendered inline at the
        // compaction boundary (see createTranscriptMessageRowAtIndex).
        if (conv.contextCompaction?.status === 'running') {
            const contextCompaction = this.createTranscriptContextCompactionRow(conv);
            if (contextCompaction) {
                footers.push(contextCompaction);
            }
        }
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming' && conv.messages.at(-1)?.role === 'user') {
            const existing = options?.existingActivityRow ?? undefined;
            // Reuse the mounted setup/stream row across activity-only footer refreshes.
            // Recreating it (replaceChildren) unmounts `.qaap-agent-setup` and causes a visible
            // hide→show flicker of the logo + shimmer phrase + elapsed meta while the agent works.
            if (existing && this.artifactsUi.syncTranscriptStreamingActivityRow(existing, conv)) {
                existing.hidden = false;
                footers.push(existing);
            } else {
                const row = this.artifactsUi.createTranscriptStreamingActivityRow(conv);
                if (row) {
                    footers.push(row);
                }
            }
        }
        return footers;
    }

    /** Activity row currently mounted in the transcript host or virtual footer. */
    protected findTranscriptStreamingActivityRow(messageHost: HTMLElement): HTMLElement | undefined {
        return messageHost.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`) ?? undefined;
    }

    protected createTranscriptContextCompactionRow(conv: QaapAgentConversationDTO): HTMLElement | undefined {
        const compaction = conv.contextCompaction;
        if (!compaction) {
            return undefined;
        }
        const row = document.createElement('div');
        row.className = 'theia-mobile-agent-transcript-context-compaction';
        row.classList.toggle('theia-mod-running', compaction.status === 'running');
        row.classList.toggle('theia-mod-complete', compaction.status === 'complete');
        row.setAttribute('role', 'status');
        row.setAttribute('aria-live', compaction.status === 'running' ? 'polite' : 'off');

        const before = document.createElement('span');
        before.className = 'theia-mobile-agent-transcript-context-compaction-line';
        before.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-transcript-context-compaction-label';
        if (compaction.status === 'running') {
            label.classList.add('theia-mod-shimmer');
            label.textContent = 'Automatically compacting context';
        } else {
            const icon = document.createElement('span');
            icon.className = 'codicon codicon-go-to-editing-session theia-mobile-agent-transcript-context-compaction-icon';
            icon.setAttribute('aria-hidden', 'true');
            label.append(
                icon,
                document.createTextNode('Context automatically compacted'),
            );
        }

        const after = document.createElement('span');
        after.className = 'theia-mobile-agent-transcript-context-compaction-line';
        after.setAttribute('aria-hidden', 'true');
        row.append(before, label, after);
        return row;
    }

    protected resolveTranscriptScrollController(scroller: HTMLElement): TranscriptScrollController {
        return ensureTranscriptScrollController(scroller);
    }

    /**
     * Follow the live edge only when the reader explicitly opted in (`following` phase).
     * Near-bottom proximity alone must never re-enable auto-scroll.
     * Selection and interactive focus detach; a user gesture can return to the live edge
     * only through the controller's gesture-aware scroll listener.
     */
    protected shouldFollowTranscriptTail(scroller: HTMLElement): boolean {
        const scroll = this.resolveTranscriptScrollController(scroller);
        // Explicit live-edge opt-in (Jump to latest) wins over stale selection/focus.
        if (scroll.shouldFollowTail()) {
            return true;
        }
        if (transcriptHasActiveSelection(scroller) || transcriptHasInteractiveFocus(scroller)) {
            scroll.notifyUserDetach('interaction');
            return false;
        }
        return false;
    }

    protected captureTranscriptScrollAnchor(scroller: HTMLElement): ReturnType<TranscriptScrollController['captureAnchor']> {
        return this.resolveTranscriptScrollController(scroller).captureAnchor(scroller);
    }

    protected restoreTranscriptScrollAnchor(
        scroller: HTMLElement,
        anchor: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,
    ): void {
        this.resolveTranscriptScrollController(scroller).restoreAnchor(scroller, anchor);
    }

    /**
     * Reconcile scroll after a DOM mutation. Re-checks follow intent at apply time so a
     * jump-to-latest during an in-flight patch cannot lose to a stale captured anchor.
     */
    protected applyTranscriptScrollAfterMutation(
        messageHost: HTMLElement,
        anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,
    ): void {
        if (this.shouldFollowTranscriptTail(messageHost)) {
            this.scrollTranscriptFollowTail(messageHost);
        } else if (anchor) {
            this.resolveTranscriptScrollController(messageHost).schedulePreserveAnchor(messageHost, anchor);
        }
    }

    /** Preserve reading position now and once more after layout settles (full rebuild path). */
    protected scheduleTranscriptScrollAfterMutation(
        messageHost: HTMLElement,
        anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,
    ): void {
        if (this.shouldFollowTranscriptTail(messageHost)) {
            this.scrollTranscriptFollowTail(messageHost);
            return;
        }
        if (!anchor) {
            return;
        }
        this.resolveTranscriptScrollController(messageHost).schedulePreserveAnchor(messageHost, anchor);
    }

    protected scrollTranscriptTurnStartIntoReadingPosition(messageHost: HTMLElement, row: HTMLElement): void {
        const scroll = this.resolveTranscriptScrollController(messageHost);
        if (scroll.phase === 'positioning-turn') {
            scroll.positionTurnStart(messageHost, row);
            return;
        }
        scroll.placeReadingPosition(messageHost, row);
    }

    protected scrollTranscriptFollowTail(scroller: HTMLElement): void {
        this.resolveTranscriptScrollController(scroller).onContentChanged(scroller);
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

        welcome.append(logo, title);
        return welcome;
    }

    renderTranscriptMessagesVirtual(
        host: HTMLElement,
        conv: QaapAgentConversationDTO,
        options?: { readonly openingConversation?: boolean; readonly newTurnStarted?: boolean },
    ): void {
        const normalized = this.normalizeConversationFailuresCached(conv);
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

        const scroll = this.resolveTranscriptScrollController(messageHost);
        const wasFollowingTail = this.shouldFollowTranscriptTail(messageHost);
        list.setItemCount(normalized.messages.length);
        list.setFooter(this.buildTranscriptVirtualFooter(normalized, {
            existingActivityRow: this.findTranscriptStreamingActivityRow(messageHost),
        }));
        this.host.transcriptLastRenderedConversationId = normalized.id;
        this.host.transcriptLastRenderedMessageId = normalized.messages.at(-1)?.id;
        if (options?.newTurnStarted) {
            // Always pin the new user turn near the top with prior context.
            // completePositionTurn leaves the phase detached so the stream can
            // grow off-screen without chasing the live edge.
            scroll.beginPositionTurn();
            const lastUserIndex = this.findLastUserMessageIndex(normalized);
            if (lastUserIndex >= 0) {
                scroll.markProgrammaticScroll();
                const contextPx = Math.min(96, Math.max(40, Math.round(messageHost.clientHeight * 0.14)));
                this.scrollTranscriptVirtualListToIndex(list, lastUserIndex, contextPx);
            }
            scroll.completePositionTurn();
            this.artifactsUi.ensurePinnedTranscriptLiveStatus(normalized);
        } else if (options?.openingConversation && !this.hasExplicitTranscriptMessageHash()) {
            scroll.beginRestore();
            scroll.markProgrammaticScroll(200);
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
            scroll.completeRestore();
        } else if (wasFollowingTail) {
            scroll.onContentChanged(messageHost);
        }
        this.attachTranscriptScrollChrome(host, messageHost, conv);
    }

    protected restoreTranscriptOpeningPosition(messageHost: HTMLElement, conv: QaapAgentConversationDTO): boolean {
        if (this.hasExplicitTranscriptMessageHash()) {
            return false;
        }
        return restoreTranscriptReadPosition(messageHost, conv.id);
    }

    protected scrollTranscriptToLastUserTurn(messageHost: HTMLElement, options?: { readonly asPositionTurn?: boolean }): void {
        const userRow = this.findLastUserMessageRow(messageHost);
        if (!userRow) {
            return;
        }
        const scroll = this.resolveTranscriptScrollController(messageHost);
        if (options?.asPositionTurn) {
            scroll.beginPositionTurn();
            this.scrollTranscriptTurnStartIntoReadingPosition(messageHost, userRow);
            scroll.completePositionTurn();
            return;
        }
        this.scrollTranscriptTurnStartIntoReadingPosition(messageHost, userRow);
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
            // Cheap pre-check first: `updatedAt` bumps on any change, and the message count plus the
            // last message's content length catch the common append/edit even if a caller left
            // `updatedAt` stale. An unchanged tuple means the snapshot is identical — skip WITHOUT
            // paying the O(messages × segments) full fingerprint. A background host re-running on
            // another conversation's ~8/s SSE ticks now does a string compare instead of a full hash.
            const lastSettledMessage = conv.messages[conv.messages.length - 1];
            const cheapKey = `${conv.id}|${conv.updatedAt}|${conv.messages.length}|${lastSettledMessage?.content?.length ?? 0}|${conv.contextCompaction?.status ?? ''}:${conv.contextCompaction?.completedAt ?? ''}:${conv.contextCompaction?.compactedMessageCount ?? 0}`;
            if (settledHost.childElementCount > 0 && settledHost.dataset.qaapSettledCheapKey === cheapKey) {
                recordTranscriptRenderMetric('render_skip_unchanged_settled');
                this.clearTranscriptEmptyQuickActions(settledHost, conv);
                return;
            }
            const settledKey = `${conv.id} ${buildConversationTranscriptFingerprint(conv)}`;
            if (settledHost.childElementCount > 0 && settledHost.dataset.qaapSettledRenderKey === settledKey) {
                recordTranscriptRenderMetric('render_skip_unchanged_settled');
                settledHost.dataset.qaapSettledCheapKey = cheapKey;
                this.clearTranscriptEmptyQuickActions(settledHost, conv);
                return;
            }
            settledHost.dataset.qaapSettledRenderKey = settledKey;
            settledHost.dataset.qaapSettledCheapKey = cheapKey;
        } else {
            const streamingHost = this.resolveTranscriptMessageHost(host);
            if (streamingHost.dataset.qaapSettledRenderKey !== undefined) {
                delete streamingHost.dataset.qaapSettledRenderKey;
            }
            if (streamingHost.dataset.qaapSettledCheapKey !== undefined) {
                delete streamingHost.dataset.qaapSettledCheapKey;
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
        const scroll = this.resolveTranscriptScrollController(messageHost);
        const openingConversation = scroll.conversationId !== conv.id;
        if (openingConversation) {
            scroll.beginConversation(conv.id);
            scroll.markProgrammaticScroll(200);
        }
        const sameConversation = previousConversation?.id === conv.id;
        const previousLastMessageId = previousConversation?.messages.at(-1)?.id;
        const nextLastMessage = conv.messages.at(-1);
        const newTurnStarted = sameConversation
            && nextLastMessage?.role === 'user'
            && !!nextLastMessage.id
            && nextLastMessage.id !== previousLastMessageId;
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
            this.renderTranscriptMessagesVirtual(host, conv, { openingConversation, newTurnStarted });
            return;
        }
        this.host.transcriptUi.disposeList();
        messageHost.classList.remove('theia-mod-virtual-scroll');
        const shouldFollowTail = this.shouldFollowTranscriptTail(messageHost);
        const anchor = shouldFollowTail || newTurnStarted || openingConversation
            ? undefined
            : this.captureTranscriptScrollAnchor(messageHost);
        messageHost.classList.toggle('theia-mod-empty-chat', false);
        this.host.transcriptComposerHost?.classList.remove('theia-mod-show-quick-actions');
        // Build off-DOM then swap once — avoids N reflows while appending rows
        // into a connected host (visible flicker during streaming rebuilds).
        // Keyed reuse: a row whose stamped render key still matches its message
        // snapshot is MOVED into the new fragment instead of rebuilt — markdown,
        // timelines and <details> state survive untouched, so a settle/refetch
        // full render only rebuilds the tail. Stamps are dropped whenever a
        // patch path mutates a row, so a stamp always describes exactly what
        // the row currently shows.
        const reusableRows = new Map<string, HTMLElement>();
        messageHost.querySelectorAll<HTMLElement>(`:scope > [${TRANSCRIPT_MESSAGE_ID_ATTR}]`).forEach(el => {
            const key = el.dataset.qaapRowRenderKey;
            if (key && !reusableRows.has(key)) {
                reusableRows.set(key, el);
            }
        });
        // Detach the live setup/stream activity row before replaceChildren so a same-conversation
        // full rebuild can remount the same DOM (logo + phrase timers + elapsed meta) without a
        // flicker. Never reuse across conversation switches — that would leak the previous turn.
        const preservedActivityRow = !conversationSwitched
            ? this.findTranscriptStreamingActivityRow(messageHost)
            : undefined;
        preservedActivityRow?.remove();
        const normalizedForKeys = this.normalizeConversationFailuresCached(conv);
        const seamIndex = this.transcriptContextCompactionBoundaryIndex(normalizedForKeys);
        const fragment = document.createDocumentFragment();
        let reusedRowCount = 0;
        for (let index = 0; index < conv.messages.length; index++) {
            const isTail = index === conv.messages.length - 1;
            const key = isTail || index === seamIndex
                ? undefined
                : this.transcriptRowRenderKey(normalizedForKeys, index);
            const reused = key ? reusableRows.get(key) : undefined;
            if (reused && !reused.querySelector(`.${TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS}, .${TRANSCRIPT_APPROVAL_CARD_CLASS}`)) {
                reusableRows.delete(key!);
                reused.classList.remove('theia-mod-streaming', 'theia-mod-new-message');
                fragment.append(reused);
                reusedRowCount++;
                continue;
            }
            const row = this.createTranscriptMessageRowAtIndex(conv, index);
            if (key && row.hasAttribute(TRANSCRIPT_MESSAGE_ID_ATTR)) {
                row.dataset.qaapRowRenderKey = key;
            }
            fragment.append(row);
        }
        recordTranscriptRenderMetric('render_full_rows_reused', reusedRowCount);
        recordTranscriptRenderMetric('render_full_rows_rebuilt', conv.messages.length - reusedRowCount);
        messageHost.replaceChildren(fragment);
        this.host.transcriptLastRenderedConversationId = conv.id;
        this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
        const last = conv.messages[conv.messages.length - 1];
        // The completed seam is emitted inline by createTranscriptMessageRowAtIndex during the loop
        // above; only the live shimmer is appended here as a footer.
        const runningCompaction = conv.contextCompaction?.status === 'running'
            ? this.createTranscriptContextCompactionRow(conv)
            : undefined;
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming') {
            if (last?.role === 'agent') {
                messageHost.lastElementChild?.classList.add('theia-mod-streaming');
                if (runningCompaction) {
                    messageHost.append(runningCompaction);
                }
            } else {
                if (runningCompaction) {
                    messageHost.append(runningCompaction);
                }
                if (preservedActivityRow
                    && this.artifactsUi.syncTranscriptStreamingActivityRow(preservedActivityRow, conv)) {
                    preservedActivityRow.hidden = false;
                    messageHost.append(preservedActivityRow);
                } else {
                    const activityRow = this.artifactsUi.createTranscriptStreamingActivityRow(conv);
                    if (activityRow) {
                        messageHost.append(activityRow);
                    }
                }
            }
        } else if (runningCompaction) {
            messageHost.append(runningCompaction);
        }
        // replaceChildren drops the scroller-tail live-status — remount / clear via hold rules.
        this.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
        if (newTurnStarted) {
            this.scrollTranscriptToLastUserTurn(messageHost, { asPositionTurn: true });
        } else if (openingConversation && !this.hasExplicitTranscriptMessageHash()) {
            scroll.beginRestore();
            scroll.markProgrammaticScroll(200);
            if (!this.restoreTranscriptOpeningPosition(messageHost, conv)) {
                // Opening places the last user turn for reading context — ends detached.
                this.scrollTranscriptToLastUserTurn(messageHost);
            }
            scroll.completeRestore();
        } else {
            // Following after replaceChildren: pin synchronously before paint so the
            // viewport does not flash at scrollTop 0 for a frame.
            if (shouldFollowTail) {
                scroll.markProgrammaticScroll();
                messageHost.scrollTop = messageHost.scrollHeight;
            }
            this.scheduleTranscriptScrollAfterMutation(messageHost, anchor);
        }
        this.attachTranscriptScrollChrome(host, messageHost, conv);
    }

    protected attachTranscriptScrollChrome(
        host: HTMLElement,
        messageHost: HTMLElement,
        conv: QaapAgentConversationDTO,
    ): void {
        const scroll = this.resolveTranscriptScrollController(messageHost);
        if (scroll.conversationId !== undefined && scroll.conversationId !== conv.id) {
            // Switching threads always drops follow; restore path owns viewport placement.
            scroll.beginConversation(conv.id);
            scroll.completeRestore();
        } else if (scroll.conversationId === undefined) {
            scroll.bindConversationId(conv.id);
        }
        this.host.transcriptUserScrollPinDispose.dispose();
        this.host.transcriptUserScrollPinDispose = new DisposableCollection(
            attachTranscriptUserScrollPin(messageHost),
            attachTranscriptScrollIntentObserver(messageHost),
            scroll.bind(messageHost),
            attachTranscriptInlineSearch(host, messageHost),
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
        const decision = resolveStreamingTranscriptPatchDecision(this.host.transcriptLastConv, conv);
        const patchKind = decision.kind;
        if (patchKind === 'none') {
            if (isStreamingTranscriptTailUnchanged(this.host.transcriptLastConv, conv)) {
                recordTranscriptRenderMetric('render_skip_unchanged_tail');
                this.host.transcriptLastConv = conv;
                return true;
            }
            recordTranscriptRenderMetric('render_patch_none');
            recordTranscriptRenderMetric(PATCH_NONE_REASON_METRIC[decision.noneReason ?? 'tail-role-unknown']);
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
            this.applyTranscriptScrollAfterMutation(messageHost, anchor);
            return true;
        }

        if (patchKind === 'append-user') {
            // A queued user message landed mid-stream: append the new row(s)
            // instead of rebuilding the whole list. Mirrors the full-render
            // output for a user tail — prior streaming rows settle, the
            // activity row moves below the new user turn.
            recordTranscriptRenderMetric('render_patch_append');
            const prevCount = this.host.transcriptLastConv?.messages.length ?? Math.max(0, conv.messages.length - 1);
            this.removeTranscriptActivityRow(messageHost);
            messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
                if (element instanceof HTMLElement) {
                    this.contentUi.settleTranscriptStreamingContent(element);
                }
                element.classList.remove('theia-mod-streaming');
            });
            const fragment = document.createDocumentFragment();
            for (let index = prevCount; index < conv.messages.length; index++) {
                fragment.append(this.createTranscriptMessageRowAtIndex(conv, index));
            }
            messageHost.append(fragment);
            this.host.transcriptLastConv = conv;
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            this.syncTranscriptActivityRow(messageHost, conv);
            this.scrollTranscriptToLastUserTurn(messageHost, { asPositionTurn: true });
            this.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
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
                this.artifactsUi.ensureTranscriptLiveStatusForStreamingRow(existing, conv);
                this.removeTranscriptActivityRow(messageHost);
                this.host.transcriptLastConv = conv;
                this.host.transcriptLastRenderedConversationId = conv.id;
                this.host.transcriptLastRenderedMessageId = lastAgent.id;
                this.applyTranscriptScrollAfterMutation(messageHost, anchor);
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
            const existing = messageHost.querySelector<HTMLElement>(
                `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
            );
            if (existing) {
                recordTranscriptRenderMetric('render_patch_last_agent_replace');
                recordTranscriptRenderMetric(AGENT_REPLACE_REASON_METRIC[this.lastAgentPatchRejectReason ?? 'predicates']);
                existing.replaceWith(row);
            } else {
                // The row for this message id was never mounted (e.g. the
                // placeholder tick was skipped) — this is an append, not a
                // replace; keep the two apart in telemetry.
                recordTranscriptRenderMetric('render_patch_last_agent_append_missing_row');
                messageHost.append(row);
            }
        } else {
            recordTranscriptRenderMetric('render_patch_append');
            if (!shouldFollowTail) {
                row.classList.add('theia-mod-new-message');
            }
            // A coalesced tick can deliver several rows at once — append every
            // intermediate row (user or agent) before the streaming tail.
            const prevCount = this.host.transcriptLastConv?.messages.length ?? Math.max(0, conv.messages.length - 1);
            if (conv.messages.length - prevCount > 1) {
                const fragment = document.createDocumentFragment();
                for (let index = prevCount; index < conv.messages.length - 1; index++) {
                    fragment.append(this.createTranscriptMessageRowAtIndex(conv, index));
                }
                messageHost.append(fragment);
            }
            messageHost.append(row);
        }

        this.host.transcriptLastConv = conv;
        this.host.transcriptLastRenderedConversationId = conv.id;
        this.host.transcriptLastRenderedMessageId = lastAgent.id;
        // Live-status is the scroller tail — re-pin after message append/replace.
        this.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
        this.applyTranscriptScrollAfterMutation(messageHost, anchor);
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
        delete row.dataset.qaapRowRenderKey;
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
        const wasFollowingTail = this.shouldFollowTranscriptTail(messageHost);

        if (patchKind === 'activity-only') {
            recordTranscriptRenderMetric('render_patch_activity');
            recordTranscriptRenderMetric('render_patch_activity_in_place');
            this.host.transcriptLastConv = conv;
            list.setItemCount(conv.messages.length);
            list.setFooter(this.buildTranscriptVirtualFooter(conv, {
                existingActivityRow: this.findTranscriptStreamingActivityRow(messageHost),
            }));
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            if (wasFollowingTail) {
                this.scrollTranscriptFollowTail(messageHost);
            }
            return true;
        }

        if (patchKind === 'append-user') {
            recordTranscriptRenderMetric('render_patch_append');
            messageHost.querySelectorAll('.theia-mod-streaming').forEach(element => {
                element.classList.remove('theia-mod-streaming');
                if (element instanceof HTMLElement) {
                    this.contentUi.settleTranscriptStreamingContent(element);
                }
            });
            this.host.transcriptLastConv = conv;
            list.setItemCount(conv.messages.length);
            // New user turn owns a fresh activity row below the appended message.
            list.setFooter(this.buildTranscriptVirtualFooter(conv));
            this.host.transcriptLastRenderedConversationId = conv.id;
            this.host.transcriptLastRenderedMessageId = conv.messages.at(-1)?.id;
            this.scrollTranscriptToLastUserTurn(messageHost, { asPositionTurn: true });
            this.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
            return true;
        }

        const lastAgent = conv.messages[conv.messages.length - 1];
        if (!lastAgent || !lastAgent.id || lastAgent.role !== 'agent') {
            return false;
        }
        const prevLast = this.host.transcriptLastConv?.messages[this.host.transcriptLastConv.messages.length - 1];
        const segments = this.resolveTranscriptAgentSegments(conv, lastAgent);
        const existingVirtualRow = patchKind === 'last-agent'
            ? list.findRowByAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, lastAgent.id)
            : undefined;

        if (patchKind === 'last-agent') {
            if (existingVirtualRow && this.tryPatchStreamingAgentTextContent(existingVirtualRow, prevLast, lastAgent, segments, conv)) {
                recordTranscriptRenderMetric('render_patch_last_agent');
                recordTranscriptRenderMetric('render_patch_last_agent_in_place');
                this.markTranscriptMessageRow(existingVirtualRow, lastAgent.id, isTranscriptAgentTailStreaming(conv));
                this.artifactsUi.ensureTranscriptLiveStatusForStreamingRow(existingVirtualRow, conv);
                this.host.transcriptLastConv = conv;
                list.setItemCount(conv.messages.length);
                list.setFooter(this.buildTranscriptVirtualFooter(conv));
                this.host.transcriptLastRenderedConversationId = conv.id;
                this.host.transcriptLastRenderedMessageId = lastAgent.id;
                if (wasFollowingTail) {
                    this.scrollTranscriptFollowTail(messageHost);
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
            if (existingVirtualRow) {
                recordTranscriptRenderMetric('render_patch_last_agent_replace');
                recordTranscriptRenderMetric(AGENT_REPLACE_REASON_METRIC[this.lastAgentPatchRejectReason ?? 'predicates']);
            } else {
                recordTranscriptRenderMetric('render_patch_last_agent_append_missing_row');
            }
            list.replaceRowByAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, lastAgent.id, row);
        } else {
            recordTranscriptRenderMetric('render_patch_append');
        }
        list.setItemCount(conv.messages.length);
        list.setFooter(this.buildTranscriptVirtualFooter(conv));
        this.host.transcriptLastRenderedConversationId = conv.id;
        this.host.transcriptLastRenderedMessageId = lastAgent.id;
        if (wasFollowingTail) {
            this.scrollTranscriptFollowTail(messageHost);
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
        // The row was just patched/replaced by a streaming path — its full-build
        // render key no longer describes its DOM; drop it so the next full
        // render rebuilds this row instead of reusing it.
        delete row.dataset.qaapRowRenderKey;
    }

    /** Why the last in-place patch attempt failed — read by the replace-site telemetry. */
    protected lastAgentPatchRejectReason: TranscriptAgentPatchRejectReason | undefined;

    tryPatchStreamingAgentTextContent(
        existingRow: HTMLElement,
        prevMsg: QaapAgentMessageDTO | undefined,
        nextMsg: QaapAgentMessageDTO,
        resolvedSegments: QaapAgentMessageSegmentDTO[] | undefined,
        conv?: QaapAgentConversationDTO,
    ): boolean {
        this.lastAgentPatchRejectReason = undefined;
        const prevComparable = prevMsg ? this.withDerivedTranscriptSegments(prevMsg) : undefined;
        const nextComparable = this.withDerivedTranscriptSegments(nextMsg);
        if (canStreamPatchStdoutAgentContentOnly(prevComparable, nextComparable)) {
            const contentEl = existingRow.querySelector<HTMLElement>('.theia-mobile-agent-transcript-content');
            if (!contentEl) {
                this.lastAgentPatchRejectReason = 'applier';
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
            if (hasMobileExecutionEventTimeline(existingRow)) {
                const nextOnly = nextComparable?.segments ?? resolvedSegments ?? [];
                this.artifactsUi.patchStreamingActivityTimeline(existingRow, nextOnly, conv);
                recordTranscriptRenderMetric('render_patch_last_agent_timeline_fallback');
                return true;
            }
            this.lastAgentPatchRejectReason = 'no_prev';
            return false;
        }
        const nextSegments = nextComparable.segments ?? [];
        const prevSegments = prevComparable.segments ?? [];
        const segmentsInPlace = canStreamPatchAgentSegmentsInPlace(prevComparable, nextComparable);
        const appendTool = canStreamPatchAgentAppendToolSegment(prevComparable, nextComparable);
        const appendText = canStreamPatchAgentAppendTextSegment(prevComparable, nextComparable);
        const appendThinking = canStreamPatchAgentAppendThinkingSegment(prevComparable, nextComparable);
        // Combined tick: the shared prefix changed patchably AND one segment was
        // appended in the same coalesced frame (tool finishing + next block
        // starting). Patch the prefix in place, then append the tail.
        const inPlaceWithAppend = !segmentsInPlace && !appendTool && !appendText && !appendThinking
            && canStreamPatchAgentSegmentsInPlaceWithAppend(prevComparable, nextComparable);
        const tryTimelineFallback = (): boolean => {
            if (!hasMobileExecutionEventTimeline(existingRow)) {
                return false;
            }
            this.artifactsUi.patchStreamingActivityTimeline(existingRow, nextSegments, conv);
            recordTranscriptRenderMetric('render_patch_last_agent_timeline_fallback');
            return true;
        };
        if (!segmentsInPlace && !appendTool && !appendText && !appendThinking && !inPlaceWithAppend) {
            // Prefer refreshing the Codex timeline in place over remounting the
            // whole agent row (that remount restarts shimmer/spin and flashes).
            this.lastAgentPatchRejectReason = 'predicates';
            return tryTimelineFallback();
        }
        // The DOM patchers iterate index-aligned prev/next pairs, so the
        // combined tick hands them the equal-length shared prefix only — the
        // appended tail is handled by the append helpers below.
        const nextShared = inPlaceWithAppend ? nextSegments.slice(0, prevSegments.length) : nextSegments;
        if (segmentsInPlace || inPlaceWithAppend) {
            if (resolvedSegments?.length) {
                if (!this.artifactsUi.patchStreamingAgentTextSegments(existingRow, prevSegments, nextShared, conv)) {
                    this.lastAgentPatchRejectReason = 'applier';
                    return tryTimelineFallback();
                }
            } else {
                const contentEl = existingRow.querySelector<HTMLElement>('.theia-mobile-agent-transcript-content');
                const lastText = [...nextShared].reverse().find(segment => segment.type === 'text');
                if (contentEl && lastText?.type === 'text') {
                    this.toolUi.renderTranscriptRichContent(
                        contentEl,
                        lastText.content ?? '',
                        { streaming: existingRow.classList.contains('theia-mod-streaming') },
                    );
                }
            }
            if (prevSegments.length === nextShared.length) {
                if (!this.artifactsUi.patchStreamingAgentToolSegments(existingRow, prevSegments, nextShared, conv)) {
                    if (existingRow.classList.contains('theia-mod-streaming')) {
                        this.artifactsUi.patchStreamingActivityTimeline(existingRow, nextSegments, conv);
                    } else if (!tryTimelineFallback()) {
                        this.lastAgentPatchRejectReason = 'applier';
                        return false;
                    }
                }
            }
        }
        const appendedTailType = inPlaceWithAppend ? nextSegments[nextSegments.length - 1]?.type : undefined;
        if (appendTool || appendedTailType === 'tool') {
            if (!this.artifactsUi.appendStreamingAgentToolSegment(existingRow, nextSegments, conv)) {
                this.lastAgentPatchRejectReason = 'applier';
                return tryTimelineFallback();
            }
        }
        if (appendThinking || appendedTailType === 'thinking') {
            // Thinking has no dedicated DOM append path; keep the Codex timeline
            // (or fall through to replace when tools have not mounted yet).
            if (!tryTimelineFallback()) {
                this.lastAgentPatchRejectReason = 'thinking';
                return false;
            }
        } else if (appendText || appendedTailType === 'text') {
            if (!this.artifactsUi.appendStreamingAgentTextSegment(existingRow, nextSegments, conv)) {
                this.lastAgentPatchRejectReason = 'applier';
                return tryTimelineFallback();
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
                existingActivityRow.hidden = false;
                recordTranscriptRenderMetric('render_patch_activity_in_place');
                return;
            }
            this.removeTranscriptActivityRow(messageHost);
            recordTranscriptRenderMetric('render_patch_activity_replace');
            const activityRow = this.artifactsUi.createTranscriptStreamingActivityRow(conv);
            if (activityRow) {
                messageHost.append(activityRow);
                this.artifactsUi.ensurePinnedTranscriptLiveStatus(conv);
            }
            return;
        }
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming' && existingActivityRow) {
            this.ensureLiveStatusBeforeRemovingActivityRow(messageHost, conv);
        }
        this.removeTranscriptActivityRow(messageHost);
    }

    /** Mount live footer on the streaming agent row before tearing down the setup activity row. */
    protected ensureLiveStatusBeforeRemovingActivityRow(
        messageHost: HTMLElement,
        conv: QaapAgentConversationDTO,
    ): void {
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!lastAgent?.id) {
            return;
        }
        const agentRow = messageHost.querySelector<HTMLElement>(
            `[${TRANSCRIPT_MESSAGE_ID_ATTR}="${CSS.escape(lastAgent.id)}"]`,
        );
        if (agentRow) {
            this.artifactsUi.ensureTranscriptLiveStatusForStreamingRow(agentRow, conv);
        }
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
