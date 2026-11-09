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
    // Drop the `Error: …` text echoes that segment rows would otherwise re-add for kept lifecycle errors.
    return sanitizeQaapTraceEchoes([...incoming, ...lifecycle]);
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

/** Id prefix of the closing-report trace event (`appendTraceClosingReportEvent`). */
export const QAAP_CLOSING_REPORT_TRACE_ID_PREFIX = 'closing-report-';

/** The turn's closing report (headline + detail lines), stored as an `error`-typed trace event. */
/** Id prefix of the retired blocked-signal note (`blocked-<ts>`), the closing report's predecessor in stored turns. */
const QAAP_LEGACY_BLOCKED_TRACE_ID_PREFIX = 'blocked-';

export function isQaapClosingReportTraceEvent(event: QaapTranscriptTraceEventDTO): boolean {
    return event.type === 'error'
        && (event.id.startsWith(QAAP_CLOSING_REPORT_TRACE_ID_PREFIX) || event.id.startsWith(QAAP_LEGACY_BLOCKED_TRACE_ID_PREFIX));
}

/** The closing report text of an agent message, if the store recorded one. */
export function findQaapClosingReport(message: QaapAgentMessageDTO | undefined): string | undefined {
    for (const event of [...(message?.traceEvents ?? [])].reverse()) {
        if (event.type === 'error' && isQaapClosingReportTraceEvent(event)) {
            return event.message.trim() || undefined;
        }
    }
    return undefined;
}

function stripQaapTraceControlMarkers(text: string): string {
    return text.includes('@@QAAP:') ? text.replace(/@@QAAP:[A-Z0-9_]+@@[ \t]?/g, '') : text;
}

/** Closing-outcome headlines that the segment round-trip used to store as `Error: …` assistant text. */
const QAAP_CLOSING_OUTCOME_ECHO_PATTERN = /^Error: (?:Blocked — needs your input|Completed with warnings|Completed —|Failed —|Done\b)/;

/**
 * Removes assistant text rows that echo `error` trace events (`Error: <message>`), and, when a closing
 * report is present, closing-outcome echoes. Legacy saves stored those echoes and re-merged them on
 * every save, so they accumulated. Never mutates the input; returns a new array either way.
 */
export function sanitizeQaapTraceEchoes(events: readonly QaapTranscriptTraceEventDTO[]): QaapTranscriptTraceEventDTO[] {
    const errorEchoes = new Set<string>(events.flatMap(event => event.type === 'error' ? [`Error: ${event.message.trim()}`] : []));
    const hasClosingReport = events.some(event => isQaapClosingReportTraceEvent(event));
    const isEcho = (event: QaapTranscriptTraceEventDTO): boolean => {
        if (event.type !== 'assistant_text') {
            return false;
        }
        const text = event.content.trim();
        return errorEchoes.has(text) || (hasClosingReport && QAAP_CLOSING_OUTCOME_ECHO_PATTERN.test(text));
    };
    return events.some(isEcho) ? events.filter(event => !isEcho(event)) : [...events];
}

export function traceEventsToSegments(
    events: readonly QaapTranscriptTraceEventDTO[],
): QaapAgentMessageSegmentDTO[] {
    // Safety net: legacy echo rows must not render (or re-persist) as visible text.
    return sanitizeQaapTraceEchoes(events).flatMap((event): QaapAgentMessageSegmentDTO[] => {
        switch (event.type) {
            case 'thought':
                return event.content.trim() ? [{ type: 'thinking', content: event.content }] : [];
            case 'assistant_text': {
                // Machine sentinels (@@QAAP:BLOCKED@@, …) are never visible text, on any render path.
                const content = stripQaapTraceControlMarkers(event.content);
                return content.trim() ? [{ type: 'text', content }] : [];
            }
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
                // The closing report is the turn's outcome, not an error line; the transcript draws it
                // as its own closing row (see isQaapClosingReportTraceEvent).
                return isQaapClosingReportTraceEvent(event) ? [] : [{ type: 'text', content: `Error: ${event.message}` }];
            case 'run_cancelled':
                return event.message.trim()
                    ? [{ type: 'text', content: event.message }]
                    : [];
            case 'checkpoint':
                return [];
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
