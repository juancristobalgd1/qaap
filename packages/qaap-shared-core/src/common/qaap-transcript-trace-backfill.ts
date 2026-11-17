// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { QAAP_VISUAL_VERIFICATION_MARKER } from './qaap-visual-verification';
import {
    mergeSegmentTraceEvents,
    hasActiveQaapTraceWork,
    resolveAgentMessageDisplayContent,
    resolveQaapTranscriptTrace,
    sanitizeQaapTraceEchoes,
    type QaapTranscriptTraceEventDTO,
} from './qaap-transcript-trace-model';

export interface BackfillAgentMessageTraceOptions {
    /** When true, tail thought/text rows stay in running/streaming state (live turn). */
    readonly streamingTail?: boolean;
}

export interface BackfillConversationTraceResult {
    readonly conversation: QaapAgentConversationDTO;
    readonly changed: boolean;
}

export interface BackfillAgentMessageTraceResult {
    readonly message: QaapAgentMessageDTO;
    readonly changed: boolean;
}

/** Mark in-flight trace rows as settled after a turn completes or is recovered from disk. */
export function settleTraceEvents(
    events: readonly QaapTranscriptTraceEventDTO[],
): QaapTranscriptTraceEventDTO[] {
    const now = Date.now();
    return events.map(event => {
        if (event.type === 'thought' && event.status === 'running') {
            return { ...event, status: 'completed' as const, finishedAt: event.finishedAt ?? now };
        }
        if (event.type === 'assistant_text' && event.status === 'streaming') {
            return { ...event, status: 'completed' as const };
        }
        if (event.type === 'tool_call' && (event.status === 'pending' || event.status === 'running')) {
            return { ...event, status: 'completed' as const, finishedAt: event.finishedAt ?? now };
        }
        return event;
    });
}

export function backfillAgentMessageTraceEvents(
    message: QaapAgentMessageDTO,
    options: BackfillAgentMessageTraceOptions = {},
): BackfillAgentMessageTraceResult {
    if (message.role !== 'agent') {
        return { message, changed: false };
    }
    const segments = message.segments ?? [];
    const persisted = message.traceEvents ?? [];
    if (segments.length === 0 && persisted.length === 0) {
        return { message, changed: false };
    }
    // Legacy `Error: …` echo rows are removed before any comparison, so a poisoned trace is re-saved clean.
    const existing = sanitizeQaapTraceEchoes(persisted);
    let traceEvents = existing;
    // A structured trace is authoritative: every writer that still produces segments writes the
    // trace alongside them, and `materializeAgentMessageForApi` derives segments FROM the trace.
    // Rebuilding it from those segments renumbers the AG-UI ids (`text-1` → `text-0`) under a live
    // turn, so every later wire patch misses its event and the client transcript stops painting.
    if (segments.length > 0 && !hasStructuredTraceEvents(existing)) {
        traceEvents = mergeSegmentTraceEvents(
            existing,
            segments,
            options.streamingTail ? { streaming: true } : undefined,
        );
    } else if (!options.streamingTail) {
        traceEvents = settleTraceEvents(existing);
    }
    let next: QaapAgentMessageDTO = { ...message, traceEvents };
    if (!options.streamingTail) {
        next = compactAgentMessageTraceStorage(next);
    }
    const changed = !traceEventsEqual(traceEvents, persisted)
        || (next.segments?.length ?? 0) !== (message.segments?.length ?? 0);
    if (!changed) {
        return { message, changed: false };
    }
    return {
        message: next,
        changed: true,
    };
}

/** Remove duplicate legacy segments once settled traceEvents are authoritative. */
export function compactAgentMessageTraceStorage(message: QaapAgentMessageDTO): QaapAgentMessageDTO {
    if (message.role !== 'agent' || !(message.traceEvents?.length ?? 0) || !message.segments?.length) {
        return message;
    }
    if (hasActiveQaapTraceWork(message)) {
        return message;
    }
    const { segments: _segments, ...withoutSegments } = message;
    return withoutSegments;
}

/** Drop redundant segments when traceEvents are the live structured payload (streaming or settled). */
export function preferTraceFirstAgentMessageStorage(message: QaapAgentMessageDTO): QaapAgentMessageDTO {
    if (message.role !== 'agent' || !(message.traceEvents?.length ?? 0) || !message.segments?.length) {
        return message;
    }
    const { segments: _segments, ...withoutSegments } = message;
    return withoutSegments;
}

/**
 * Enrich agent rows for REST/detail consumers: derive {@link content} and legacy {@link segments}
 * from traceEvents when the AG-UI wire path left them empty.
 */
