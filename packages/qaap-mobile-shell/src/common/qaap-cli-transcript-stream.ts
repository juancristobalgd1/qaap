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
import {
    extractAgentAuthLoginChallenge,
    localizeAgentAuthFailureMessage,
} from './qaap-agent-auth-login';
import { detectAgentFailureKind, localizeAgentFailureMessage } from './qaap-agent-failure-message';
import type { QaapAgentMessageSegment } from './qaap-qaiq-stream';
import type { QaapAgentContextUsage } from './qaap-agent-context-usage';
import { QaapQaiqStreamAccumulator } from './qaap-qaiq-stream';
import {
    mergeStreamTraceEvents,
    segmentsToTraceEvents,
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
    getTurnUsage?(): QaapAgentContextUsage | undefined;
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
    if (failureKind === 'auth') {
        // Keep login URLs / device codes from the CLI so the chat can offer a Sign-in CTA
        // (same affordance as the agent TUI hyperlink). Do not replace the body with the
        // generic Settings/API-key sentence.
        const challenge = extractAgentAuthLoginChallenge(trimmed, { agentId });
        const parsed = parseAgentLogForTranscript(agentId, trimmed).content.trim();
        const parts: string[] = [];
        if (parsed) {
            parts.push(parsed);
        } else {
            parts.push(localizeAgentAuthFailureMessage(challenge));
        }
        if (challenge?.url && !parts.some(part => part.includes(challenge.url!))) {
            parts.push(challenge.url);
        }
        if (challenge?.userCode && !parts.some(part => part.includes(challenge.userCode!))) {
            parts.push(`Code: ${challenge.userCode}`);
        }
        return parts.join('\n');
    }
    if (failureKind) {
        return localizeAgentFailureMessage(failureKind);
    }
    return parseAgentLogForTranscript(agentId, trimmed).content.trim();
}
