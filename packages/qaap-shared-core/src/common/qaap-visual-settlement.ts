// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface QaapVisualSettlementSummary {
    readonly id: string;
    readonly status: 'idle' | 'streaming' | 'settled' | 'failed';
    /** Server-authoritative: the last settled turn still needs visual evidence. */
    readonly visualVerificationPending?: boolean;
}

/**
 * Tracks a full agent turn and captures only after the backend task is truly idle.
 *
 * Two independent paths may fire a capture:
 * - the witnessed streaming→idle transition (fast path while this tab stayed connected), and
 * - the server-authoritative `visualVerificationPending` flag, which survives reloads, dropped
 *   SSE streams, and backgrounded mobile tabs that never saw the turn stream. Note the summary
 *   status may read `failed` from a *historical* message error while the flag is set — the flag
 *   is computed from the raw backend status, so it must not be gated on `status === 'idle'`.
 */
export function shouldCaptureSettledVisualTurn(
    pending: Set<string>,
    summary: QaapVisualSettlementSummary,
): boolean {
    if (summary.status === 'streaming') {
        pending.add(summary.id);
        return false;
    }
    if (summary.status === 'settled') {
        return false;
    }
    const wasPending = pending.delete(summary.id);
    if (summary.visualVerificationPending) {
        return true;
    }
    return summary.status === 'idle' && wasPending;
}
