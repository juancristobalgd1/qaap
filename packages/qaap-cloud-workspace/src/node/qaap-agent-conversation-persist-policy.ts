// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { STREAMING_PERSIST_DEBOUNCE_MS } from './qaap-agent-conversation-store-constants';

/** Lower bound of the streaming persist debounce: the historical fixed delay. */
export const STREAMING_PERSIST_MIN_DELAY_MS = STREAMING_PERSIST_DEBOUNCE_MS;

/**
 * Upper bound of the streaming persist debounce. It is also the most partial streaming output a
 * crash can lose, so keep it small enough that a restart still resumes recent work.
 */
export const STREAMING_PERSIST_MAX_DELAY_MS = 30_000;

/**
 * Each debounce waits this many times the duration of the last store write. The namespace rewrite
 * is synchronous, so waiting proportionally keeps it from holding the event loop more than ~5 % of
 * the time while a turn streams.
 */
export const STREAMING_PERSIST_DELAY_PER_WRITE_MS_FACTOR = 20;

/** Store writes at or above this duration are logged with `[qaap-persist]`. */
export const QAAP_PERSIST_SLOW_WRITE_LOG_MS = 250;

/**
 * Debounce delay for the next streaming persist, from the duration of the last completed store
 * write. Clamped to `[STREAMING_PERSIST_MIN_DELAY_MS, STREAMING_PERSIST_MAX_DELAY_MS]`; with no
 * measurement yet (or a bogus one) the historical minimum applies.
 */
export function resolveAdaptiveStreamingPersistDelayMs(lastWriteDurationMs: number | undefined): number {
    if (lastWriteDurationMs === undefined || !Number.isFinite(lastWriteDurationMs) || lastWriteDurationMs < 0) {
        return STREAMING_PERSIST_MIN_DELAY_MS;
    }
    const scaled = Math.round(lastWriteDurationMs * STREAMING_PERSIST_DELAY_PER_WRITE_MS_FACTOR);
    return Math.min(STREAMING_PERSIST_MAX_DELAY_MS, Math.max(STREAMING_PERSIST_MIN_DELAY_MS, scaled));
}

/** Timing and size of one store write, as reported by the sqlite store. Carries no record content. */
export interface QaapPersistWriteStats {
    readonly namespace: string;
    readonly entries: number;
    readonly chars: number;
    readonly stringifyMs: number;
    readonly totalMs: number;
}

/** One-line `[qaap-persist]` record for a slow write. Only numbers and the namespace name. */
export function formatSlowPersistWriteLog(stats: QaapPersistWriteStats): string {
    return `[qaap-persist] namespace=${stats.namespace} entries=${stats.entries} chars=${stats.chars} `
        + `stringifyMs=${stats.stringifyMs.toFixed(0)} totalMs=${stats.totalMs.toFixed(0)}`;
}

/** One-line `[qaap-loop]` record for an event-loop stall. Only numbers. */
export function formatEventLoopStallLog(stallStartEpochMs: number, stallMs: number): string {
    return `[qaap-loop] stallMs=${stallMs.toFixed(0)} startEpochMs=${stallStartEpochMs}`;
}

/** Event-loop stalls at or above this length are logged with `[qaap-loop]`. */
export const QAAP_LOOP_STALL_LOG_MS = 1000;

/**
 * One-line `[qaap-task-start]` record when a task starts: where it came from and its ids. Never
 * carries the prompt, command, paths or any other user content.
 */
export function formatTaskStartLog(origin: 'create' | 'drain', taskId: string, clientRequestId?: string): string {
    const request = clientRequestId ? ` clientRequestId=${clientRequestId}` : '';
    return `[qaap-task-start] origin=${origin} taskId=${taskId}${request}`;
}
