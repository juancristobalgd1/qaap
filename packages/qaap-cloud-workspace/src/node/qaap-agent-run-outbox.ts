// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { randomUUID } from 'crypto';
import { QaapAgentEffect, QaapAgentLedgerReconcileResult, QaapAgentRunLedger, QaapAgentRunRow } from './qaap-agent-run-ledger';

/** Executes one claimed effect. Throwing retries it (with backoff) when the kind allows retries. */
export type QaapAgentEffectHandler = (effect: QaapAgentEffect) => Promise<void>;

export interface QaapAgentEffectHandlerOptions {
    /** Retry a thrown handler with backoff (default true). Process kinds should not retry blindly. */
    readonly retry?: boolean;
}

export interface QaapAgentRunOutboxOptions {
    readonly ledger: QaapAgentRunLedger;
    /** Lease owner written on claimed rows; one per backend process (boot id). */
    readonly leaseOwner?: string;
    /** Clock, injectable so specs never sleep through a backoff. */
    readonly now?: () => number;
}

/** A lost run the conversation layer may continue (`turn.continue`). */
export interface QaapAgentTurnContinuationRequest {
    readonly runId: string;
    readonly ownerLogin?: string;
    readonly conversationId?: string;
}

/**
 * Continues a lost turn (the conversation store rebuilds its prompt). It may decline (e.g. the
 * turn was waiting on a human); the runner checks afterwards whether a continuation exists.
 */
export type QaapAgentTurnContinuationHandler = (request: QaapAgentTurnContinuationRequest) => Promise<unknown>;

/** Eligibility inputs for an automatic restart continuation. */
export interface QaapAgentRestartContinuationPolicy {
    readonly enabled: boolean;
    readonly maxResumes: number;
}

/**
 * Durable effect worker for the agent-run ledger (T3 Code `EffectWorker` pattern, without Effect).
 *
 * One pump claims effects with `UPDATE … RETURNING` until nothing is runnable and starts each
 * handler without awaiting it, so a slow effect never blocks other threads; per-thread FIFO is
 * enforced by the claim itself. A handler that throws is retried with
 * `min(30 s, 100 ms · 2^(attempt-1))` backoff, at most {@link QaapAgentRunOutbox.MAX_ATTEMPTS}
 * times. {@link drain} runs the pump to quiescence for specs, without sleeping.
 */
export class QaapAgentRunOutbox {

    static readonly MAX_ATTEMPTS = 5;
    static readonly BASE_BACKOFF_MS = 100;
    static readonly MAX_BACKOFF_MS = 30_000;

    readonly leaseOwner: string;
    protected readonly ledger: QaapAgentRunLedger;
    protected readonly now: () => number;
    protected readonly handlers = new Map<string, { handler: QaapAgentEffectHandler; retry: boolean }>();
    protected readonly inFlight = new Map<string, Promise<void>>();
    protected pumpScheduled = false;
    protected wakeTimer: ReturnType<typeof setTimeout> | undefined;
    protected stopped = false;

    constructor(options: QaapAgentRunOutboxOptions) {
        this.ledger = options.ledger;
        this.leaseOwner = options.leaseOwner ?? `boot:${randomUUID()}`;
        this.now = options.now ?? Date.now;
    }

    /** Registers the handler for a kind. Effects of kinds without a handler stay `pending`. */
    register(kind: string, handler: QaapAgentEffectHandler, options: QaapAgentEffectHandlerOptions = {}): void {
        this.handlers.set(kind, { handler, retry: options.retry ?? true });
        this.kick();
    }

    hasHandler(kind: string): boolean {
        return this.handlers.has(kind);
    }

    /** True while an effect with this id is claimed by this worker and its handler runs. */
    isInFlight(effectId: string): boolean {
        return this.inFlight.has(effectId);
    }

    /** Schedules a pump on the next tick (coalesced). */
    kick(): void {
        if (this.stopped || this.pumpScheduled) {
            return;
        }
        this.pumpScheduled = true;
        setImmediate(() => {
            this.pumpScheduled = false;
            this.pump();
        });
    }

    /** Runs every effect that is runnable now, including those its handlers enqueue, then resolves. */
    async drain(): Promise<void> {
        for (;;) {
            this.pump();
            if (this.inFlight.size === 0) {
                return;
            }
            await Promise.all([...this.inFlight.values()]);
        }
    }

    stop(): void {
        this.stopped = true;
        if (this.wakeTimer) {
            clearTimeout(this.wakeTimer);
            this.wakeTimer = undefined;
        }
    }

    /** Claims and starts every runnable effect. Synchronous: claims never interleave. */
    protected pump(): void {
        if (this.stopped) {
            return;
        }
        const kinds = [...this.handlers.keys()];
        for (;;) {
            let effect: QaapAgentEffect | undefined;
            try {
                effect = this.ledger.claimNextEffect(this.leaseOwner, this.now(), kinds);
            } catch (error) {
                console.warn('[qaap-agent-outbox] claim failed; retrying later.', error instanceof Error ? error.message : error);
                this.scheduleWake(this.now() + QaapAgentRunOutbox.BASE_BACKOFF_MS);
                return;
            }
            if (!effect) {
                break;
            }
            this.start(effect);
        }
        this.scheduleWake(this.ledger.nextEffectAvailableAt(kinds));
    }

