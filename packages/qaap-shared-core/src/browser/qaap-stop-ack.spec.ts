// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapStopAckTracker, type QaapStopAckOutcome } from './qaap-stop-ack';

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function deferred(): { promise: Promise<unknown>; resolve: () => void; reject: (error: unknown) => void } {
    let resolve: () => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((res, rej) => { resolve = () => res(undefined); reject = rej; });
    return { promise, resolve, reject };
}

describe('QaapStopAckTracker', () => {

    it('blocks Send while the Stop is unacknowledged and releases it on the acknowledgement', async () => {
        const tracker = new QaapStopAckTracker();
        const request = deferred();
        const settled: QaapStopAckOutcome[] = [];
        const done = tracker.track('c1', request.promise, { isStillStreaming: async () => true, onSettled: outcome => settled.push(outcome) });

        expect(tracker.isSendBlocked('c1')).to.equal(true);
        expect(tracker.isSendBlocked('c2')).to.equal(false);
        request.resolve();

        expect(await done).to.equal('acknowledged');
        expect(tracker.isSendBlocked('c1')).to.equal(false);
        expect(settled).to.deep.equal(['acknowledged']);
    });

    it('releases Send on a failed Stop and reports the error for the restored Stop state', async () => {
        const tracker = new QaapStopAckTracker();
        const request = deferred();
        const failure = new Error('HTTP 503');
        let reported: unknown;
        const done = tracker.track('c1', request.promise, {
            isStillStreaming: async () => true,
            onSettled: (outcome, detail) => { reported = outcome === 'failed' ? detail.error : undefined; },
        });
        request.reject(failure);

        expect(await done).to.equal('failed');
        expect(reported).to.equal(failure);
        expect(tracker.isSendBlocked('c1')).to.equal(false);
    });

    it('keeps Send blocked when the Stop expires while the conversation still streams, and releases it on a late answer', async () => {
        const tracker = new QaapStopAckTracker();
        const request = deferred();
        const settled: QaapStopAckOutcome[] = [];
        const late: QaapStopAckOutcome[] = [];
        const done = tracker.track('c1', request.promise, {
            isStillStreaming: async () => true,
            timeoutMs: 5,
            onSettled: outcome => settled.push(outcome),
            onLateAnswer: outcome => late.push(outcome),
        });

        expect(await done).to.equal('expired');
        expect(tracker.isSendBlocked('c1')).to.equal(true);
        expect(settled).to.deep.equal(['expired']);

        request.resolve();
        await wait(5);
        expect(tracker.isSendBlocked('c1')).to.equal(false);
        expect(late).to.deep.equal(['acknowledged']);
    });

    it('releases Send at expiry when the conversation is no longer streaming', async () => {
        const tracker = new QaapStopAckTracker();
        const done = tracker.track('c1', new Promise(() => undefined), {
            isStillStreaming: async () => false,
            timeoutMs: 5,
            onSettled: () => undefined,
        });

        expect(await done).to.equal('expired');
        expect(tracker.isSendBlocked('c1')).to.equal(false);
    });

    it('does not let an expired request release the block of a newer Stop', async () => {
        const tracker = new QaapStopAckTracker();
        const first = deferred();
        const second = deferred();
        await tracker.track('c1', first.promise, { isStillStreaming: async () => true, timeoutMs: 5, onSettled: () => undefined });
        const retry = tracker.track('c1', second.promise, { isStillStreaming: async () => true, onSettled: () => undefined });

        first.resolve();
        await wait(5);
        expect(tracker.isSendBlocked('c1')).to.equal(true);

        second.resolve();
        expect(await retry).to.equal('acknowledged');
        expect(tracker.isSendBlocked('c1')).to.equal(false);
    });

    it('reports a settle after a sequence marker so a GET started before the acknowledgement is recognised', async () => {
        const tracker = new QaapStopAckTracker();
        const request = deferred();
        const before = tracker.currentSequence();
        expect(tracker.settledSince('c1', before)).to.equal(false);
        const done = tracker.track('c1', request.promise, { isStillStreaming: async () => true, onSettled: () => undefined });
        request.resolve();
        await done;

        expect(tracker.settledSince('c1', before)).to.equal(true);
        expect(tracker.settledSince('c2', before)).to.equal(false);
        expect(tracker.settledSince('c1', tracker.currentSequence())).to.equal(false);
    });

    it('makes the Stop retryable after expiry while the server streams, and keeps Send blocked', async () => {
        const tracker = new QaapStopAckTracker();
        const request = deferred();
        const settled: QaapStopAckOutcome[] = [];
        const done = tracker.track('c1', request.promise, {
            isStillStreaming: async () => true,
            onSettled: outcome => settled.push(outcome),
            timeoutMs: 5,
        });

        expect(await done).to.equal('expired');
        expect(tracker.isSendBlocked('c1')).to.equal(true);
        expect(tracker.isStopRetryable('c1')).to.equal(true);
        expect(settled).to.deep.equal(['expired']);
    });

    it('aborts the pending Stop and releases Send when the server reports the run ended', async () => {
        const tracker = new QaapStopAckTracker();
        const request = deferred();
        let aborted = 0;
        const done = tracker.track('c1', request.promise, {
            isStillStreaming: async () => true,
            onSettled: () => undefined,
            abort: () => { aborted += 1; },
            timeoutMs: 5,
        });
        await done;

        expect(tracker.reportServerIdle('c1')).to.equal(true);
        expect(aborted).to.equal(1);
        expect(tracker.isSendBlocked('c1')).to.equal(false);
        expect(tracker.isStopRetryable('c1')).to.equal(false);
        expect(tracker.reportServerIdle('c1')).to.equal(false);
    });

    it('keeps Send blocked when the expiry probe does not answer in time', async () => {
        const tracker = new QaapStopAckTracker();
        const request = deferred();
        let aborted = 0;
        const done = tracker.track('c1', request.promise, {
            isStillStreaming: () => new Promise<boolean>(() => undefined),
            onSettled: () => undefined,
            abort: () => { aborted += 1; },
            timeoutMs: 5,
            probeTimeoutMs: 5,
        });
        const outcome = await done;

        expect(outcome).to.equal('expired');
        expect(aborted).to.equal(0);
        expect(tracker.isSendBlocked('c1')).to.equal(true);
    });
});
