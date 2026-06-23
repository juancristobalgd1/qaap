// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';

export type QaapTranscriptTraceEventDTO =
    | {
        readonly type: 'thought';
        readonly id: string;
        readonly content: string;
        readonly status: 'running' | 'completed';
        readonly startedAt?: number;
        readonly finishedAt?: number;
        readonly parentId?: string;
    }
    | {
        readonly type: 'tool_call';
        readonly id: string;
        readonly name: string;
        readonly args: string;
        readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
        readonly result?: string;
        readonly startedAt?: number;
        readonly finishedAt?: number;
        readonly parentId?: string;
    }
    | {
        readonly type: 'assistant_text';
        readonly id: string;
        readonly content: string;
        readonly status: 'streaming' | 'completed';
    }
    | {
        readonly type: 'error';
        readonly id: string;
        readonly message: string;
        readonly startedAt?: number;
    }
    | {
        readonly type: 'run_cancelled';
        readonly id: string;
        readonly message: string;
        readonly startedAt?: number;
    }
    | {
        readonly type: 'checkpoint';
        readonly id: string;
        readonly label: string;
        readonly commit: string;
        readonly capturedAt: number;
        readonly added?: number;
        readonly removed?: number;
    };

export interface QaapTranscriptTrace {
    readonly source: 'trace-events' | 'segments' | 'legacy-content' | 'empty';
    readonly events: readonly QaapTranscriptTraceEventDTO[];
    readonly segments: readonly QaapAgentMessageSegmentDTO[];
}

export function resolveQaapTranscriptTrace(
    message: QaapAgentMessageDTO,
): QaapTranscriptTrace {
    const traceEvents = message.traceEvents ?? [];
    if (traceEvents.length > 0) {
        const segments = traceEventsToSegments(traceEvents);
        return { source: 'trace-events', events: traceEvents, segments };
    }
    if (message.segments?.length) {
        return {
            source: 'segments',
            events: segmentsToTraceEvents(message.segments),
            segments: message.segments,
        };
    }
    return { source: 'empty', events: [], segments: [] };
}

export function hasActiveQaapTraceWork(message: QaapAgentMessageDTO): boolean {
    const trace = resolveQaapTranscriptTrace(message);
    return trace.events.some(event => {
        if (event.type === 'tool_call') {
            return event.status === 'pending' || event.status === 'running';
        }
        if (event.type === 'thought') {
            return event.status === 'running';
        }
        if (event.type === 'assistant_text') {
            return event.status === 'streaming';
        }
        return false;
    });
}

const LIFECYCLE_TRACE_EVENT_TYPES = new Set<QaapTranscriptTraceEventDTO['type']>([
    'checkpoint',
    'run_cancelled',
    'error',
]);

/** Preserve AG-UI lifecycle rows while syncing segment-derived tool/thought/text events. */
export function mergeStreamTraceEvents(
    existing: readonly QaapTranscriptTraceEventDTO[] | undefined,
    incoming: readonly QaapTranscriptTraceEventDTO[],
): QaapTranscriptTraceEventDTO[] {
    const lifecycle = (existing ?? []).filter(event => LIFECYCLE_TRACE_EVENT_TYPES.has(event.type));
    return [...incoming, ...lifecycle];
}

export function mergeSegmentTraceEvents(
    existing: readonly QaapTranscriptTraceEventDTO[] | undefined,
    segments: readonly QaapAgentMessageSegmentDTO[],
    options?: SegmentsToTraceEventsOptions,
): QaapTranscriptTraceEventDTO[] {
    return mergeStreamTraceEvents(existing, segmentsToTraceEvents(segments, options));
}

export interface SegmentsToTraceEventsOptions {
    /** When true, the tail thought/text rows stay in running/streaming state during SSE. */
    readonly streaming?: boolean;
}

