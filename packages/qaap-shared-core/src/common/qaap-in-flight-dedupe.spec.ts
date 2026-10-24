// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { dedupeInFlight } from './qaap-in-flight-dedupe';

describe('dedupeInFlight', () => {
    it('shares one run between concurrent callers with the same key', async () => {
        const inFlight = new Map<string, Promise<number>>();
        let runs = 0;
        const run = (): Promise<number> => new Promise<number>(resolve => {
            runs++;
            setTimeout(() => resolve(42), 5);
        });
        const [a, b] = await Promise.all([
            dedupeInFlight(inFlight, 'k', run),
            dedupeInFlight(inFlight, 'k', run),
        ]);
        expect(runs).to.equal(1);
        expect(a).to.equal(42);
        expect(b).to.equal(42);
    });

    it('runs again after the previous call settled', async () => {
        const inFlight = new Map<string, Promise<number>>();
        let runs = 0;
        const run = async (): Promise<number> => ++runs;
        expect(await dedupeInFlight(inFlight, 'k', run)).to.equal(1);
        expect(await dedupeInFlight(inFlight, 'k', run)).to.equal(2);
        expect(inFlight.size).to.equal(0);
    });

    it('keeps different keys independent', async () => {
        const inFlight = new Map<string, Promise<string>>();
        const [a, b] = await Promise.all([
            dedupeInFlight(inFlight, 'a', async () => 'A'),
            dedupeInFlight(inFlight, 'b', async () => 'B'),
        ]);
        expect(a).to.equal('A');
        expect(b).to.equal('B');
    });

    it('releases the key when the run rejects, and propagates the error', async () => {
        const inFlight = new Map<string, Promise<number>>();
        let failed = false;
        try {
            await dedupeInFlight(inFlight, 'k', async () => { throw new Error('boom'); });
        } catch {
            failed = true;
        }
        expect(failed).to.equal(true);
        expect(inFlight.size).to.equal(0);
        expect(await dedupeInFlight(inFlight, 'k', async () => 7)).to.equal(7);
    });
});
