// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapCodexStreamAccumulator } from './qaap-codex-stream';
import { parseOpencodeFormattedLog, QaapOpencodeStreamAccumulator } from './qaap-opencode-stream';
import {
    isAntigravityAgent,
    isClaudeCodeAgent,
    isCodexAgent,
    isOpencodeAgent,
    isQaiqAgent,
} from './qaap-agent-task-client';
import { detectAgentFailureKind, localizeAgentFailureMessage } from './qaap-agent-failure-message';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import type { QaapAgentMessageSegment } from './qaap-qaiq-stream';
import { QaapQaiqStreamAccumulator } from './qaap-qaiq-stream';
import {
    mergeStreamTraceEvents,
    resolveQaapTranscriptTrace,
    segmentsToTraceEvents,
    type QaapTranscriptTrace,
    type QaapTranscriptTraceEventDTO,
} from './qaap-transcript-trace-model';

export {
    isAntigravityAgent,
    isClaudeCodeAgent,
    isCodexAgent,
    usesStructuredAgentTranscript,
} from './qaap-agent-task-client';

export interface QaapAgentStreamAccumulator {
    push(chunk: string): readonly QaapAgentMessageSegment[];
    getSegments(): readonly QaapAgentMessageSegment[];
    getDisplayText(): string;
    getTraceEvents(): readonly QaapTranscriptTraceEventDTO[];
}

/** Live CLI stream → AG-UI trace rows with running/streaming tail states. */
export function getAccumulatorTraceEvents(
    accumulator: Pick<QaapAgentStreamAccumulator, 'getSegments'>,
): readonly QaapTranscriptTraceEventDTO[] {
    return segmentsToTraceEvents([...accumulator.getSegments()], { streaming: true });
}

export function mergeAccumulatorTraceEvents(
    existing: readonly QaapTranscriptTraceEventDTO[] | undefined,
    accumulator: Pick<QaapAgentStreamAccumulator, 'getTraceEvents'>,
): QaapTranscriptTraceEventDTO[] {
    return mergeStreamTraceEvents(existing, accumulator.getTraceEvents());
}

export function createAgentStreamAccumulator(agentId: string | undefined): QaapAgentStreamAccumulator | undefined {
    if (isQaiqAgent(agentId) || isClaudeCodeAgent(agentId) || isAntigravityAgent(agentId)) {
        return new QaapQaiqStreamAccumulator();
    }
    if (isOpencodeAgent(agentId)) {
        return new QaapOpencodeStreamAccumulator();
    }
    if (isCodexAgent(agentId)) {
        return new QaapCodexStreamAccumulator();
    }
    return undefined;
}

/** Parse a full agent log for transcript replay (SSE settle, history rows). */
export function parseAgentLogForTranscript(
    agentId: string | undefined,
    log: string,
): { content: string; segments: QaapAgentMessageSegment[]; traceEvents: QaapTranscriptTraceEventDTO[] } {
    if (!log.trim()) {
        return { content: '', segments: [], traceEvents: [] };
    }
    if (isQaiqAgent(agentId) || isClaudeCodeAgent(agentId)) {
        const acc = new QaapQaiqStreamAccumulator();
        acc.push(log);
        const segments = [...acc.getSegments()];
        const displayText = acc.getDisplayText().trim();
        if (segments.length > 0) {
            return {
                content: displayText || log.trim(),
                segments,
                traceEvents: [...acc.getTraceEvents()],
            };
        }
        return { content: displayText, segments: [], traceEvents: [] };
    }
    if (isCodexAgent(agentId)) {
        const acc = new QaapCodexStreamAccumulator();
        acc.push(log);
        if (acc.consumedJsonEvents()) {
            const segments = [...acc.getSegments()];
            return {
                content: acc.getDisplayText() || log.trim(),
                segments,
                traceEvents: [...acc.getTraceEvents()],
            };
        }
    }
    if (isOpencodeAgent(agentId)) {
        const acc = new QaapOpencodeStreamAccumulator();
        acc.push(log);
        if (acc.consumedJsonEvents()) {
            const segments = [...acc.getSegments()];
            return {
                content: acc.getDisplayText() || log,
                segments,
                traceEvents: [...acc.getTraceEvents()],
            };
        }
        const formatted = parseOpencodeFormattedLog(log);
        return {
            ...formatted,
            traceEvents: formatted.segments.length ? segmentsToTraceEvents(formatted.segments) : [],
        };
    }
    if (isAntigravityAgent(agentId)) {
        const acc = new QaapQaiqStreamAccumulator();
        acc.push(log);
        const segments = [...acc.getSegments()];
        if (segments.length > 0) {
            return {
                content: acc.getDisplayText() || log.trim(),
                segments,
                traceEvents: [...acc.getTraceEvents()],
            };
        }
        const formatted = parseOpencodeFormattedLog(log);
        return {
            ...formatted,
            traceEvents: formatted.segments.length ? segmentsToTraceEvents(formatted.segments) : [],
        };
    }
    return { content: log.trim(), segments: [], traceEvents: [] };
}

/** Plain reply text for storage/UI — never surfaces QAIQ NDJSON metadata envelopes. */
export function resolveAgentLogDisplayText(agentId: string | undefined, log: string): string {
    const trimmed = log.trim();
    if (!trimmed) {
        return '';
    }
    const failureKind = detectAgentFailureKind(trimmed);
    if (failureKind) {
        return localizeAgentFailureMessage(failureKind);
    }
    return parseAgentLogForTranscript(agentId, trimmed).content.trim();
}

/** Resolve trace rows for historical agent messages that only persisted raw {@link QaapAgentMessageDTO.content}. */
export function resolveAgentTranscriptTraceWithLegacyContent(
    agentId: string | undefined,
    message: QaapAgentMessageDTO,
): QaapTranscriptTrace {
    const trace = resolveQaapTranscriptTrace(message);
    if (trace.segments.length > 0) {
        return trace;
    }
    if (message.role !== 'agent' || !message.content?.trim() || !agentId) {
        return trace;
    }
    const parsed = parseAgentLogForTranscript(agentId, message.content);
    if (parsed.segments.length === 0 && parsed.traceEvents.length === 0) {
        return trace;
    }
    return {
        source: 'legacy-content',
        events: parsed.traceEvents.length > 0
            ? parsed.traceEvents
            : segmentsToTraceEvents(parsed.segments),
        segments: parsed.segments,
    };
}
