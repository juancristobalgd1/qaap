// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import {
    mergeSegmentTraceEvents,
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
    if (traceEventsEqual(traceEvents, existing)) {
        return { message, changed: false };
    }
    return {
        message: { ...message, traceEvents },
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
