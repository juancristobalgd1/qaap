// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { parseAgentLogForTranscript } from './qaap-cli-transcript-stream';

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
    };

export interface QaapTranscriptTrace {
    readonly source: 'trace-events' | 'segments' | 'legacy-content' | 'empty';
    readonly events: readonly QaapTranscriptTraceEventDTO[];
    readonly segments: readonly QaapAgentMessageSegmentDTO[];
}

export interface ResolveQaapTranscriptTraceOptions {
    readonly agentId?: string;
    /** Temporary compatibility for old persisted logs. New providers should send traceEvents. */
    readonly allowLegacyContentParse?: boolean;
}

export function resolveQaapTranscriptTrace(
    message: QaapAgentMessageDTO,
    options: ResolveQaapTranscriptTraceOptions = {},
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
    if (options.allowLegacyContentParse && message.role === 'agent' && message.content?.trim()) {
        const parsed = parseAgentLogForTranscript(options.agentId, message.content);
        if (parsed.segments.length > 0) {
            return {
                source: 'legacy-content',
                events: segmentsToTraceEvents(parsed.segments),
                segments: parsed.segments,
            };
        }
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

export function segmentsToTraceEvents(
    segments: readonly QaapAgentMessageSegmentDTO[],
): QaapTranscriptTraceEventDTO[] {
    return segments.map((segment, index): QaapTranscriptTraceEventDTO => {
        if (segment.type === 'thinking') {
            return {
                type: 'thought',
                id: `thought-${index}`,
                content: segment.content,
                status: 'completed',
            };
        }
        if (segment.type === 'text') {
            return {
                type: 'assistant_text',
                id: `text-${index}`,
                content: segment.content,
                status: 'completed',
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
        default: {
            const exhaustive: never = event;
            return exhaustive;
        }
    }
}

export function fingerprintQaapTraceEvents(events: readonly QaapTranscriptTraceEventDTO[] | undefined): string {
    return (events ?? []).map(fingerprintQaapTraceEvent).join('|');
}
