// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Dollar amount with two decimals, e.g. `$9.38`. */
export class UsageNumberFormat {

    formatUsd(value: number): string {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
            .format(finiteOrZero(value));
    }

    /** Abbreviated token count: `9.38B`, `505M`, `18K`, `999`. */
    formatTokens(value: number): string {
        const count = finiteOrZero(value);
        const units: Array<{ size: number; suffix: string }> = [
            { size: 1e9, suffix: 'B' },
            { size: 1e6, suffix: 'M' },
            { size: 1e3, suffix: 'K' }
        ];
        for (const unit of units) {
            if (Math.abs(count) >= unit.size) {
                const scaled = count / unit.size;
                const digits = Math.abs(scaled) < 10 ? 2 : Math.abs(scaled) < 100 ? 1 : 0;
                return `${Number(scaled.toFixed(digits))}${unit.suffix}`;
            }
        }
        return String(Math.round(count));
    }

    /** Full integer with thousands separators, e.g. `1,204`. */
    formatInteger(value: number): string {
        return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(finiteOrZero(value));
    }

    /** Whole percentage, clamped to 0..100. */
    formatPercent(value: number): string {
        const clamped = Math.min(100, Math.max(0, finiteOrZero(value)));
        return `${Math.round(clamped)}%`;
    }

    /** Share of a total as a whole percentage. A zero total yields `0%`. */
    formatShare(part: number, total: number): string {
        return total > 0 ? this.formatPercent((finiteOrZero(part) / total) * 100) : '0%';
    }

    /**
     * Countdown to a reset time, e.g. `5d 1h`, `3h 20m`, `12m`. Returns `undefined` when the
     * reset time is missing or unparsable, and `now` once it has passed.
     */
    formatResetCountdown(resetsAt: string | undefined, now: number): string | undefined {
        if (!resetsAt) {
            return undefined;
        }
        const target = Date.parse(resetsAt);
        if (Number.isNaN(target)) {
            return undefined;
        }
        const remaining = target - now;
        if (remaining <= 0) {
            return 'now';
        }
        const days = Math.floor(remaining / DAY_MS);
        const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
        const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);
        if (days > 0) {
            return `${days}d ${hours}h`;
        }
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${Math.max(1, minutes)}m`;
    }
}

function finiteOrZero(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
