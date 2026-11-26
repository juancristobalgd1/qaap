import type { MobileProjectsTranscriptMessagesRenderUiContext } from './mobile-projects-transcript-messages-render-ui-context';
import type { MobileProjectsTranscriptMessagesRenderUi } from './mobile-projects-transcript-messages-render-ui';
// Extracted from mobile-projects-transcript-messages-render-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import type { QaapQueuedPendingUserMessage } from '@theia/qaap-shared-core/lib/common/qaap-pending-user-messages-merge';
import { createMobileVisualRepairProposalElement } from './mobile-visual-repair-proposal';
import { isVisualRepairInstructionMessage, resolveVisualRepairProposalMessage } from '../common/qaap-visual-repair-proposal';
import { normalizeAgentMessageContentForDisplay, resolveTranscriptUserMessageView } from '@theia/qaap-shared-core/lib/common/qaap-agent-message-content';
import { isSuccessfulAgentMessageInConversation } from '@theia/qaap-shared-core/lib/common/qaap-agent-turn-outcome';
import { parseAgentLogForTranscript } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';
import { dedupeAgentMessageTextSegments } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-stream';
import { resolveQaapTranscriptTrace, segmentsToTraceEvents, traceEventsToSegments, type QaapTranscriptTrace } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import { fingerprintTranscriptMessage, TRANSCRIPT_MESSAGE_ID_ATTR } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-incremental-update';
import {
    isTranscriptAgentTailStreaming,
    resolveTranscriptEffectiveStatus,
} from '@theia/qaap-shared-core/lib/common/qaap-transcript-turn-status';
import {
    transcriptHasObservedSelection,
    transcriptHasInteractiveFocus,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-scroll-intent';
import {
    resolveStoredTranscriptReadMessageIndex,
} from './qaap-transcript-read-position';
import {
    shouldDeferTranscriptRowHeavyContent,
} from './qaap-transcript-row-defer';
import { normalizeAgentConversationFailures, type QaapAgentConversationDTO, type QaapAgentMessageDTO, type QaapAgentMessageSegmentDTO} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { createMobileTurnClosingReportElement, parseMobileTurnClosingReport } from './mobile-turn-closing-report';
import {
    resolveTranscriptComposerHarnessSelection,
    resolveTranscriptHarnessSwitchAt,
    resolveTranscriptPendingHarnessSwitchRow,
    wrapTranscriptRowWithHarnessSwitch,
} from './qaap-transcript-harness-switch-row';
import { findQaapClosingReport } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import { withoutSideChatPreamble } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-side-chat';

export function resolveTranscriptMessageHostExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, host: HTMLElement): HTMLElement {
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

export function resolveTranscriptAgentSegmentsExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO,
    msg: QaapAgentMessageDTO,): QaapAgentMessageSegmentDTO[] | undefined {
    ctx.syncTranscriptAgentSegmentsCache(conv.id);
    const cacheKey = ctx.transcriptAgentSegmentsCacheKey(conv, msg);
    const cached = ctx.transcriptAgentSegmentsCache.get(cacheKey);
    if (cached) {
        return cached.length ? [...cached] : undefined;
    }
    let trace: QaapTranscriptTrace = resolveQaapTranscriptTrace(msg);
    const hasNonCheckpointTrace = (msg.traceEvents ?? []).some(event => event.type !== 'checkpoint');
    if (
        trace.segments.length === 0
        && !hasNonCheckpointTrace
        && msg.role === 'agent'
        && msg.content?.trim()
    ) {
        const turnAgentId = (msg.runUserMessageId
            ? conv.messages.find(candidate => candidate.id === msg.runUserMessageId)?.turnAgentId
            : undefined) ?? conv.agentId;
        const parsed = parseAgentLogForTranscript(turnAgentId, msg.content);
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

export function syncTranscriptAgentSegmentsCacheExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conversationId: string): void {
    if (ctx.transcriptAgentSegmentsCacheConversationId === conversationId && ctx.transcriptAgentSegmentsCache.size < 1_000) {
        return;
    }
    ctx.transcriptAgentSegmentsCacheConversationId = conversationId;
    ctx.transcriptAgentSegmentsCache.clear();
    ctx.transcriptAgentSegmentsCacheKeyByMessage.clear();
}

export function setTranscriptAgentSegmentsCacheEntryExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO,
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

export function transcriptAgentSegmentsCacheKeyExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO, msg: QaapAgentMessageDTO): string {
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

export function transcriptTextSignatureExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, text: string | undefined): string {
    if (!text) {
        return '0';
    }
    return `${text.length}:${text.slice(0, 32)}:${text.slice(-32)}`;
}

export function transcriptSegmentsSignatureExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, segments: readonly QaapAgentMessageSegmentDTO[] | undefined): string {
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

export function withDerivedTranscriptSegmentsExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, msg: QaapAgentMessageDTO): QaapAgentMessageDTO {
    if (!msg.traceEvents?.length) {
        return msg;
    }
    const segments = dedupeAgentMessageTextSegments(traceEventsToSegments(msg.traceEvents));
    return segments.length ? { ...msg, segments } : msg;
}

export function normalizeConversationFailuresCachedExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO): QaapAgentConversationDTO {
    let normalized = ctx.normalizedFailuresCache.get(conv);
    if (!normalized) {
        normalized = normalizeAgentConversationFailures(conv);
        ctx.normalizedFailuresCache.set(conv, normalized);
    }
    return normalized;
}

export function transcriptRowRenderKeyExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO, index: number): string | undefined {
    const msg = conv.messages[index];
    if (!msg?.id || msg.error?.trim()) {
        return undefined;
    }
    return `${conv.id}|${msg.role}|${fingerprintTranscriptMessage(msg)}`;
}

export function createTranscriptMessageRowAtIndexExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO, index: number): HTMLElement {
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
    // A turn that succeeded keeps no failure, whatever error it still stores (a stale classification):
    // no failure card, no failure reason. A failed turn keeps its error.
    const turnSucceeded = msg.role === 'agent' && !!msg.error?.trim() && isSuccessfulAgentMessageInConversation(normalized.messages, msg);
    const displayMsg = turnSucceeded ? { ...msg, error: undefined } : msg;
    const agentSegments = ctx.resolveTranscriptAgentSegments(normalized, msg);
    if (isVisualRepairInstructionMessage(msg)) {
        // The repair instruction the backend wrote for an accepted proposal: kept in the list for
        // index stability, never drawn as a user bubble.
        row = document.createElement('div');
        row.className = 'theia-mobile-visual-repair-instruction';
        row.hidden = true;
    } else if (msg.role === 'user') {
        row = ctx.userUi.createTranscriptUserMessageRow(withoutSideChatPreamble(msg), normalized, { deferHeavyContent });
    } else if (agentSegments && agentSegments.length > 0) {
        row = ctx.artifactsUi.createTranscriptAgentSegmentsRow(agentSegments, displayMsg.error, normalized, {
            deferHeavyContent,
            streaming: streamingTail,
            message: displayMsg,
        });
        if (msg.id) {
            row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, msg.id);
        }
    } else if (msg.role === 'agent' && displayMsg.error?.trim()) {
        row = ctx.createTranscriptAgentFailureRow(displayMsg, normalized, { deferHeavyContent });
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
        // A text-only turn still surfaces blocked/warning closing reports; clean "done" turns stay quiet.
        const closingReport = msg.role === 'agent' && !streamingTail ? findQaapClosingReport(msg) : undefined;
        if (closingReport && parseMobileTurnClosingReport(closingReport).tone !== 'done') {
            row.append(createMobileTurnClosingReportElement(closingReport));
        }
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
    // The turn ran on another harness than the previous one: a centred divider sits right above it.
    const harnessSwitch = msg.role === 'user' ? resolveTranscriptHarnessSwitchAt(normalized, index) : undefined;
    if (harnessSwitch) {
        row = wrapTranscriptRowWithHarnessSwitch(row, harnessSwitch);
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

export function transcriptContextCompactionBoundaryIndexExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO): number | undefined {
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

export function buildTranscriptVirtualFooterExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO,
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
    // Queued user messages (delivery mode 'queue') paint as dashed bubbles at the tail, after the
    // last turn; their Send now / Edit / Remove actions are routed to the composer queue.
    footers.push(...createTranscriptQueuedMessageRowsExtracted(ctx, conv));
    const repairProposal = resolveVisualRepairProposalMessage(conv);
    const repairProposalRow = repairProposal ? createMobileVisualRepairProposalElement(conv, repairProposal) : undefined;
    if (repairProposalRow) {
        footers.push(repairProposalRow);
    }
    // The composer has another harness selected for the next turn: "Handoff pending" closes the list.
    const pendingHarnessSwitch = resolveTranscriptPendingHarnessSwitchRow(
        conv,
        resolveTranscriptComposerHarnessSelection(ctx.host, conv.id),
    );
    if (pendingHarnessSwitch) {
        footers.push(pendingHarnessSwitch);
    }
    return footers;
}

/**
 * Queued messages already painted in this session. A row is painted with its entrance animation
 * only the first time it appears; later re-renders of the transcript keep the static row.
 */
const paintedQueuedMessageIds = new Set<string>();

/** Matches the leave animation in the transcript stylesheet; the row is removed after it. */
const QUEUED_MESSAGE_LEAVE_MS = 180;

/**
 * A queued message at the transcript tail: a dashed user bubble (attachments and text) held back
 * from the turn, with Send now / Edit / Remove below it. The actions belong to the composer's
 * queue, so the row only reports which one was picked (`queuedMessageAction`).
 */
function createTranscriptQueuedMessageRow(
    ctx: MobileProjectsTranscriptMessagesRenderUiContext,
    conv: QaapAgentConversationDTO,
    pending: QaapQueuedPendingUserMessage,
): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'theia-mobile-agent-transcript-queued-message';
    wrap.dataset.queuedMessageId = pending.id;
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', nls.localize('qaap/mobileProjects/queuedMessageAriaLabel', 'Queued message'));
    if (!paintedQueuedMessageIds.has(pending.id)) {
        paintedQueuedMessageIds.add(pending.id);
        wrap.classList.add('theia-mod-entering');
    }

    const bubble = document.createElement('div');
    bubble.className = 'theia-mobile-agent-transcript-msg theia-mod-user theia-mod-queued';
    const previews = pending.optimisticImagePreviews ?? [];
    if (previews.length) {
        bubble.append(ctx.userUi.createTranscriptUserImagePreviews(previews));
    }
    // Same view as a sent user row: attachment preambles (preview feedback, files) become a
    // collapsed chip instead of their raw outbound payload (selectors, URLs, positions).
    const view = resolveTranscriptUserMessageView({ role: 'user', content: pending.content });
    if (view.contextChips.length) {
        bubble.append(ctx.userUi.createTranscriptUserContextChips(view.contextChips, { collapsed: true }));
    }
    if (view.displayText.trim()) {
        const contentEl = document.createElement('div');
        contentEl.className = 'theia-mobile-agent-transcript-content';
        contentEl.textContent = view.displayText;
        bubble.append(contentEl);
    }
    wrap.append(bubble);

    const actions = document.createElement('div');
    actions.className = 'theia-mobile-agent-transcript-queued-actions';
    if (conv.pendingUserMessagesPaused) {
        // A Stop paused the queue: say why nothing is sending, and what the user can do about it.
        wrap.classList.add('theia-mod-paused');
        const pausedHint = document.createElement('span');
        pausedHint.className = 'theia-mobile-agent-transcript-queued-paused-hint';
        pausedHint.textContent = nls.localize('qaap/mobileProjects/queuedPausedHint', 'Paused — send or discard');
        actions.append(pausedHint);
    }
    actions.append(
        createTranscriptQueuedAction({
            className: 'theia-mod-send-now',
            icon: 'codicon-arrow-up',
            label: nls.localize('qaap/mobileProjects/sendNow', 'Send now'),
            text: nls.localize('qaap/mobileProjects/sendNow', 'Send now'),
            title: nls.localize('qaap/mobileProjects/sendNowTitle', 'Send this message now as a parallel run'),
            onClick: () => void ctx.queuedMessageAction(conv.id, pending, 'send'),
        }),
        createTranscriptQueuedAction({
            className: 'theia-mod-edit',
            icon: 'codicon-edit',
            label: nls.localize('qaap/mobileProjects/queuedEdit', 'Edit queued message'),
            onClick: () => void ctx.queuedMessageAction(conv.id, pending, 'edit'),
        }),
        createTranscriptQueuedAction({
            className: 'theia-mod-remove',
            icon: 'codicon-close',
            label: nls.localize('qaap/mobileProjects/queuedRemove', 'Remove from queue'),
            onClick: () => {
                wrap.classList.add('theia-mod-leaving');
                window.setTimeout(() => void ctx.queuedMessageAction(conv.id, pending, 'remove'), QUEUED_MESSAGE_LEAVE_MS);
            },
        }),
    );
    wrap.append(actions);

    return wrap;
}

