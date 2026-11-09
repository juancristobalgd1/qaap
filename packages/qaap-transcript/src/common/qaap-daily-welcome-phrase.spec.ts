// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_DAILY_WELCOME_PHRASES, qaapDailyWelcomePhraseIndex, qaapLocalDayNumber } from './qaap-daily-welcome-phrase';

describe('qaap daily welcome phrase', () => {
    const count = QAAP_DAILY_WELCOME_PHRASES.length;
    /** Local noon of the day `offset` days after 2026-11-09, away from any DST edge. */
    const day = (offset: number): Date => new Date(2026, 10, 9 + offset, 12, 0, 0);

    it('has no duplicate phrases', () => {
        expect(new Set(QAAP_DAILY_WELCOME_PHRASES).size).to.equal(count);
    });

    it('keeps the same phrase for the whole local day', () => {
        const morning = new Date(2026, 10, 9, 0, 1, 0);
        const night = new Date(2026, 10, 9, 23, 59, 0);
        expect(qaapLocalDayNumber(morning)).to.equal(qaapLocalDayNumber(night));
        expect(qaapDailyWelcomePhraseIndex(morning)).to.equal(qaapDailyWelcomePhraseIndex(night));
    });

    it('shows every phrase exactly once per cycle, then starts again', () => {
        const start = qaapLocalDayNumber(day(0));
        const cycleStart = Math.ceil(start / count) * count - start;
        for (const cycle of [0, 1, 2]) {
            const seen = new Set<number>();
            for (let i = 0; i < count; i++) {
                seen.add(qaapDailyWelcomePhraseIndex(day(cycleStart + cycle * count + i)));
            }
            expect(seen.size, `cycle ${cycle}`).to.equal(count);
        }
    });

    it('changes the order between cycles and never repeats a phrase on consecutive days', () => {
        const start = qaapLocalDayNumber(day(0));
        const cycleStart = Math.ceil(start / count) * count - start;
        const orderOf = (cycle: number): number[] =>
            Array.from({ length: count }, (_, i) => qaapDailyWelcomePhraseIndex(day(cycleStart + cycle * count + i)));
        expect(orderOf(0)).to.not.deep.equal(orderOf(1));
        let previous = qaapDailyWelcomePhraseIndex(day(0));
        for (let offset = 1; offset < count * 4; offset++) {
            const current = qaapDailyWelcomePhraseIndex(day(offset));
            expect(current, `day +${offset}`).to.not.equal(previous);
            previous = current;
        }
    });
});
