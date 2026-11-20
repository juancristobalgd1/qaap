// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The line under the logo on an empty chat: one phrase per calendar day. Each cycle walks every
 * phrase once in a shuffled order (seeded by the cycle number, so it needs no storage and is the
 * same on every device), then a new cycle starts with a different order.
 */
export const QAAP_DAILY_WELCOME_PHRASES: readonly string[] = [
    'The world is a work in progress.',
    'There are worlds left to make.',
    'Reality has a few bugs.',
    'Make the world question itself.',
    'The ordinary can wait.',
    'Be the reason things change.',
    'Reality is open source.',
    'God left the source code unfinished.',
    '404: Limits not found.',
    'Defy the default.',
    'Disobey the possible.',
    'The end is editable.',
    'The future is already outdated.',
    'Everything is possible.',
    'The beginning has no end.',
    'We debug the impossible.',
    'The only constant is a pending update.',
    'Existence is an editable file.',
    "Yesterday's impossible is today's legacy.",
    'The future has a past.',
    'Time is just another variable.',
    'Nothing ages faster than the future.',
    'Infinity has room for more.',
    'An infinite loop can still go somewhere.',
    'Nothing is final.',
    'Impossible is relative.',
    'Reality is mutable.',
    'The void has potential.',
    'Infinite, by design.',
    'The end is a beginning.',
    'Dreams are executable.',
    'Reality has no owner.',
    'Reality is still in beta.',
    'To define is to limit.',
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since 1970-01-01 for the local calendar date of `date` (changes at local midnight). */
export function qaapLocalDayNumber(date: Date): number {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** Deterministic shuffle of `0..count-1` for one cycle (mulberry32 + Fisher–Yates). */
function cycleOrder(cycle: number, count: number): number[] {
    let seed = (cycle * 0x9e3779b1) >>> 0;
    const random = (): number => {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const order = Array.from({ length: count }, (_, index) => index);
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/** A cycle's order, adjusted so it never opens with the phrase the previous cycle ended on. */
function cycleOrderWithoutSeamRepeat(cycle: number, count: number): number[] {
    const order = cycleOrder(cycle, count);
    if (count > 1) {
        const previous = cycleOrder(cycle - 1, count);
        if (order[0] === previous[count - 1]) {
            [order[0], order[1]] = [order[1], order[0]];
        }
    }
    return order;
}

/** Index into {@link QAAP_DAILY_WELCOME_PHRASES} for the local day of `date`. */
export function qaapDailyWelcomePhraseIndex(date: Date = new Date(), count: number = QAAP_DAILY_WELCOME_PHRASES.length): number {
    if (count <= 1) {
        return 0;
    }
    const day = qaapLocalDayNumber(date);
    const cycle = Math.floor(day / count);
    const position = day - cycle * count;
    return cycleOrderWithoutSeamRepeat(cycle, count)[position];
}
