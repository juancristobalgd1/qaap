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

/**
 * Budget before the turn's first agent output. A cold first run (tenant wake, CLI boot, provider
 * auth, model cold start) can need more than a minute, so 60s was too eager; past 90s the user
 * gets the timeout card with Retry instead of an open-ended "Starting the agent…" spinner. The
 * timeout card does not stop the agent; the backend keeps its own idle watchdog.
 */
export const TRANSCRIPT_STREAM_FIRST_OUTPUT_TIMEOUT_MS = 90_000;

/**
 * Retry a turn once automatically when the agent has produced no output. Later than the visible
 * timeout: a forced retry kills the running agent, so the user gets the Retry card first.
 */
export const TRANSCRIPT_FIRST_OUTPUT_AUTO_RETRY_MS = 180_000;

export interface TranscriptFirstOutputRetryInput {
    readonly streaming: boolean;
    readonly awaitingFirstOutput: boolean;
    readonly idleMs: number;
    /** The original turn is attempt 1; a missing value is also the original turn. */
    readonly retryAttempt?: number;
}

/**
 * Whether the one automatic first-output retry is due. Later retries stay user initiated so a
 * provider failure cannot create an unbounded retry loop.
 */
export function shouldAutoRetryTranscriptFirstOutput(input: TranscriptFirstOutputRetryInput): boolean {
    return input.streaming
        && input.awaitingFirstOutput
        && input.idleMs >= TRANSCRIPT_FIRST_OUTPUT_AUTO_RETRY_MS
        && (input.retryAttempt ?? 1) <= 1;
}

/** No SSE/WS payload for this long while status is still streaming. */
export const TRANSCRIPT_SSE_STALE_MS = 45_000;

export type TranscriptStreamTimeoutCause = 'semantic_idle' | 'active_tool' | 'sse_disconnected';

export interface TranscriptStreamHealthInput {
    readonly streaming: boolean;
    readonly lastProgressAtMs: number | undefined;
    /**
     * Start of the in-flight turn (last user message). Used as the progress baseline when the
     * client never seeded its progress clock, so a turn that never starts still times out.
     */
    readonly turnStartedAtMs?: number;
    readonly lastTransportEventAtMs: number | undefined;
    readonly segments: readonly TranscriptSemanticProgressSegment[];
    readonly now?: number;
    /**
     * The backend reported automatic post-turn verification (repo checks / fix turns) in progress.
     * Those phases legitimately run for minutes without agent output, so the stall / timeout
     * watchdog stays quiet while this is set.
     */
    readonly verifying?: boolean;
}

export interface TranscriptStreamHealth {
    readonly stalled: boolean;
    readonly timedOut: boolean;
    readonly timeoutCause: TranscriptStreamTimeoutCause | undefined;
    readonly sseStale: boolean;
    readonly hasActiveTool: boolean;
    readonly thinkingActive: boolean;
    readonly idleMs: number;
    /** Streaming, but the agent has not produced anything for this turn yet. */
    readonly awaitingFirstOutput: boolean;
}

export function resolveTranscriptStreamHealth(
    input: TranscriptStreamHealthInput,
): TranscriptStreamHealth {
    const now = input.now ?? Date.now();
    const lastProgressAtMs = input.lastProgressAtMs ?? input.turnStartedAtMs;
    if (!input.streaming || lastProgressAtMs === undefined || input.verifying) {
        return {
            stalled: false,
            timedOut: false,
            timeoutCause: undefined,
            sseStale: false,
            hasActiveTool: hasActiveTranscriptToolSegment(input.segments),
            thinkingActive: isTranscriptAgentThinkingPhase(input.segments, input.streaming),
            idleMs: 0,
            awaitingFirstOutput: false,
        };
    }
    const idleMs = Math.max(0, now - lastProgressAtMs);
    const hasActiveTool = hasActiveTranscriptToolSegment(input.segments);
    const thinkingActive = isTranscriptAgentThinkingPhase(input.segments, input.streaming);
    const sseStale = input.lastTransportEventAtMs !== undefined
        && now - input.lastTransportEventAtMs >= TRANSCRIPT_SSE_STALE_MS;
    const awaitingFirstOutput = input.segments.length === 0;
    const timeoutBudget = hasActiveTool
        ? TRANSCRIPT_STREAM_ACTIVE_TOOL_TIMEOUT_MS
        : awaitingFirstOutput ? TRANSCRIPT_STREAM_FIRST_OUTPUT_TIMEOUT_MS : TRANSCRIPT_STREAM_TIMEOUT_MS;
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
        awaitingFirstOutput,
    };
}