    protected start(effect: QaapAgentEffect): void {
        const registration = this.handlers.get(effect.kind);
        // Deferred one microtask so the effect is registered as in flight before its handler runs
        // (a handler may synchronously ask `isInFlight` about its own effect).
        const running = Promise.resolve().then(async () => {
            try {
                if (!registration) {
                    throw new Error(`No handler for outbox effect kind ${effect.kind}.`);
                }
                await registration.handler(effect);
                this.ledger.settleEffect(effect.effectId, this.leaseOwner, { status: 'succeeded' });
            } catch (error) {
                this.settleFailure(effect, registration?.retry ?? false, error);
            }
        }).finally(() => {
            this.inFlight.delete(effect.effectId);
            this.kick();
        });
        this.inFlight.set(effect.effectId, running);
    }

    protected settleFailure(effect: QaapAgentEffect, retry: boolean, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = effect.attemptCount ?? 1;
        try {
            if (retry && attempts < QaapAgentRunOutbox.MAX_ATTEMPTS) {
                this.ledger.settleEffect(effect.effectId, this.leaseOwner, {
                    status: 'pending',
                    availableAt: this.now() + QaapAgentRunOutbox.backoffMs(attempts),
                    error: message,
                });
            } else {
                this.ledger.settleEffect(effect.effectId, this.leaseOwner, { status: 'failed', error: message });
                console.warn(`[qaap-agent-outbox] effect ${effect.effectId} failed after ${attempts} attempt(s): ${message}`);
            }
        } catch (settleError) {
            console.warn('[qaap-agent-outbox] could not settle a failed effect.', settleError instanceof Error ? settleError.message : settleError);
        }
    }

    protected scheduleWake(at: number | undefined): void {
        if (this.wakeTimer) {
            clearTimeout(this.wakeTimer);
            this.wakeTimer = undefined;
        }
        if (at === undefined || this.stopped) {
            return;
        }
        // Capped: a far `available_at` (or a clock jump) is simply re-checked later.
        const delay = Math.min(QaapAgentRunOutbox.MAX_BACKOFF_MS, Math.max(0, at - this.now()));
        if (delay === 0) {
            // Due now but blocked by a running effect of its thread: that effect's completion kicks.
            return;
        }
        this.wakeTimer = setTimeout(() => {
            this.wakeTimer = undefined;
            this.kick();
        }, delay);
        this.wakeTimer.unref?.();
    }
}

export namespace QaapAgentRunOutbox {
    /** Starts the agent process for a run (create or queue promotion). Bound to a live process. */
    export const TURN_START = 'turn.start';
    /** Continues a run the previous backend process lost. Bound to a live process. */
    export const TURN_CONTINUE = 'turn.continue';
    /** Safe to repeat: no producer yet; reserved so reconciliation requeues them instead of cancelling. */
    export const CHECKPOINT_CAPTURE = 'checkpoint.capture';
    export const PUSH_NOTIFY = 'push.notify';
    export const SUBTASK_DELIVER = 'subtask.deliver';

    /** Kinds whose `running` rows are cancelled, never replayed, after a process loss. */
    export const PROCESS_KINDS: readonly string[] = [TURN_START, TURN_CONTINUE];

    export function backoffMs(attempt: number): number {
        return Math.min(QaapAgentRunOutbox.MAX_BACKOFF_MS, QaapAgentRunOutbox.BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
    }

    export function turnStartEffectId(runId: string): string {
        return `turn-start:${runId}`;
    }

    /** Deterministic: reconciling the same lost run twice never enqueues a second continuation. */
    export function restartContinuationEffectId(runId: string): string {
        return `restart-continuation:${runId}`;
    }

    /**
     * The continuation for a run lost with the previous process, or undefined when it must not
     * continue on its own: delegated child runs (the parent owns them), runs that may wait on a
     * human (plan/ask mode, manual approval; recorded as `continuable` when the run started) and
     * runs that already spent the restart budget.
     */
    export function restartContinuation(run: QaapAgentRunRow, policy: QaapAgentRestartContinuationPolicy): QaapAgentEffect | undefined {
        if (!policy.enabled || run.parentRunId || run.continuable !== true || (run.resumeCount ?? 0) >= policy.maxResumes) {
            return undefined;
        }
        return {
            effectId: restartContinuationEffectId(run.runId),
            runId: run.runId,
            owner: run.owner,
            kind: TURN_CONTINUE,
            threadKey: run.conversationId ?? run.runId,
            payload: { version: 1, reason: 'restart' },
        };
    }

    /** {@link QaapAgentRunLedger.reconcileAfterProcessLoss} with the outbox's kinds and continuation policy. */
    export function reconcileAfterProcessLoss(
        ledger: QaapAgentRunLedger, policy: QaapAgentRestartContinuationPolicy, now = Date.now(),
    ): QaapAgentLedgerReconcileResult {
        return ledger.reconcileAfterProcessLoss({
            now,
            processKinds: PROCESS_KINDS,
            continuation: run => restartContinuation(run, policy),
        });
    }
}
