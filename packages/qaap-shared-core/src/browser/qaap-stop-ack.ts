// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * How long a Stop waits for the server's acknowledgement. The POST can take up to ~20 s while the
 * server's event loop is blocked by a large store write, so the bound is generous on purpose.
 */
export const QAAP_STOP_ACK_TIMEOUT_MS = 20_000;

export type QaapStopAckOutcome = 'acknowledged' | 'failed' | 'expired';

export interface QaapStopAckDetail {
    /** Set for `failed`: the error the Stop request rejected with. */
    readonly error?: unknown;
    /** Set for `expired`: the server still reports the conversation as streaming (asked at expiry). */
    readonly stillStreaming: boolean;
}

export interface QaapStopAckOptions {
    /**
     * Asked once at expiry, from the server: the optimistic idle in the local store says nothing about
     * whether the agent is still alive. Answer `true` when unknown, so Send stays blocked.
     */
    readonly isStillStreaming: () => Promise<boolean>;
    /** Called once per Stop with the settled outcome. */
    readonly onSettled: (outcome: QaapStopAckOutcome, detail: QaapStopAckDetail) => void;
    /** Called when a request that already expired finally answers. */
    readonly onLateAnswer?: (outcome: 'acknowledged' | 'failed', error?: unknown) => void;
    /** Aborts the Stop request (the POST). Called when the server reports the run ended before the ack. */
    readonly abort?: () => void;
    readonly timeoutMs?: number;
    /** Bound on the expiry question; defaults to {@link QAAP_STOP_STATUS_PROBE_TIMEOUT_MS}. */
    readonly probeTimeoutMs?: number;
}

/** Bound on the expiry question: a server that cannot answer in time keeps Send blocked. */
export const QAAP_STOP_STATUS_PROBE_TIMEOUT_MS = 3_000;

interface QaapStopAckEntry {
    readonly token: number;
    readonly abort?: () => void;
    /** The Stop expired and the server still reports the run: Send stays blocked, Stop is retryable. */
    expired: boolean;
}

/**
 * Tracks the Stop requests in flight per conversation. While a Stop is unacknowledged, Send for that
 * conversation is blocked: the agent may still be alive, and a cancel that reaches the server late
 * could end the next turn the user just sent.
 *
 * Release rules: an acknowledgement or a failure releases Send. An expiry with the server still
 * streaming keeps Send blocked and makes the Stop retryable (Stop is shown again, Send is not). The
 * server reporting the run ended releases Send at once and aborts the Stop request that is still
 * pending, so a late cancel cannot end a turn sent after it. A late answer releases Send only if no
 * newer Stop has taken the block over.
 */
export class QaapStopAckTracker {

    protected readonly blocks = new Map<string, QaapStopAckEntry>();
    /** Sequence number of the last Stop that settled (released its block or answered) per conversation. */
    protected readonly settledSequence = new Map<string, number>();
    protected sequence = 0;

    isSendBlocked(conversationId: string): boolean {
        return this.blocks.has(conversationId);
    }

    /**
     * True while the transcript should show the stopped run: a Stop is pending and has not expired.
     * An expired Stop with a streaming server means the agent may be alive, so no overlay applies.
     */
    isStopOverlayActive(conversationId: string): boolean {
        const entry = this.blocks.get(conversationId);
        return entry !== undefined && !entry.expired;
    }

    /** True when the Stop expired and the server still streams: the Stop control is offered again. */
    isStopRetryable(conversationId: string): boolean {
        return this.blocks.get(conversationId)?.expired === true;
    }

    /**
     * Sequence marker to take before a GET starts. A GET whose answer arrives after
     * {@link settledSince} is true for its conversation may predate the Stop's acknowledgement
     * and must not repaint the run as working.
     */
    currentSequence(): number {
        return this.sequence;
    }

    settledSince(conversationId: string, sequenceAtStart: number): boolean {
        return (this.settledSequence.get(conversationId) ?? 0) > sequenceAtStart;
    }

    /**
     * The server reports that the conversation is no longer streaming. A pending Stop cannot end a
     * run that already ended: its request is aborted and Send is released. Returns `true` when a
     * block was released.
     */
    reportServerIdle(conversationId: string): boolean {
        const entry = this.blocks.get(conversationId);
        if (!entry) {
            return false;
        }
        entry.abort?.();
        this.blocks.delete(conversationId);
        this.markSettled(conversationId);
        return true;
    }

    /** Tracks one Stop request. Resolves with the outcome after `onSettled` ran. */
    async track(conversationId: string, request: Promise<unknown>, options: QaapStopAckOptions): Promise<QaapStopAckOutcome> {
        const token = ++this.sequence;
        this.blocks.set(conversationId, { token, abort: options.abort, expired: false });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expiry = new Promise<{ outcome: 'expired' }>(resolve => {
            timer = setTimeout(() => resolve({ outcome: 'expired' }), options.timeoutMs ?? QAAP_STOP_ACK_TIMEOUT_MS);
        });
        const answer = request.then(
            (): { outcome: 'acknowledged' } => ({ outcome: 'acknowledged' }),
            (error: unknown): { outcome: 'failed'; error: unknown } => ({ outcome: 'failed', error }),
        );
        const settled = await Promise.race([answer, expiry]);
        clearTimeout(timer);
        const isCurrent = (): boolean => this.blocks.get(conversationId)?.token === token;
        if (settled.outcome !== 'expired') {
            // A Stop superseded by a newer one settles silently: only the current Stop may restore UI state.
            const current = isCurrent();
            this.release(conversationId, token);
            this.markSettled(conversationId);
            if (current) {
                options.onSettled(settled.outcome, { error: settled.outcome === 'failed' ? settled.error : undefined, stillStreaming: false });
            }
            return settled.outcome;
        }
        const stillStreaming = await probeStillStreaming(options.isStillStreaming, options.probeTimeoutMs);
        if (!isCurrent()) {
            // A newer Stop took the block while this one was expiring: its answer must not touch the UI.
            void answer.then(late => options.onLateAnswer?.(late.outcome, late.outcome === 'failed' ? late.error : undefined));
            return 'expired';
        }
        if (stillStreaming) {
            this.markExpired(conversationId, token);
        } else {
            this.release(conversationId, token);
            this.markSettled(conversationId);
            options.abort?.();
        }
        options.onSettled('expired', { stillStreaming });
        void answer.then(late => {
            this.release(conversationId, token);
            this.markSettled(conversationId);
            options.onLateAnswer?.(late.outcome, late.outcome === 'failed' ? late.error : undefined);
        });
        return 'expired';
    }

    protected markExpired(conversationId: string, token: number): void {
        const entry = this.blocks.get(conversationId);
        if (entry?.token === token) {
            entry.expired = true;
        }
    }

    protected markSettled(conversationId: string): void {
        this.settledSequence.set(conversationId, ++this.sequence);
    }

    protected release(conversationId: string, token: number): void {
        if (this.blocks.get(conversationId)?.token === token) {
            this.blocks.delete(conversationId);
        }
    }
}

/** Asks the server once; a timeout or a failure answers `true`, so Send stays blocked. */
function probeStillStreaming(ask: () => Promise<boolean>, timeoutMs = QAAP_STOP_STATUS_PROBE_TIMEOUT_MS): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(true), timeoutMs);
        ask().then(
            streaming => { clearTimeout(timer); resolve(streaming); },
            () => { clearTimeout(timer); resolve(true); },
        );
    });
}

/** Shared by the composer (Send gating) and the Stop handlers (tracking). One tracker per browser page. */
export const qaapStopAck = new QaapStopAckTracker();
