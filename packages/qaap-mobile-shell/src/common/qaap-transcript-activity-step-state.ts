// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Cursor-parity execution timeline step states. */
export type TranscriptActivityStepState =
    | 'waiting'
    | 'thinking'
    | 'running'
    | 'streaming'
    | 'success'
    | 'warning'
    | 'error'
    | 'cancelled'
    | 'retrying';

export const TRANSCRIPT_ACTIVITY_LIVE_STATES: ReadonlySet<TranscriptActivityStepState> = new Set([
    'waiting',
    'thinking',
    'running',
    'streaming',
    'retrying',
]);

export function isTranscriptActivityLiveState(state: TranscriptActivityStepState): boolean {
    return TRANSCRIPT_ACTIVITY_LIVE_STATES.has(state);
}

/** First line of a failed tool result — short enough for a timeline row. */
export function excerptTranscriptToolError(result: string | undefined, maxLength = 96): string | undefined {
    const line = (result ?? '')
        .split('\n')
        .map(entry => entry.replace(/\s+/g, ' ').trim())
        .find(entry => entry.length > 0);
    if (!line) {
        return undefined;
    }
    if (line.length <= maxLength) {
        return line;
    }
    return `${line.slice(0, maxLength - 1).trimEnd()}…`;
}

export function detectTranscriptToolRetryHint(result: string | undefined): boolean {
    return /\b(retry|retried|retrying|re-?run|attempt\s+[2-9])\b/i.test(result ?? '');
}

/** Human-readable step duration — sub-minute uses one decimal when under 10s. */
export function formatTranscriptActivityStepDuration(durationMs: number): string {
    const ms = Math.max(0, durationMs);
    if (ms < 10_000) {
        const seconds = ms / 1000;
        return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
    }
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