function createTranscriptQueuedAction(options: {
    readonly className: string;
    readonly icon: string;
    readonly label: string;
    readonly title?: string;
    /** Visible text next to the icon; omitted for icon-only actions. */
    readonly text?: string;
    readonly onClick: () => void;
}): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `theia-mobile-agent-transcript-queued-action ${options.className}`;
    button.title = options.title ?? options.label;
    button.setAttribute('aria-label', options.label);
    const icon = document.createElement('span');
    icon.className = `codicon ${options.icon} theia-mobile-agent-transcript-queued-action-icon`;
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    if (options.text) {
        const text = document.createElement('span');
        text.textContent = options.text;
        button.append(text);
    }
    button.addEventListener('click', () => options.onClick());
    return button;
}

/**
 * The queued rows of a conversation, one per pending message, in queue order. Shared by the
 * virtual footer and the plain render path so both paint the same rows.
 */
export function createTranscriptQueuedMessageRowsExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO): HTMLElement[] {
    // A queued message that already shows as a real transcript message (matched by clientMessageId)
    // is being dispatched: drop its dashed row in the same render that paints the real one.
    const sentIds = new Set<string>();
    for (const message of conv.messages ?? []) {
        if (message.role === 'user') {
            sentIds.add(message.id);
            if (message.clientMessageId) {
                sentIds.add(message.clientMessageId);
            }
        }
    }
    const pendingMessages = ((conv.pendingUserMessages ?? []) as readonly QaapQueuedPendingUserMessage[])
        .filter(pending => !sentIds.has(pending.clientMessageId ?? pending.id) && !sentIds.has(pending.id));
    // Forget messages that left the queue, so a re-queued message animates in again.
    const currentIds = new Set(pendingMessages.map(pending => pending.id));
    for (const id of paintedQueuedMessageIds) {
        if (!currentIds.has(id)) {
            paintedQueuedMessageIds.delete(id);
        }
    }
    return pendingMessages.map(pending => createTranscriptQueuedMessageRow(ctx, conv, pending));
}
export function createTranscriptContextCompactionRowExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO): HTMLElement | undefined {
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

export function shouldFollowTranscriptTailExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, scroller: HTMLElement): boolean {
    const scroll = ctx.resolveTranscriptScrollController(scroller);
    // Explicit live-edge opt-in (Jump to latest) wins over stale selection/focus.
    if (scroll.shouldFollowTail()) {
        return true;
    }
    // Runs on every streaming patch, right after a DOM mutation: the observed (event-kept)
    // selection avoids the forced synchronous layout a live selection read costs.
    if (transcriptHasObservedSelection(scroller) || transcriptHasInteractiveFocus(scroller)) {
        scroll.notifyUserDetach('interaction');
        return false;
    }
    return false;
}

export function restoreTranscriptScrollAnchorExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, scroller: HTMLElement,
    anchor: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
    ctx.resolveTranscriptScrollController(scroller).restoreAnchor(scroller, anchor);
}

export function applyTranscriptScrollAfterMutationExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, messageHost: HTMLElement,
    anchor?: ReturnType<MobileProjectsTranscriptMessagesRenderUi['captureTranscriptScrollAnchor']>,): void {
    if (ctx.shouldFollowTranscriptTail(messageHost)) {
        ctx.scrollTranscriptFollowTail(messageHost);
    } else if (anchor) {
        ctx.resolveTranscriptScrollController(messageHost).schedulePreserveAnchor(messageHost, anchor);
    }
}

export function scheduleTranscriptScrollAfterMutationExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, messageHost: HTMLElement,
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

export function scrollTranscriptTurnStartIntoReadingPositionExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, messageHost: HTMLElement, row: HTMLElement): void {
    const scroll = ctx.resolveTranscriptScrollController(messageHost);
    if (scroll.phase === 'positioning-turn') {
        scroll.positionTurnStart(messageHost, row);
        return;
    }
    scroll.placeReadingPosition(messageHost, row);
}

export function findLastUserMessageIndexExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, conv: QaapAgentConversationDTO): number {
    for (let index = conv.messages.length - 1; index >= 0; index--) {
        if (conv.messages[index]?.role === 'user') {
            return index;
        }
    }
    return -1;
}

export function findAppendedUserMessageIndexExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, previous: QaapAgentConversationDTO | undefined,
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

export function positionTranscriptVirtualListAtUserTurnExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, messageHost: HTMLElement,
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

export function scrollTranscriptVirtualListToIndexExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, list: { scrollToIndex?: (index: number, contextPx?: number) => void },
    index: number,
    contextPx: number,): void {
    list.scrollToIndex?.(index, contextPx);
}

export function restoreTranscriptOpeningPositionVirtualExtracted(ctx: MobileProjectsTranscriptMessagesRenderUiContext, list: { scrollToIndex?: (index: number, contextPx?: number) => void },
    conv: QaapAgentConversationDTO,
    contextPx: number,): boolean {
    const storedIndex = resolveStoredTranscriptReadMessageIndex(conv.id, conv.messages);
    if (storedIndex !== undefined) {
        ctx.scrollTranscriptVirtualListToIndex(list, storedIndex, contextPx);
        return true;
    }
    return false;
}

