// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAsyncConcurrencyLimiter } from './qaap-async-concurrency-limiter';

describe('QaapAsyncConcurrencyLimiter', () => {
    it('never runs more work than the configured limit and preserves queued order', async () => {
        const limiter = new QaapAsyncConcurrencyLimiter(3);
        const nextTurn = async (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
        const releases: Array<() => void> = [];
        const started: number[] = [];
        let active = 0;
        let maximumActive = 0;
        const jobs = Array.from({ length: 7 }, (_, index) => limiter.run(async () => {
            started.push(index);
            active++;
            maximumActive = Math.max(maximumActive, active);
            await new Promise<void>(resolve => releases.push(resolve));
            active--;
        }));

        await Promise.resolve();
        expect(started).to.deep.equal([0, 1, 2]);
        releases.shift()?.();
        await nextTurn();
        expect(started).to.deep.equal([0, 1, 2, 3]);

        while (releases.length > 0 || started.length < jobs.length) {
            releases.shift()?.();
            await nextTurn();
        }
        await Promise.all(jobs);
        expect(maximumActive).to.equal(3);
        expect(started).to.deep.equal([0, 1, 2, 3, 4, 5, 6]);
    });

    it('releases a permit when a task rejects', async () => {
        const limiter = new QaapAsyncConcurrencyLimiter(1);
        let error: unknown;
        try {
            await limiter.run(async () => { throw new Error('boom'); });
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('boom');
        expect(await limiter.run(async () => 'next')).to.equal('next');
    });
});
