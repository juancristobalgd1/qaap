// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import {
    mergeSegmentTraceEvents,
    hasActiveQaapTraceWork,
    resolveAgentMessageDisplayContent,
    resolveQaapTranscriptTrace,
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
    const existing = message.traceEvents ?? [];
    if (segments.length === 0 && existing.length === 0) {
        return { message, changed: false };
    }
    let traceEvents = existing;
    if (segments.length > 0) {
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
    const changed = !traceEventsEqual(traceEvents, existing)
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
    if (!(next.segments?.length) && trace.segments.length > 0) {
        next = { ...next, segments: [...trace.segments] };
    }
    return next;
}

export function materializeConversationForApi(conversation: QaapAgentConversationDTO): QaapAgentConversationDTO {
    return materializeConversationForApiWithChanges(conversation).conversation;
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
