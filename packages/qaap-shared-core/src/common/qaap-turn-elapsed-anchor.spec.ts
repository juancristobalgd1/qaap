// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { TurnElapsedAnchor } from './qaap-turn-elapsed-anchor';

describe('TurnElapsedAnchor', () => {
    it('counts from the turn start while streaming', () => {
        const anchor = new TurnElapsedAnchor();
        expect(anchor.resolveElapsedMs('c1', 1_000, true, 61_000)).to.equal(60_000);
    });

    it('never moves backwards when a relaunch reports a later start', () => {
        const anchor = new TurnElapsedAnchor();
        const first = anchor.resolveElapsedMs('c1', 0, true, 769_000);
        const relaunched = anchor.resolveElapsedMs('c1', 500_000, true, 770_000);
        expect(first).to.equal(769_000);
        expect(relaunched).to.be.at.least(first!);
        expect(relaunched).to.equal(770_000);
    });

    it('is monotonic across repeated ticks with a relaunch in between', () => {
        const anchor = new TurnElapsedAnchor();
        let previous = 0;
        for (let now = 1_000; now <= 900_000; now += 1_000) {
            const turnStart = now < 400_000 ? 0 : 400_000;
            const elapsed = anchor.resolveElapsedMs('c1', turnStart, true, now)!;
            expect(elapsed).to.be.at.least(previous);
            previous = elapsed;
        }
    });

    it('adopts an earlier start when one is observed', () => {
        const anchor = new TurnElapsedAnchor();
        anchor.resolveElapsedMs('c1', 5_000, true, 6_000);
        expect(anchor.resolveElapsedMs('c1', 2_000, true, 10_000)).to.equal(8_000);
    });

    it('restarts from zero after the conversation is observed idle', () => {
        const anchor = new TurnElapsedAnchor();
        anchor.resolveElapsedMs('c1', 0, true, 600_000);
        expect(anchor.resolveElapsedMs('c1', undefined, false, 601_000)).to.be.undefined;
        expect(anchor.resolveElapsedMs('c1', 700_000, true, 701_000)).to.equal(1_000);
    });

    it('keeps conversations independent', () => {
        const anchor = new TurnElapsedAnchor();
        anchor.resolveElapsedMs('a', 0, true, 1_000);
        expect(anchor.resolveElapsedMs('b', 900, true, 1_000)).to.equal(100);
    });

    it('clamps negative elapsed to zero when the clock is behind the start', () => {
        const anchor = new TurnElapsedAnchor();
        expect(anchor.resolveElapsedMs('c1', 10_000, true, 9_000)).to.equal(0);
    });
});