export function materializeAgentMessageForApi(message: QaapAgentMessageDTO): QaapAgentMessageDTO {
    if (message.role !== 'agent') {
        return message;
    }
    const trace = resolveQaapTranscriptTrace(message);
    let next = message;
    const content = resolveAgentMessageDisplayContent(message);
    if (content && content !== message.content) {
        next = { ...next, content };
    }
    // A structured trace is authoritative: persisted segments may still carry legacy echo rows, so the
    // trace-derived segments (sanitized by traceEventsToSegments) replace them whenever they exist.
    const persistedCount = next.segments?.length ?? 0;
    const useTraceSegments = trace.segments.length > 0 && (persistedCount === 0 || hasStructuredTraceEvents(message.traceEvents ?? []));
    if (useTraceSegments) {
        next = { ...next, segments: [...trace.segments] };
    }
    return keepVisualEvidenceSegment(next);
}

/** Trace id of the evidence block re-attached after the turn (stable, so a second pass is a no-op). */
const QAAP_VISUAL_EVIDENCE_TRACE_ID = 'qaap-visual-evidence';

/**
 * The visual evidence (or capture-failure note) is appended to a settled reply after the turn, to
 * its content and segments but not to its trace. The transcript draws the trace when there is one
 * (and the API rebuilt segments from it), so the evidence was dropped: "Screenshot not available"
 * for a capture that had landed. Keep the evidence block as the final text of both.
 */
function keepVisualEvidenceSegment(message: QaapAgentMessageDTO): QaapAgentMessageDTO {
    const content = message.content ?? '';
    const markerAt = content.indexOf(QAAP_VISUAL_VERIFICATION_MARKER);
    if (markerAt < 0) {
        return message;
    }
    // The block starts at its `---` divider when the store wrote one right before the marker.
    const divider = content.lastIndexOf('---', markerAt);
    const rawBlock = content.slice(divider >= 0 && !content.slice(divider + 3, markerAt).trim() ? divider : markerAt).trimEnd();
    // The marker is a protocol token (content keeps it for the store): the transcript shows the block
    // without it. The pending chip detects the evidence by its image, not by the marker text.
    const block = rawBlock.replace(QAAP_VISUAL_VERIFICATION_MARKER, '').replace(/\n{3,}/g, '\n\n').trimEnd();
    let next = message;
    const traceEvents = next.traceEvents;
    if (traceEvents?.length && !traceEvents.some(event => event.type === 'assistant_text'
        && (event.id === QAAP_VISUAL_EVIDENCE_TRACE_ID || !!event.content?.includes(QAAP_VISUAL_VERIFICATION_MARKER)))) {
        next = {
            ...next,
            traceEvents: [...traceEvents, { type: 'assistant_text', id: QAAP_VISUAL_EVIDENCE_TRACE_ID, content: block, status: 'completed' }],
        };
    }
    const segments = next.segments;
    if (segments?.length && !segments.some(segment => segment.type === 'text'
        && (segment.content === block || !!segment.content?.includes(QAAP_VISUAL_VERIFICATION_MARKER)))) {
        next = { ...next, segments: [...segments, { type: 'text', content: block }] };
    }
    return next;
}

export function materializeConversationForApiWithChanges(
    conversation: QaapAgentConversationDTO,
): BackfillConversationTraceResult {
    let changed = false;
    const messages = conversation.messages.map(message => {
        const materialized = materializeAgentMessageForApi(message);
        if (materialized.content !== message.content
            || (materialized.segments?.length ?? 0) !== (message.segments?.length ?? 0)) {
            changed = true;
        }
        return materialized;
    });
    if (!changed) {
        return { conversation, changed: false };
    }
    return {
        conversation: { ...conversation, messages },
        changed: true,
    };
}

export function backfillConversationTraceEvents(
    conversation: QaapAgentConversationDTO,
): BackfillConversationTraceResult {
    let changed = false;
    const lastAgentIndex = conversation.messages.reduce(
        (last, message, index) => message.role === 'agent' ? index : last,
        -1,
    );
    const messages = conversation.messages.map((message, index) => {
        if (message.role !== 'agent') {
            return message;
        }
        const streamingTail = conversation.status === 'streaming' && index === lastAgentIndex;
        const result = backfillAgentMessageTraceEvents(message, { streamingTail });
        if (result.changed) {
            changed = true;
        }
        return result.message;
    });
    if (!changed) {
        return { conversation, changed: false };
    }
    return {
        conversation: { ...conversation, messages },
        changed: true,
    };
}

function hasStructuredTraceEvents(events: readonly QaapTranscriptTraceEventDTO[]): boolean {
    return events.some(event => event.type === 'assistant_text' || event.type === 'thought' || event.type === 'tool_call');
}

function traceEventsEqual(
    left: readonly QaapTranscriptTraceEventDTO[],
    right: readonly QaapTranscriptTraceEventDTO[],
): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((event, index) => {
        const other = right[index];
        return event.type === other.type
            && event.id === other.id
            && JSON.stringify(event) === JSON.stringify(other);
    });
}