export function segmentsToTraceEvents(
    segments: readonly QaapAgentMessageSegmentDTO[],
    options: SegmentsToTraceEventsOptions = {},
): QaapTranscriptTraceEventDTO[] {
    const streaming = options.streaming === true;
    const lastThinkingIndex = streaming
        ? segments.reduce((last, segment, index) => segment.type === 'thinking' ? index : last, -1)
        : -1;
    const lastTextIndex = streaming
        ? segments.reduce((last, segment, index) => segment.type === 'text' ? index : last, -1)
        : -1;
    let thoughtOrdinal = 0;
    let textOrdinal = 0;
    return segments.map((segment, index): QaapTranscriptTraceEventDTO => {
        if (segment.type === 'thinking') {
            const id = `thought-${thoughtOrdinal++}`;
            return {
                type: 'thought',
                id,
                content: segment.content,
                status: streaming && index === lastThinkingIndex ? 'running' : 'completed',
            };
        }
        if (segment.type === 'text') {
            const id = `text-${textOrdinal++}`;
            return {
                type: 'assistant_text',
                id,
                content: segment.content,
                status: streaming && index === lastTextIndex ? 'streaming' : 'completed',
            };
        }
        const failed = !!segment.result && /\b(error|failed|failure|exit\s+[1-9]\d*)\b/i.test(segment.result);
        return {
            type: 'tool_call',
            id: segment.toolUseId,
            name: segment.name,
            args: segment.args,
            status: !segment.finished ? 'running' : failed ? 'failed' : 'completed',
            result: segment.result,
            startedAt: segment.startedAt,
            finishedAt: segment.finishedAt,
            parentId: segment.parentToolUseId,
        };
    });
}

export function traceEventsToSegments(
    events: readonly QaapTranscriptTraceEventDTO[],
): QaapAgentMessageSegmentDTO[] {
    return events.flatMap((event): QaapAgentMessageSegmentDTO[] => {
        switch (event.type) {
            case 'thought':
                return event.content.trim() ? [{ type: 'thinking', content: event.content }] : [];
            case 'assistant_text':
                return event.content.trim() ? [{ type: 'text', content: event.content }] : [];
            case 'tool_call':
                return [{
                    type: 'tool',
                    toolUseId: event.id,
                    name: event.name,
                    args: event.args,
                    finished: event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled',
                    ...(event.result !== undefined ? { result: event.result } : {}),
                    ...(event.startedAt !== undefined ? { startedAt: event.startedAt } : {}),
                    ...(event.finishedAt !== undefined ? { finishedAt: event.finishedAt } : {}),
                    ...(event.parentId !== undefined ? { parentToolUseId: event.parentId } : {}),
                }];
            case 'error':
                return [{ type: 'text', content: `Error: ${event.message}` }];
            case 'run_cancelled':
                return event.message.trim()
                    ? [{ type: 'text', content: event.message }]
                    : [];
            case 'checkpoint':
                return [{
                    type: 'text',
                    content: `Checkpoint: ${event.label}${event.added !== undefined || event.removed !== undefined
                        ? ` (+${event.added ?? 0}/-${event.removed ?? 0})`
                        : ''}`,
                }];
            default: {
                const exhaustive: never = event;
                return exhaustive;
            }
        }
    });
}

export function fingerprintQaapTraceEvent(event: QaapTranscriptTraceEventDTO): string {
    switch (event.type) {
        case 'thought':
        case 'assistant_text':
            return `${event.type}:${event.id}:${event.status}:${event.content.length}`;
        case 'tool_call':
            return [
                event.type,
                event.id,
                event.status,
                event.name,
                event.args.length,
                event.result?.length ?? 0,
                event.parentId ?? '',
            ].join(':');
        case 'error':
            return `${event.type}:${event.id}:${event.message.length}`;
        case 'run_cancelled':
            return `${event.type}:${event.id}:${event.message.length}`;
        case 'checkpoint':
            return `${event.type}:${event.id}:${event.label}:${event.commit}`;
        default: {
            const exhaustive: never = event;
            return exhaustive;
        }
    }
}

export function fingerprintQaapTraceEvents(events: readonly QaapTranscriptTraceEventDTO[] | undefined): string {
    return (events ?? []).map(fingerprintQaapTraceEvent).join('|');
}

/** Prefer traceEvents-derived segments; falls back to legacy {@link QaapAgentMessageDTO.segments}. */
export function resolveAgentMessageSegments(
    message: Pick<QaapAgentMessageDTO, 'segments' | 'traceEvents' | 'role' | 'content'> | undefined,
): readonly QaapAgentMessageSegmentDTO[] {
    if (!message) {
        return [];
    }
    return resolveQaapTranscriptTrace(message as QaapAgentMessageDTO).segments;
}

/** Plain reply text for list previews and REST consumers — prefers stored content, then assistant_text rows. */
export function resolveAgentMessageDisplayContent(
    message: Pick<QaapAgentMessageDTO, 'content' | 'traceEvents' | 'segments' | 'role'>,
): string {
    if (message.content?.trim()) {
        return message.content.trim();
    }
    const text = resolveQaapTranscriptTrace(message as QaapAgentMessageDTO).events
        .filter((event): event is Extract<QaapTranscriptTraceEventDTO, { type: 'assistant_text' }> => event.type === 'assistant_text')
        .map(event => event.content.trim())
        .filter(Boolean)
        .join('\n\n');
    return text.trim();
}
