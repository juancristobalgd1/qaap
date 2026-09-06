// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapAgentConversationDTO,
    QaapAgentMessageDTO,
    QaapAgentMessageSegmentDTO,
} from './qaap-transcript-agent-types';
import { usesStructuredAgentTranscript } from './qaap-structured-transcript-agents';

/** How a live SSE update may patch the transcript DOM without a full rebuild. */
export type QaapTranscriptStreamingPatchKind = 'none' | 'activity-only' | 'last-agent' | 'append-agent' | 'append-user';

const STRUCTURED_TRANSCRIPT_AGENTS = (agentId: string | undefined): boolean =>
    usesStructuredAgentTranscript(agentId);

function stdoutAgentContentChanged(prev: QaapAgentMessageDTO | undefined, next: QaapAgentMessageDTO | undefined): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    // Any content edit qualifies — the DOM applier rewrites the row from the
    // full next content, so corrective re-emits (not just suffix growth) can
    // still take the single-row path instead of a whole-list rebuild.
    return (next.content ?? '') !== (prev.content ?? '');
}

/**
 * Content-sensitive sample hash so fingerprints notice same-length rewrites
 * (a length-only fingerprint silently freezes the transcript when a segment is
 * rewritten to a string of identical length). Hashes the first and last 2048
 * chars plus the length — O(1) per segment regardless of payload size; only a
 * middle-only same-length rewrite beyond both windows can still alias.
 */
const TRANSCRIPT_HASH_SAMPLE_WINDOW = 2048;

