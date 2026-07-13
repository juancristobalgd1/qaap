// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface QaapVisualSettlementSummary {
    readonly id: string;
    readonly status: 'idle' | 'streaming' | 'settled' | 'failed';
}

/** Tracks a full agent turn and captures only after the backend task is truly idle. */
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
    return summary.status === 'idle' && wasPending;
}
