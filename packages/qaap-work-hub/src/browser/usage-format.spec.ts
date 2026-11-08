// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { UsageNumberFormat } from './usage-format';

describe('UsageNumberFormat', () => {

    const format = new UsageNumberFormat();

    it('formats dollars with two decimals', () => {
        expect(format.formatUsd(9.38)).to.equal('$9.38');
        expect(format.formatUsd(1234.5)).to.equal('$1,234.50');
        expect(format.formatUsd(0)).to.equal('$0.00');
        expect(format.formatUsd(Number.NaN)).to.equal('$0.00');
    });

    it('abbreviates token counts', () => {
        expect(format.formatTokens(9_380_000_000)).to.equal('9.38B');
        expect(format.formatTokens(505_000_000)).to.equal('505M');
        expect(format.formatTokens(18_000)).to.equal('18K');
        expect(format.formatTokens(999)).to.equal('999');
        expect(format.formatTokens(1_234_567)).to.equal('1.23M');
        expect(format.formatTokens(-5)).to.equal('-5');
    });

    it('formats integers with separators', () => {
        expect(format.formatInteger(1204)).to.equal('1,204');
    });

    it('clamps percentages and handles a zero total', () => {
        expect(format.formatPercent(42.4)).to.equal('42%');
        expect(format.formatPercent(150)).to.equal('100%');
        expect(format.formatPercent(-3)).to.equal('0%');
        expect(format.formatShare(1, 4)).to.equal('25%');
        expect(format.formatShare(1, 0)).to.equal('0%');
    });

    it('formats reset countdowns at each scale', () => {
        const now = Date.parse('2026-11-08T10:00:00.000Z');
        expect(format.formatResetCountdown('2026-11-13T11:00:00.000Z', now)).to.equal('5d 1h');
        expect(format.formatResetCountdown('2026-11-08T13:20:00.000Z', now)).to.equal('3h 20m');
        expect(format.formatResetCountdown('2026-11-08T10:12:00.000Z', now)).to.equal('12m');
        expect(format.formatResetCountdown('2026-11-08T10:00:10.000Z', now)).to.equal('1m');
        expect(format.formatResetCountdown('2026-11-08T09:00:00.000Z', now)).to.equal('now');
    });

    it('returns undefined for a missing or invalid reset time', () => {
        const now = Date.now();
        expect(format.formatResetCountdown(undefined, now)).to.equal(undefined);
        expect(format.formatResetCountdown('not a date', now)).to.equal(undefined);
    });
});