export function hashTranscriptText(value: string | undefined): string {
    const text = value ?? '';
    let hash = 0x811c9dc5;
    const head = Math.min(text.length, TRANSCRIPT_HASH_SAMPLE_WINDOW);
    for (let i = 0; i < head; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    const tailStart = Math.max(head, text.length - TRANSCRIPT_HASH_SAMPLE_WINDOW);
    for (let i = tailStart; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${text.length}.${(hash >>> 0).toString(36)}`;
}

function structuredAgentMessageChanged(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    if ((prev.traceEvents?.length ?? 0) > 0 || (next.traceEvents?.length ?? 0) > 0) {
        return fingerprintTranscriptMessage(prev) !== fingerprintTranscriptMessage(next);
    }
    if (fingerprintAgentSegments(prev.segments ?? []) !== fingerprintAgentSegments(next.segments ?? [])) {
        return true;
    }
    return (prev.content ?? '') !== (next.content ?? '');
}

function priorMessagesMatch(
    prev: readonly QaapAgentMessageDTO[],
    next: readonly QaapAgentMessageDTO[],
    count: number,
): boolean {
    for (let i = 0; i < count; i++) {
        if (prev[i]?.id !== next[i]?.id || prev[i]?.role !== next[i]?.role) {
            return false;
        }
    }
    return true;
}

/**
 * Fingerprint for transcript refresh debouncing. Hashes every segment so updates to
 * non-last tools/text during streaming are not skipped.
 */
function fingerprintConversationHeader(conv: QaapAgentConversationDTO): string {
    return [
        conv.autoApprove === false ? '0' : '1',
        conv.status,
        String(conv.messages.length),
    ].join('|');
}

/**
 * Turn provenance (agent + model that actually drove the turn) is sealed onto the user message
 * and rendered as the accordion badge. It is not derivable from content/segments/traceEvents, so
 * every fingerprint that gates a repaint has to hash it too — otherwise a re-seal (initial spawn
 * or fallback-model retry) is indistinguishable from "nothing changed" and the badge never moves.
 */
export function fingerprintTurnProvenance(
    message: Pick<QaapAgentMessageDTO, 'turnAgentId' | 'turnAgentModel'>,
): string {
    const model = message.turnAgentModel;
    return `${message.turnAgentId ?? ''}:${model ? `${model.provider}/${model.vendor}/${model.modelId}` : ''}`;
}

function appendTranscriptMessageFingerprintParts(parts: string[], message: QaapAgentMessageDTO): void {
    parts.push(`run:${message.runActive ?? false}:${message.runFinishedAt ?? ''}`);
    parts.push(message.id ?? '', hashTranscriptText(message.content), `p:${fingerprintTurnProvenance(message)}`);
    if (message.traceEvents?.length) {
        for (const event of message.traceEvents) {
            if (event.type === 'tool_call') {
                parts.push(`e:t:${event.id}:${event.status}:${hashTranscriptText(event.args)}:${hashTranscriptText(event.result)}`);
            } else if (event.type === 'thought' || event.type === 'assistant_text') {
                parts.push(`e:${event.type}:${event.id}:${event.status}:${hashTranscriptText(event.content)}`);
            } else if (event.type === 'error' || event.type === 'run_cancelled') {
                parts.push(`e:${event.type}:${event.id}:${event.message.length}`);
            } else if (event.type === 'checkpoint') {
                parts.push(`e:checkpoint:${event.id}:${event.label}:${event.commit}`);
            }
        }
    }
    if (message.segments?.length) {
        for (const segment of message.segments) {
            if (segment.type === 'tool') {
                parts.push(
                    `t:${segment.toolUseId}:${segment.finished ? '1' : '0'}:${hashTranscriptText(segment.args)}:${hashTranscriptText(segment.result)}`,
                );
            } else {
                parts.push(`${segment.type}:${hashTranscriptText(segment.content)}`);
            }
        }
    }
}

export function fingerprintTranscriptMessage(message: QaapAgentMessageDTO): string {
    const parts: string[] = [];
    appendTranscriptMessageFingerprintParts(parts, message);
    return parts.join('|');
}

export function buildConversationTranscriptFingerprint(conv: QaapAgentConversationDTO): string {
    const parts: string[] = [fingerprintConversationHeader(conv)];
    for (const message of conv.messages) {
        appendTranscriptMessageFingerprintParts(parts, message);
    }
    return parts.join('|');
}

/**
 * Recompute the transcript fingerprint when only the tail message grew during SSE —
 * avoids scanning every historical message on each animation frame.
 *
 * Caches the historical-prefix fingerprint per conversation id so steady-state
 * streaming ticks only re-hash the last message (+ header).
 */
const transcriptFingerprintPrefixCache = new Map<string, {
    readonly messageCount: number;
    readonly historicalIds: string;
    readonly prefix: string;
}>();

export function mergeConversationTranscriptFingerprint(
    prevConv: QaapAgentConversationDTO | undefined,
    next: QaapAgentConversationDTO,
): string {
    if (!prevConv || prevConv.id !== next.id) {
        transcriptFingerprintPrefixCache.delete(next.id);
        return buildConversationTranscriptFingerprint(next);
    }
    if (prevConv.messages.length !== next.messages.length) {
        transcriptFingerprintPrefixCache.delete(next.id);
        return buildConversationTranscriptFingerprint(next);
    }
    const messageCount = next.messages.length;
    if (messageCount === 0) {
        return fingerprintConversationHeader(next);
    }
    const historicalIds = next.messages
        .slice(0, Math.max(0, messageCount - 1))
        .map(message => message.id)
        .join('\u001f');
    const cached = transcriptFingerprintPrefixCache.get(next.id);
    let prefix = cached?.prefix;
    const cacheHit = !!cached
        && cached.messageCount === messageCount
        && cached.historicalIds === historicalIds;
    if (!cacheHit) {
        for (let index = 0; index < messageCount - 1; index++) {
            if (fingerprintTranscriptMessage(prevConv.messages[index]) !== fingerprintTranscriptMessage(next.messages[index])) {
                transcriptFingerprintPrefixCache.delete(next.id);
                return buildConversationTranscriptFingerprint(next);
            }
        }
        const parts: string[] = [];
        for (let index = 0; index < messageCount - 1; index++) {
            appendTranscriptMessageFingerprintParts(parts, next.messages[index]);
        }
        prefix = parts.join('|');
        transcriptFingerprintPrefixCache.set(next.id, {
            messageCount,
            historicalIds,
            prefix: prefix ?? '',
        });
    }
    const parts: string[] = [fingerprintConversationHeader(next)];
    if (prefix) {
        parts.push(prefix);
    }
    appendTranscriptMessageFingerprintParts(parts, next.messages[messageCount - 1]);
    return parts.join('|');
}

/** Whether {@link buildConversationTranscriptFingerprint} changed between two snapshots. */
export function transcriptFingerprintChanged(
    prev: QaapAgentConversationDTO | undefined,
    next: QaapAgentConversationDTO,
): boolean {
    if (!prev || prev.id !== next.id) {
        return true;
    }
    return buildConversationTranscriptFingerprint(prev) !== buildConversationTranscriptFingerprint(next);
}

/** Force a DOM refresh when a turn settles even if the fingerprint already matched mid-stream. */
export function shouldForceTranscriptRenderOnStatusSettle(
    prev: QaapAgentConversationDTO | undefined,
    next: QaapAgentConversationDTO,
    fingerprintUnchanged: boolean,
): boolean {
    if (!fingerprintUnchanged) {
        return false;
    }
    return prev?.status === 'streaming' && next.status !== 'streaming';
}

/** Why a streaming tick could not take any patch fast path (for telemetry). */
export type QaapTranscriptStreamingPatchNoneReason =
    | 'not-streaming'
    | 'conversation-switched'
    | 'prior-diverged'
    | 'tail-empty'
    | 'tail-unchanged'
    | 'count-shrunk'
    | 'tail-role-unknown';

export interface QaapTranscriptStreamingPatchDecision {
    readonly kind: QaapTranscriptStreamingPatchKind;
    /** Set only when `kind === 'none'`. */
    readonly noneReason?: QaapTranscriptStreamingPatchNoneReason;
}

const NONE = (noneReason: QaapTranscriptStreamingPatchNoneReason): QaapTranscriptStreamingPatchDecision =>
    ({ kind: 'none', noneReason });

/**
 * During QAIQ/OpenCode streaming, only the tail of the thread changes. Patching avoids
 * `replaceChildren()` so tool expand state and scroll position stay stable. The decision
 * carries the reject reason so telemetry can attribute every residual full rebuild.
 */
export function resolveStreamingTranscriptPatchDecision(
    prev: QaapAgentConversationDTO | undefined,
    next: QaapAgentConversationDTO,
): QaapTranscriptStreamingPatchDecision {
    if (next.status !== 'streaming') {
        return NONE('not-streaming');
    }
    if (!prev || prev.id !== next.id) {
        return NONE('conversation-switched');
    }

    const prevMessages = prev.messages;
    const nextMessages = next.messages;
    const nextLast = nextMessages[nextMessages.length - 1];
    const structured = STRUCTURED_TRANSCRIPT_AGENTS(next.agentId);

    if (prevMessages.length === nextMessages.length && nextLast?.role === 'user') {
        return priorMessagesMatch(prevMessages, nextMessages, nextMessages.length)
            ? { kind: 'activity-only' }
            : NONE('prior-diverged');
    }

    if (prevMessages.length === nextMessages.length && nextLast?.role === 'agent') {
        if (!priorMessagesMatch(prevMessages, nextMessages, nextMessages.length - 1)) {
            return NONE('prior-diverged');
        }
        if (structured) {
            if (!hasRenderableSegments(nextLast)) {
                return NONE('tail-empty');
            }
            const prevLast = prevMessages[prevMessages.length - 1];
            return structuredAgentMessageChanged(prevLast, nextLast) ? { kind: 'last-agent' } : NONE('tail-unchanged');
        }
        const prevLast = prevMessages[prevMessages.length - 1];
        return stdoutAgentContentChanged(prevLast, nextLast) ? { kind: 'last-agent' } : NONE('tail-unchanged');
    }

    // One or more rows appended at the tail: a new agent turn (possibly still
    // the empty placeholder tick — the full rebuild paints that placeholder row
    // too, so appending it keeps parity), a queued user message sent mid-stream,
    // or a coalesced tick delivering several rows at once. Appending fresh rows
    // never mutates existing DOM, so no content-growth gate is needed.
    if (nextMessages.length > prevMessages.length) {
        if (!priorMessagesMatch(prevMessages, nextMessages, prevMessages.length)) {
            return NONE('prior-diverged');
        }
        if (nextLast?.role === 'agent') {
            return { kind: 'append-agent' };
        }
        if (nextLast?.role === 'user') {
            return { kind: 'append-user' };
        }
        return NONE('tail-role-unknown');
    }

    if (nextMessages.length < prevMessages.length) {
        return NONE('count-shrunk');
    }
    return NONE('tail-role-unknown');
}

export function resolveStreamingTranscriptPatchKind(
    prev: QaapAgentConversationDTO | undefined,
    next: QaapAgentConversationDTO,
): QaapTranscriptStreamingPatchKind {
    return resolveStreamingTranscriptPatchDecision(prev, next).kind;
}

function hasRenderableSegments(message: QaapAgentMessageDTO | undefined): boolean {
    return !!(message?.segments?.length || message?.traceEvents?.length);
}

/** True when a streaming SSE tick did not change the visible tail of the transcript. */
export function isStreamingTranscriptTailUnchanged(
    prev: QaapAgentConversationDTO | undefined,
    next: QaapAgentConversationDTO,
): boolean {
    if (!prev || prev.id !== next.id || next.status !== 'streaming') {
        return false;
    }
    if (prev.messages.length !== next.messages.length) {
        return false;
    }
    const prevLast = prev.messages[prev.messages.length - 1];
    const nextLast = next.messages[next.messages.length - 1];
    if (!prevLast || !nextLast || prevLast.id !== nextLast.id || prevLast.role !== nextLast.role) {
        return false;
    }
    if (nextLast.role === 'agent' && STRUCTURED_TRANSCRIPT_AGENTS(next.agentId)) {
        return !structuredAgentMessageChanged(prevLast, nextLast);
    }
    return (prevLast.content ?? '') === (nextLast.content ?? '');
}

/** Stable selector hook for incremental DOM patches. */
export const TRANSCRIPT_MESSAGE_ID_ATTR = 'data-transcript-message-id';

/** Index of a segment inside the agent message snapshot (for in-place text streaming patches). */
export const TRANSCRIPT_SEGMENT_INDEX_ATTR = 'data-transcript-segment-index';

/** Stable id for incremental updates to a rendered tool pill. */
export const TRANSCRIPT_TOOL_USE_ID_ATTR = 'data-transcript-tool-use-id';

/** Marks the live “thinking/acting” placeholder row while the agent has not replied yet. */
export const TRANSCRIPT_ACTIVITY_ROW_ATTR = 'data-transcript-activity-row';

/** Inline Cursor-style execution timeline inside an agent message row. */
export const TRANSCRIPT_ACTIVITY_TIMELINE_ATTR = 'data-transcript-activity-timeline';

/** Marks the live step row inside the execution timeline during streaming. */
export const TRANSCRIPT_ACTIVITY_ACTIVE_ATTR = 'data-transcript-activity-active';

/** Collapsible thought header above the inline execution trace. */
export const TRANSCRIPT_THOUGHT_BRIEF_ATTR = 'data-transcript-thought-brief';

function segmentToolFingerprint(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): string {
    return `t:${segment.toolUseId}:${segment.finished ? '1' : '0'}:${hashTranscriptText(segment.args)}:${hashTranscriptText(segment.result)}:${segment.name}`;
}

function segmentsExactlyEqual(
    prev: QaapAgentMessageSegmentDTO,
    next: QaapAgentMessageSegmentDTO,
): boolean {
    // Direct field comparison — content-exact for tools too, so a same-length
    // args/result rewrite is seen as a change (a length-based fingerprint made
    // those rewrites invisible and froze the row).
    if (prev.type !== next.type) {
        return false;
    }
    if (prev.type === 'tool' && next.type === 'tool') {
        return prev.toolUseId === next.toolUseId
            && prev.name === next.name
            && prev.finished === next.finished
            && (prev.args ?? '') === (next.args ?? '')
            && (prev.result ?? '') === (next.result ?? '');
    }
    const prevContent = 'content' in prev ? (prev.content ?? '') : '';
    const nextContent = 'content' in next ? (next.content ?? '') : '';
    return prevContent === nextContent;
}

/** Tool segment changed (streaming result/args or finish) — safe to patch the existing pill. */
export function canPatchToolSegmentGrowth(
    prev: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    next: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
): boolean {
    if (prev.toolUseId !== next.toolUseId || prev.name !== next.name) {
        return false;
    }
    if (prev.finished && !next.finished) {
        return false;
    }
    // Args AND result may rewrite mid-stream, not just grow (JSON reparse,
    // placeholder → final swap once verification completes, terminal output
    // re-cleaned by the backend). Every DOM applier re-renders the row from
    // the full `next` segment (patchTranscriptToolPill, patchMobileToolDetail →
    // patchTranscriptCodeView handles rewrite + shrink per line), so a
    // non-monotonic change is still a safe single-row patch.
    return prev.finished !== next.finished
        || (prev.args ?? '') !== (next.args ?? '')
        || (prev.result ?? '') !== (next.result ?? '');
}

/**
 * True when the agent tail changed only by growing existing text segment content — tools,
 * thinking blocks, and segment cardinality stay identical so the DOM can patch markdown
 * in place instead of rebuilding tool pills and expand state.
 */
export function canStreamPatchAgentTextContentOnly(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    const prevSegments = prev.segments ?? [];
    const nextSegments = next.segments ?? [];
    if (prevSegments.length === 0 || prevSegments.length !== nextSegments.length) {
        return false;
    }
    let sawTextGrowth = false;
    for (let i = 0; i < prevSegments.length; i++) {
        const p = prevSegments[i];
        const n = nextSegments[i];
        if (p.type === 'tool' && n.type === 'tool') {
            if (segmentToolFingerprint(p) !== segmentToolFingerprint(n)) {
                return false;
            }
            continue;
        }
        if (p.type === 'text' && n.type === 'text') {
            const previous = p.content ?? '';
            const incoming = n.content ?? '';
            if (incoming === previous) {
                continue;
            }
            if (incoming.startsWith(previous) && incoming.length > previous.length) {
                sawTextGrowth = true;
                continue;
            }
            return false;
        }
        if (p.type !== n.type) {
            return false;
        }
        // thinking / other non-tool segments must be byte-identical for a text-only patch
        if (p.type !== 'tool' && p.type !== 'text') {
            const previous = 'content' in p ? (p.content ?? '') : '';
            const incoming = 'content' in n ? (n.content ?? '') : '';
            if (previous !== incoming) {
                return false;
            }
        }
    }
    return sawTextGrowth;
}

/** Stdout-style agents without structured segments — plain content changed. */
export function canStreamPatchStdoutAgentContentOnly(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    if ((prev.segments?.length ?? 0) > 0 || (next.segments?.length ?? 0) > 0) {
        return false;
    }
    // Any edit qualifies — the applier rewrites the content element from the
    // full next content, so corrective re-emits patch in place too.
    return (next.content ?? '') !== (prev.content ?? '');
}

/**
 * True when only tool segments changed in a patchable way (streaming result/args or finish),
 * while text/thinking blocks stay byte-identical.
 */
export function canStreamPatchAgentToolsOnly(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    const prevSegments = prev.segments ?? [];
    const nextSegments = next.segments ?? [];
    if (prevSegments.length === 0 || prevSegments.length !== nextSegments.length) {
        return false;
    }
    let sawToolPatch = false;
    for (let i = 0; i < prevSegments.length; i++) {
        const p = prevSegments[i];
        const n = nextSegments[i];
        if (p.type === 'tool' && n.type === 'tool') {
            if (segmentToolFingerprint(p) === segmentToolFingerprint(n)) {
                continue;
            }
            if (!canPatchToolSegmentGrowth(p, n)) {
                return false;
            }
            sawToolPatch = true;
            continue;
        }
        if (!segmentsExactlyEqual(p, n)) {
            return false;
        }
    }
    return sawToolPatch;
}

/**
 * True when every changed segment is a patchable text growth and/or tool growth/finish
 * in the same snapshot (same segment count).
 */
export function canStreamPatchAgentSegmentsInPlace(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    const prevSegments = prev.segments ?? [];
    const nextSegments = next.segments ?? [];
    if (prevSegments.length === 0 || prevSegments.length !== nextSegments.length) {
        return false;
    }
    let sawChange = false;
    for (let i = 0; i < prevSegments.length; i++) {
        const p = prevSegments[i];
        const n = nextSegments[i];
        if (segmentsExactlyEqual(p, n)) {
            continue;
        }
        if (p.type === 'text' && n.type === 'text') {
            // Any rewrite qualifies, not just prefix growth — the applier
            // re-renders markdown from the full next content (and the stream
            // smoother repaints when the revealed prefix no longer matches).
            if ((n.content ?? '') !== (p.content ?? '')) {
                sawChange = true;
            }
            continue;
        }
        if (p.type === 'thinking' && n.type === 'thinking') {
            // Thinking may rewrite mid-stream (collapse / reorder paragraphs),
            // same tool-args rewrite case — keep the row and patch narrative.
            if ((n.content ?? '') !== (p.content ?? '')) {
                sawChange = true;
            }
            continue;
        }
        if (p.type === 'tool' && n.type === 'tool') {
            if (canPatchToolSegmentGrowth(p, n)) {
                sawChange = true;
                continue;
            }
            return false;
        }
        return false;
    }
    return sawChange;
}

/**
 * Combined tick: existing segments changed patchably AND exactly one new
 * segment appeared at the tail (e.g. a tool finishing and the next text block
 * starting inside one coalesced frame). The prefix patches in place; the tail
 * appends fresh — neither requires a row rebuild.
 */
export function canStreamPatchAgentSegmentsInPlaceWithAppend(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    const prevSegments = prev.segments ?? [];
    const nextSegments = next.segments ?? [];
    if (prevSegments.length === 0 || nextSegments.length !== prevSegments.length + 1) {
        return false;
    }
    const tail = nextSegments[nextSegments.length - 1];
    if (!tail || (tail.type !== 'text' && tail.type !== 'tool' && tail.type !== 'thinking')) {
        return false;
    }
    return canStreamPatchAgentSegmentsInPlace(prev, { ...next, segments: nextSegments.slice(0, prevSegments.length) });
}

/** A new tool segment appeared at the tail — prior segments are unchanged. */
export function canStreamPatchAgentAppendToolSegment(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    const prevSegments = prev.segments ?? [];
    const nextSegments = next.segments ?? [];
    if (nextSegments.length !== prevSegments.length + 1) {
        return false;
    }
    for (let i = 0; i < prevSegments.length; i++) {
        if (!segmentsExactlyEqual(prevSegments[i], nextSegments[i])) {
            return false;
        }
    }
    return nextSegments[nextSegments.length - 1]?.type === 'tool';
}

/** A new text segment appeared at the tail — prior segments are unchanged. */
export function canStreamPatchAgentAppendTextSegment(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    const prevSegments = prev.segments ?? [];
    const nextSegments = next.segments ?? [];
    if (nextSegments.length !== prevSegments.length + 1) {
        return false;
    }
    for (let i = 0; i < prevSegments.length; i++) {
        if (!segmentsExactlyEqual(prevSegments[i], nextSegments[i])) {
            return false;
        }
    }
    return nextSegments[nextSegments.length - 1]?.type === 'text';
}

/** A new thinking segment appeared at the tail — prior segments are unchanged. */
export function canStreamPatchAgentAppendThinkingSegment(
    prev: QaapAgentMessageDTO | undefined,
    next: QaapAgentMessageDTO | undefined,
): boolean {
    if (!prev || !next || prev.id !== next.id) {
        return false;
    }
    const prevSegments = prev.segments ?? [];
    const nextSegments = next.segments ?? [];
    if (nextSegments.length !== prevSegments.length + 1) {
        return false;
    }
    for (let i = 0; i < prevSegments.length; i++) {
        if (!segmentsExactlyEqual(prevSegments[i], nextSegments[i])) {
            return false;
        }
    }
    return nextSegments[nextSegments.length - 1]?.type === 'thinking';
}

export function fingerprintAgentSegments(segments: readonly QaapAgentMessageSegmentDTO[]): string {
    return segments.map(segment => {
        if (segment.type === 'tool') {
            return `t:${segment.toolUseId}:${segment.finished ? '1' : '0'}:${hashTranscriptText(segment.args)}:${hashTranscriptText(segment.result)}`;
        }
        return `${segment.type}:${hashTranscriptText(segment.content)}`;
    }).join('|');
}
