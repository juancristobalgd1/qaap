// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Minimum gap between two live-event driven GET /conversation/:id requests for the same conversation. */
export const QAAP_TRANSCRIPT_REFETCH_MIN_INTERVAL_MS = 2_000;

/**
 * Per-conversation throttle for transcript refetches triggered by live events (SSE flushes, detail
 * ticks, stream resync). Callers that get a positive {@link delayMs} schedule one trailing refetch
 * after that delay instead of issuing another GET, so a burst of events coalesces into one request
 * per window. The clock is injectable so tests do not need real timers.
 */
export class QaapTranscriptRefetchThrottle {

    protected readonly issuedAt = new Map<string, number>();
    protected readonly issuedStateKey = new Map<string, string>();

    constructor(
        protected readonly minIntervalMs: number = QAAP_TRANSCRIPT_REFETCH_MIN_INTERVAL_MS,
        protected readonly now: () => number = () => Date.now(),
    ) { }

    /** Milliseconds until a refetch for `conversationId` may be issued; `0` means now. */
    delayMs(conversationId: string): number {
        const at = this.issuedAt.get(conversationId);
        if (at === undefined) {
            return 0;
        }
        return Math.max(0, at + this.minIntervalMs - this.now());
    }

    /** True when `stateKey` differs from the one recorded by the last refetch for `conversationId`. */
    hasStateChanged(conversationId: string, stateKey: string): boolean {
        return this.issuedStateKey.get(conversationId) !== stateKey;
    }

    /** Record that a refetch was issued now, optionally remembering the state it was issued for. */
    markIssued(conversationId: string, stateKey?: string): void {
        this.issuedAt.set(conversationId, this.now());
        if (stateKey !== undefined) {
            this.issuedStateKey.set(conversationId, stateKey);
        }
    }
}
