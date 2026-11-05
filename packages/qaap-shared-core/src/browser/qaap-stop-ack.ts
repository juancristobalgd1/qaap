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

export interface QaapStopAckOptions {
    /** Asked at expiry: a conversation that still streams keeps Send blocked, because its stale cancel is not settled. */
    readonly isStillStreaming: () => boolean;
    /** Called once per Stop with the settled outcome; `error` is set for `failed`. */
    readonly onSettled: (outcome: QaapStopAckOutcome, error?: unknown) => void;
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
 * conversation no longer streams; otherwise Send stays blocked and the caller restores the Stop control,
 * so the user can retry the Stop (which tracks a new request). A late answer releases Send only if no
 * newer Stop has taken the block over.
 */
export class QaapStopAckTracker {

    protected readonly blocks = new Map<string, number>();
    protected sequence = 0;

    isSendBlocked(conversationId: string): boolean {
        return this.blocks.has(conversationId);
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
            options.onSettled(settled.outcome, settled.outcome === 'failed' ? settled.error : undefined);
            return settled.outcome;
        }
        if (!options.isStillStreaming()) {
            this.release(conversationId, token);
        }
        options.onSettled('expired');
        void answer.then(late => {
            this.release(conversationId, token);
            options.onLateAnswer?.(late.outcome, late.outcome === 'failed' ? late.error : undefined);
        });
        return 'expired';
    }

    protected release(conversationId: string, token: number): void {
        if (this.blocks.get(conversationId) === token) {
            this.blocks.delete(conversationId);
        }
    }
}

/** Shared by the composer (Send gating) and the Stop handlers (tracking). One tracker per browser page. */
export const qaapStopAck = new QaapStopAckTracker();
