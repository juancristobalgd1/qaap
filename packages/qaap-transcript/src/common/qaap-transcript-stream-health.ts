// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { TranscriptSemanticProgressSegment } from './qaap-transcript-semantic-progress';
import {
    hasActiveTranscriptToolSegment,
    isTranscriptAgentThinkingPhase,
    TRANSCRIPT_STREAM_STALL_MS,
    TRANSCRIPT_STREAM_TIMEOUT_MS,
} from './qaap-transcript-stream-status';

/** Longer budget while a tool call is still running without finishing. */
export const TRANSCRIPT_STREAM_ACTIVE_TOOL_TIMEOUT_MS = 120_000;

/** No SSE/WS payload for this long while status is still streaming. */
export const TRANSCRIPT_SSE_STALE_MS = 45_000;

export type TranscriptStreamTimeoutCause = 'semantic_idle' | 'active_tool' | 'sse_disconnected';

export interface TranscriptStreamHealthInput {
    readonly streaming: boolean;
    readonly lastProgressAtMs: number | undefined;
    readonly lastTransportEventAtMs: number | undefined;
    readonly segments: readonly TranscriptSemanticProgressSegment[];
    readonly now?: number;
}

export interface TranscriptStreamHealth {
    readonly stalled: boolean;
    readonly timedOut: boolean;
    readonly timeoutCause: TranscriptStreamTimeoutCause | undefined;
    readonly sseStale: boolean;
    readonly hasActiveTool: boolean;
    readonly thinkingActive: boolean;
    readonly idleMs: number;
}

export function resolveTranscriptStreamHealth(
    input: TranscriptStreamHealthInput,
): TranscriptStreamHealth {
    const now = input.now ?? Date.now();
    if (!input.streaming || input.lastProgressAtMs === undefined) {
        return {
            stalled: false,
            timedOut: false,
            timeoutCause: undefined,
            sseStale: false,
            hasActiveTool: hasActiveTranscriptToolSegment(input.segments),
            thinkingActive: isTranscriptAgentThinkingPhase(input.segments, input.streaming),
            idleMs: 0,
        };
    }
    const idleMs = Math.max(0, now - input.lastProgressAtMs);
    const hasActiveTool = hasActiveTranscriptToolSegment(input.segments);
    const thinkingActive = isTranscriptAgentThinkingPhase(input.segments, input.streaming);
    const sseStale = input.lastTransportEventAtMs !== undefined
        && now - input.lastTransportEventAtMs >= TRANSCRIPT_SSE_STALE_MS;
    const timeoutBudget = hasActiveTool
        ? TRANSCRIPT_STREAM_ACTIVE_TOOL_TIMEOUT_MS
        : TRANSCRIPT_STREAM_TIMEOUT_MS;
    const timedOut = idleMs >= timeoutBudget;
    let timeoutCause: TranscriptStreamTimeoutCause | undefined;
    if (timedOut) {
        if (sseStale) {
            timeoutCause = 'sse_disconnected';
        } else if (hasActiveTool) {
            timeoutCause = 'active_tool';
        } else {
            timeoutCause = 'semantic_idle';
        }
    }
    const stalled = !timedOut && idleMs >= TRANSCRIPT_STREAM_STALL_MS;
    return {
        stalled,
        timedOut,
        timeoutCause,
        sseStale,
        hasActiveTool,
        thinkingActive,
        idleMs,
    };
}
