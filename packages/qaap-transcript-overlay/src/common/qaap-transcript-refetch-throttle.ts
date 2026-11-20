// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Minimum gap between two live-event driven GET /conversation/:id requests for the same conversation. */
export const QAAP_TRANSCRIPT_REFETCH_MIN_INTERVAL_MS = 2_000;

/** Injectable timer pair so tests can drive trailing refetches without real timers. */
export interface QaapTranscriptRefetchTimers {
    set(run: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
}

const defaultTimers: QaapTranscriptRefetchTimers = {
    set: (run, delayMs) => globalThis.setTimeout(run, delayMs),
    clear: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Per-conversation throttle for transcript refetches triggered by live events (SSE flushes, detail
 * ticks, stream resync). A caller that finds the window still open schedules one trailing refetch
 * with {@link scheduleTrailing}; a later schedule for the same id replaces the pending one, so a
 * burst coalesces into a single GET at the end of the window. The clock and timers are injectable.
 */
export class QaapTranscriptRefetchThrottle {

    protected readonly issuedAt = new Map<string, number>();
    protected readonly issuedStateKey = new Map<string, string>();
    protected readonly pendingTrailing = new Map<string, unknown>();

    constructor(
        protected readonly minIntervalMs: number = QAAP_TRANSCRIPT_REFETCH_MIN_INTERVAL_MS,
        protected readonly now: () => number = () => Date.now(),
        protected readonly timers: QaapTranscriptRefetchTimers = defaultTimers,
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

    /**
     * Run `run` once after `delayMs` for `conversationId`, recording `stateKey` as issued when it fires.
     * Replaces any trailing refetch already pending for the same id, so timers never accumulate.
     */
    scheduleTrailing(conversationId: string, delayMs: number, stateKey: string, run: () => void): void {
        this.clearTrailing(conversationId);
        const handle = this.timers.set(() => {
            this.pendingTrailing.delete(conversationId);
            this.markIssued(conversationId, stateKey);
            run();
        }, delayMs);
        this.pendingTrailing.set(conversationId, handle);
    }

    /** Whether a trailing refetch is waiting to fire for `conversationId`. */
    hasTrailing(conversationId: string): boolean {
        return this.pendingTrailing.has(conversationId);
    }

    /** Drop the pending trailing refetch for one conversation. */
    clearTrailing(conversationId: string): void {
        const handle = this.pendingTrailing.get(conversationId);
        if (handle !== undefined) {
            this.timers.clear(handle);
            this.pendingTrailing.delete(conversationId);
        }
    }

    /** Drop every pending trailing refetch (conversation switched away or view disposed). */
    cancelAll(): void {
        for (const conversationId of [...this.pendingTrailing.keys()]) {
            this.clearTrailing(conversationId);
        }
    }
}
