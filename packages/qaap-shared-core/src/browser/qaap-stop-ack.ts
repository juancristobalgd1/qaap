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
    readonly timeoutMs?: number;
}

/**
 * Tracks the Stop requests in flight per conversation. While a Stop is unacknowledged, Send for that
 * conversation is blocked: the agent may still be alive, and a cancel that reaches the server late
 * could end the next turn the user just sent.
 *
 * Release rules: an acknowledgement or a failure releases Send. An expiry releases Send only when the
 * server no longer reports the conversation as streaming; otherwise Send stays blocked and the caller
 * restores the Stop control, so the user can retry the Stop (which tracks a new request). A late answer
 * releases Send only if no newer Stop has taken the block over.
 */
export class QaapStopAckTracker {

    protected readonly blocks = new Map<string, number>();
    /** Sequence number of the last Stop that settled (released its block or answered) per conversation. */
    protected readonly settledSequence = new Map<string, number>();
    protected sequence = 0;

    isSendBlocked(conversationId: string): boolean {
        return this.blocks.has(conversationId);
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

    /** Tracks one Stop request. Resolves with the outcome after `onSettled` ran. */
    async track(conversationId: string, request: Promise<unknown>, options: QaapStopAckOptions): Promise<QaapStopAckOutcome> {
        const token = ++this.sequence;
        this.blocks.set(conversationId, token);
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
        if (settled.outcome !== 'expired') {
            this.release(conversationId, token);
            this.markSettled(conversationId);
            options.onSettled(settled.outcome, { error: settled.outcome === 'failed' ? settled.error : undefined, stillStreaming: false });
            return settled.outcome;
        }
        const stillStreaming = await options.isStillStreaming().catch(() => true);
        if (!stillStreaming) {
            this.release(conversationId, token);
            this.markSettled(conversationId);
        }
        options.onSettled('expired', { stillStreaming });
        void answer.then(late => {
            this.release(conversationId, token);
            this.markSettled(conversationId);
            options.onLateAnswer?.(late.outcome, late.outcome === 'failed' ? late.error : undefined);
        });
        return 'expired';
    }

    protected markSettled(conversationId: string): void {
        this.settledSequence.set(conversationId, ++this.sequence);
    }

    protected release(conversationId: string, token: number): void {
        if (this.blocks.get(conversationId) === token) {
            this.blocks.delete(conversationId);
        }
    }
}

/** Shared by the composer (Send gating) and the Stop handlers (tracking). One tracker per browser page. */
export const qaapStopAck = new QaapStopAckTracker();
