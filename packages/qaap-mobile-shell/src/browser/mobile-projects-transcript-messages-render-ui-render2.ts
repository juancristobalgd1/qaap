// @ts-nocheck
// Extracted from mobile-projects-transcript-messages-render-ui.ts

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { normalizeAgentMessageContentForDisplay } from '../common/qaap-agent-message-content';
import { parseAgentLogForTranscript } from '../common/qaap-cli-transcript-stream';
import { dedupeAgentMessageTextSegments } from '../common/qaap-qaiq-stream';
import { resolveQaapTranscriptTrace, segmentsToTraceEvents, traceEventsToSegments, type QaapTranscriptTrace } from '../common/qaap-transcript-trace-model';
import { agentMessageHasStructuredTrace } from '../common/qaap-transcript-trace-lifecycle';
import { buildConversationTranscriptFingerprint, fingerprintTranscriptMessage, isStreamingTranscriptTailUnchanged, resolveStreamingTranscriptPatchDecision, resolveStreamingTranscriptPatchKind, TRANSCRIPT_ACTIVITY_ROW_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, canStreamPatchAgentAppendTextSegment, canStreamPatchAgentAppendThinkingSegment, canStreamPatchAgentAppendToolSegment, canStreamPatchAgentSegmentsInPlace, canStreamPatchAgentSegmentsInPlaceWithAppend, canStreamPatchStdoutAgentContentOnly, type QaapTranscriptStreamingPatchNoneReason } from '../common/qaap-transcript-incremental-update';
import { TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS } from './qaap-transcript-inline-approval-ui';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { hasMobileExecutionEventTimeline, syncTranscriptStandaloneTurnProvenance } from './qaap-execution-event-timeline';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import {
    isTranscriptAgentTailStreaming,
    resolveTranscriptEffectiveStatus,
    shouldShowTranscriptEmptyQuickActions,
} from '../common/qaap-transcript-turn-status';
import {
    appendBeforeTranscriptLiveStatus,
    detachTranscriptLiveStatusFromScroller,
} from '../common/qaap-transcript-live-status';
import { recordTranscriptRenderMetric, type QaapTranscriptRenderMetricKind } from '../common/qaap-transcript-render-metrics';
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

export function resolveTranscriptMessageHostExtracted(ctx: any, host: HTMLElement): HTMLElement {
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

export function resolveTranscriptAgentSegmentsExtracted(ctx: any, conv: QaapAgentConversationDTO,
        msg: QaapAgentMessageDTO,): QaapAgentMessageSegmentDTO[] | undefined {
        ctx.syncTranscriptAgentSegmentsCache(conv.id);
        const cacheKey = ctx.transcriptAgentSegmentsCacheKey(conv, msg);
        const cached = ctx.transcriptAgentSegmentsCache.get(cacheKey);
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
            ctx.setTranscriptAgentSegmentsCacheEntry(conv, msg, cacheKey, segments);
            return [...segments];
        }
        ctx.setTranscriptAgentSegmentsCacheEntry(conv, msg, cacheKey, []);
        return undefined;
}

export function syncTranscriptAgentSegmentsCacheExtracted(ctx: any, conversationId: string): void {
        if (ctx.transcriptAgentSegmentsCacheConversationId === conversationId && ctx.transcriptAgentSegmentsCache.size < 1_000) {
            return;
        }
        ctx.transcriptAgentSegmentsCacheConversationId = conversationId;
        ctx.transcriptAgentSegmentsCache.clear();
        ctx.transcriptAgentSegmentsCacheKeyByMessage.clear();
}

export function setTranscriptAgentSegmentsCacheEntryExtracted(ctx: any, conv: QaapAgentConversationDTO,
        msg: QaapAgentMessageDTO,
        cacheKey: string,
        segments: readonly QaapAgentMessageSegmentDTO[],): void {
        const messageKey = `${conv.id}|${msg.id ?? ''}`;
        const previousKey = ctx.transcriptAgentSegmentsCacheKeyByMessage.get(messageKey);
        if (previousKey !== undefined && previousKey !== cacheKey) {
            ctx.transcriptAgentSegmentsCache.delete(previousKey);
        }
        ctx.transcriptAgentSegmentsCacheKeyByMessage.set(messageKey, cacheKey);
        ctx.transcriptAgentSegmentsCache.set(cacheKey, segments);
}

export function transcriptAgentSegmentsCacheKeyExtracted(ctx: any, conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO): string {
        return [
            conv.id,
            msg.id ?? '',
            msg.role,
            ctx.transcriptTextSignature(msg.content),
            msg.error?.length ?? 0,
            msg.traceEvents?.length ?? 0,
            ctx.transcriptSegmentsSignature(msg.segments),
        ].join('|');
}

