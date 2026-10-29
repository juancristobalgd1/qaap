// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';

export type QaapToolGateAskOutcome = 'approve' | 'reject' | 'ttl' | 'cancelled';

interface PendingAsk {
    readonly request: QaapQaiqPendingControlRequest;
    readonly settle: (outcome: QaapToolGateAskOutcome) => void;
}

/**
 * Pending "ask" decisions raised by harness adapters over the tool gate. They are surfaced as the
 * same approval cards as QAIQ's control requests (the approval store lists {@link list} and answers
 * through {@link respond}); only an authenticated approve or reject, a TTL or a cancel settles one.
 */
@injectable()
export class QaapToolGateAskBroker {

    protected readonly pending = new Map<string, PendingAsk[]>();

    /**
     * Wait for a human answer. Resolves `ttl` after `ttlMs` (timeout means deny) and `cancelled` when
     * `signal` aborts or the task is cancelled.
     */
    ask(taskId: string, request: QaapQaiqPendingControlRequest, ttlMs: number, signal?: AbortSignal): Promise<QaapToolGateAskOutcome> {
        return new Promise<QaapToolGateAskOutcome>(resolve => {
            let done = false;
            let timer: NodeJS.Timeout | undefined;
            const entry: PendingAsk = { request, settle: outcome => finish(outcome) };
            const finish = (outcome: QaapToolGateAskOutcome): void => {
                if (done) {
                    return;
                }
                done = true;
                if (timer) {
                    clearTimeout(timer);
                }
                signal?.removeEventListener('abort', onAbort);
                const list = this.pending.get(taskId);
                if (list) {
                    const index = list.indexOf(entry);
                    if (index >= 0) {
                        list.splice(index, 1);
                    }
                    if (!list.length) {
                        this.pending.delete(taskId);
                    }
                }
                resolve(outcome);
            };
            const onAbort = (): void => finish('cancelled');
            if (signal?.aborted) {
                resolve('cancelled');
                return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => finish('ttl'), ttlMs);
            timer.unref?.();
            const list = this.pending.get(taskId) ?? [];
            list.push(entry);
            this.pending.set(taskId, list);
        });
    }

    list(taskId: string): readonly QaapQaiqPendingControlRequest[] {
        return (this.pending.get(taskId) ?? []).map(entry => entry.request);
    }

    count(taskId: string): number {
        return this.pending.get(taskId)?.length ?? 0;
    }

    /** Answer the ask with this tool-use id (or request id). Returns false when none is pending. */
    respond(taskId: string, action: 'approve' | 'reject', toolUseId: string | undefined): boolean {
        const entry = (this.pending.get(taskId) ?? []).find(candidate =>
            toolUseId !== undefined && (candidate.request.toolUseId === toolUseId || candidate.request.requestId === toolUseId));
        if (!entry) {
            return false;
        }
        entry.settle(action);
        return true;
    }

    /** Deny everything still waiting for a task (task ended or was cancelled). */
    cancelTask(taskId: string): void {
        for (const entry of [...(this.pending.get(taskId) ?? [])]) {
            entry.settle('cancelled');
        }
    }
}