export function transcriptTextSignatureExtracted(ctx: any, text: string | undefined): string {
        if (!text) {
            return '0';
        }
        return `${text.length}:${text.slice(0, 32)}:${text.slice(-32)}`;
}

export function transcriptSegmentsSignatureExtracted(ctx: any, segments: readonly QaapAgentMessageSegmentDTO[] | undefined): string {
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
                ctx.transcriptTextSignature(last.args),
                ctx.transcriptTextSignature(last.result),
            ].join(':');
        }
        return [
            segments.length,
            last.type,
            ctx.transcriptTextSignature(last.content),
        ].join(':');
}

export function withDerivedTranscriptSegmentsExtracted(ctx: any, msg: QaapAgentMessageDTO): QaapAgentMessageDTO {
        if (!msg.traceEvents?.length) {
            return msg;
        }
        const segments = dedupeAgentMessageTextSegments(traceEventsToSegments(msg.traceEvents));
        return segments.length ? { ...msg, segments } : msg;
}

export function normalizeConversationFailuresCachedExtracted(ctx: any, conv: QaapAgentConversationDTO): QaapAgentConversationDTO {
        let normalized = ctx.normalizedFailuresCache.get(conv);
        if (!normalized) {
            normalized = normalizeAgentConversationFailures(conv);
            ctx.normalizedFailuresCache.set(conv, normalized);
        }
        return normalized;
}

export function transcriptRowRenderKeyExtracted(ctx: any, conv: QaapAgentConversationDTO, index: number): string | undefined {
        const msg = conv.messages[index];
        if (!msg?.id || msg.error?.trim()) {
            return undefined;
        }
        return `${conv.id}|${msg.role}|${fingerprintTranscriptMessage(msg)}`;
}

export function createTranscriptMessageRowAtIndexExtracted(ctx: any, conv: QaapAgentConversationDTO, index: number): HTMLElement {
        const normalized = ctx.normalizeConversationFailuresCached(conv);
        const msg = normalized.messages[index];
        const sameConversation = ctx.host.transcriptLastRenderedConversationId === normalized.id;
        const previousLastMessageId = ctx.host.transcriptLastRenderedMessageId;
        const deferHeavyContent = shouldDeferTranscriptRowHeavyContent({
            messageIndex: index,
            messageCount: normalized.messages.length,
            conversationStreaming: resolveTranscriptEffectiveStatus(normalized) === 'streaming',
        });
        const streamingTail = index === normalized.messages.length - 1
            && msg.role === 'agent'
            && isTranscriptAgentTailStreaming(normalized);
        let row: HTMLElement;
        const agentSegments = ctx.resolveTranscriptAgentSegments(normalized, msg);
        if (msg.role === 'user') {
            row = ctx.userUi.createTranscriptUserMessageRow(msg, normalized, { deferHeavyContent });
        } else if (agentSegments && agentSegments.length > 0) {
            row = ctx.artifactsUi.createTranscriptAgentSegmentsRow(agentSegments, msg.error, normalized, {
                deferHeavyContent,
                streaming: streamingTail,
                message: msg,
            });
            if (msg.id) {
                row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, msg.id);
            }
        } else if (msg.role === 'agent' && msg.error?.trim()) {
            row = ctx.createTranscriptAgentFailureRow(msg, normalized, { deferHeavyContent });
            if (msg.id) {
                row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, msg.id);
            }
        } else {
            row = ctx.createTranscriptMessageRow(
                msg.role,
                normalizeAgentMessageContentForDisplay(msg.content),
                undefined,
                { deferHeavyContent, streaming: streamingTail, conv: normalized, message: msg },
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
        if (ctx.transcriptContextCompactionBoundaryIndex(normalized) === index) {
            const seam = ctx.createTranscriptContextCompactionRow(normalized);
            if (seam) {
                const wrap = document.createElement('div');
                wrap.className = 'theia-mobile-agent-transcript-compaction-seam';
                wrap.append(seam, row);
                return wrap;
            }
        }
        return row;
}

export function transcriptContextCompactionBoundaryIndexExtracted(ctx: any, conv: QaapAgentConversationDTO): number | undefined {
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

export function buildTranscriptVirtualFooterExtracted(ctx: any, conv: QaapAgentConversationDTO,
        options?: { readonly existingActivityRow?: HTMLElement | null },): HTMLElement[] {
        const footers: HTMLElement[] = [];
        // Only the live shimmer belongs in the footer; the completed seam is rendered inline at the
        // compaction boundary (see createTranscriptMessageRowAtIndex).
        if (conv.contextCompaction?.status === 'running') {
            const contextCompaction = ctx.createTranscriptContextCompactionRow(conv);
            if (contextCompaction) {
                footers.push(contextCompaction);
            }
        }
        if (resolveTranscriptEffectiveStatus(conv) === 'streaming' && conv.messages.at(-1)?.role === 'user') {
            const existing = options?.existingActivityRow ?? undefined;
            // Reuse the mounted setup/stream row across activity-only footer refreshes.
            // Recreating it (replaceChildren) unmounts `.qaap-agent-setup` and causes a visible
            // hide→show flicker of the logo + shimmer phrase + elapsed meta while the agent works.
            if (existing && ctx.artifactsUi.syncTranscriptStreamingActivityRow(existing, conv)) {
                existing.hidden = false;
                footers.push(existing);
            } else {
                const row = ctx.artifactsUi.createTranscriptStreamingActivityRow(conv);
                if (row) {
                    footers.push(row);
                }
            }
        }
        return footers;
}

export function createTranscriptContextCompactionRowExtracted(ctx: any, conv: QaapAgentConversationDTO): HTMLElement | undefined {
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

export function shouldFollowTranscriptTailExtracted(ctx: any, scroller: HTMLElement): boolean {
        const scroll = ctx.resolveTranscriptScrollController(scroller);
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

export function restoreTranscriptScrollAnchorExtracted(ctx: any, scroller: HTMLElement,
        anchor: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        ctx.resolveTranscriptScrollController(scroller).restoreAnchor(scroller, anchor);
}

export function applyTranscriptScrollAfterMutationExtracted(ctx: any, messageHost: HTMLElement,
        anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        if (ctx.shouldFollowTranscriptTail(messageHost)) {
            ctx.scrollTranscriptFollowTail(messageHost);
        } else if (anchor) {
            ctx.resolveTranscriptScrollController(messageHost).schedulePreserveAnchor(messageHost, anchor);
        }
}

export function scheduleTranscriptScrollAfterMutationExtracted(ctx: any, messageHost: HTMLElement,
        anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
        if (ctx.shouldFollowTranscriptTail(messageHost)) {
            ctx.scrollTranscriptFollowTail(messageHost);
            return;
        }
        if (!anchor) {
            return;
        }
        ctx.resolveTranscriptScrollController(messageHost).schedulePreserveAnchor(messageHost, anchor);
}

export function scrollTranscriptTurnStartIntoReadingPositionExtracted(ctx: any, messageHost: HTMLElement, row: HTMLElement): void {
        const scroll = ctx.resolveTranscriptScrollController(messageHost);
        if (scroll.phase === 'positioning-turn') {
            scroll.positionTurnStart(messageHost, row);
            return;
        }
        scroll.placeReadingPosition(messageHost, row);
}

export function findLastUserMessageIndexExtracted(ctx: any, conv: QaapAgentConversationDTO): number {
        for (let index = conv.messages.length - 1; index >= 0; index--) {
            if (conv.messages[index]?.role === 'user') {
                return index;
            }
        }
        return -1;
}

export function findAppendedUserMessageIndexExtracted(ctx: any, previous: QaapAgentConversationDTO | undefined,
        next: QaapAgentConversationDTO,): number {
        if (!previous || previous.id !== next.id || next.messages.length <= previous.messages.length) {
            return -1;
        }
        for (let index = next.messages.length - 1; index >= previous.messages.length; index--) {
            if (next.messages[index]?.role === 'user') {
                return index;
            }
        }
        return -1;
}

export function positionTranscriptVirtualListAtUserTurnExtracted(ctx: any, messageHost: HTMLElement,
        list: { scrollToIndex?: (index: number, contextPx?: number) => void },
        userIndex: number,): void {
        if (userIndex < 0) {
            return;
        }
        const scroll = ctx.resolveTranscriptScrollController(messageHost);
        // Already following, or the reader was sitting on the live edge as this turn
        // arrived: follow the stream instead of yanking up to the process header.
        if (scroll.shouldFollowTail() || scroll.adoptFollowingFromLiveEdge()) {
            ctx.scrollTranscriptFollowTail(messageHost);
            return;
        }
        scroll.beginPositionTurn();
        scroll.markProgrammaticScroll();
        const contextPx = Math.min(96, Math.max(40, Math.round(messageHost.clientHeight * 0.14)));
        ctx.scrollTranscriptVirtualListToIndex(list, userIndex, contextPx);
        scroll.completePositionTurn();
}

export function scrollTranscriptVirtualListToIndexExtracted(ctx: any, list: { scrollToIndex?: (index: number, contextPx?: number) => void },
        index: number,
        contextPx: number,): void {
        list.scrollToIndex?.(index, contextPx);
}

export function restoreTranscriptOpeningPositionVirtualExtracted(ctx: any, list: { scrollToIndex?: (index: number, contextPx?: number) => void },
        conv: QaapAgentConversationDTO,
        contextPx: number,): boolean {
        const storedIndex = resolveStoredTranscriptReadMessageIndex(conv.id, conv.messages);
        if (storedIndex !== undefined) {
            ctx.scrollTranscriptVirtualListToIndex(list, storedIndex, contextPx);
            return true;
        }
        return false;
}

