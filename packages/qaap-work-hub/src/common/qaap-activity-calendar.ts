// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Intensity of one grid cell: 0 is an empty day, 1 the lightest and 4 the busiest quartile. */
export type QaapActivityLevel = 0 | 1 | 2 | 3 | 4;

/** One local calendar day of the activity grid. */
export interface QaapActivityDay {
    /** Local midnight of the day. */
    readonly date: Date;
    readonly count: number;
    readonly level: QaapActivityLevel;
    /** Day after `now`: rendered empty and without a tooltip. */
    readonly future: boolean;
}

/** One grid column: seven rows, Sunday first. `undefined` pads the days before Jan 1 and after Dec 31. */
export type QaapActivityWeek = ReadonlyArray<QaapActivityDay | undefined>;

/** Month name shown above the column that holds the 1st of that month. */
export interface QaapActivityMonthLabel {
    readonly weekIndex: number;
    /** Zero-based month, as in `Date#getMonth`. */
    readonly monthIndex: number;
}

/** Contribution grid for one calendar year, with the years the selector can offer. */
export interface QaapActivityCalendar {
    readonly year: number;
    /** Contributions on the days of `year` up to `now`. */
    readonly totalCount: number;
    /** Years that have data, plus `year` and the current year, newest first. */
    readonly years: ReadonlyArray<number>;
    readonly weeks: ReadonlyArray<QaapActivityWeek>;
    readonly monthLabels: ReadonlyArray<QaapActivityMonthLabel>;
}

/** A conversation as far as the activity calendar needs it. */
export interface QaapActivityConversationTimes {
    readonly createdAt: number;
    readonly updatedAt: number;
}

const DAYS_PER_WEEK = 7;
const LEVEL_COUNT = 4;

function pad(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

function localDayKey(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysInYear(year: number): number {
    return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
}

/**
 * Timestamps that count as contributions for the calendar: each conversation contributes its
 * start, plus its last update when that falls on a different local day. Counting a conversation
 * once per day keeps a long thread from dominating the grid.
 */
export function collectQaapActivityTimestamps(conversations: ReadonlyArray<QaapActivityConversationTimes>): number[] {
    const timestamps: number[] = [];
    for (const conversation of conversations) {
        if (!Number.isFinite(conversation.createdAt)) {
            continue;
        }
        timestamps.push(conversation.createdAt);
        if (Number.isFinite(conversation.updatedAt)
            && localDayKey(new Date(conversation.updatedAt)) !== localDayKey(new Date(conversation.createdAt))) {
            timestamps.push(conversation.updatedAt);
        }
    }
    return timestamps;
}

/**
 * Builds the GitHub-style contribution grid for `year`. Weeks start on Sunday, every column has
 * seven rows, and cell levels are quartiles of the non-zero days of that year. Timestamps on days
 * after `now` are ignored so the grid and its total agree.
 */
export function buildQaapActivityCalendar(
    timestamps: ReadonlyArray<number>,
    year: number,
    now: Date,
): QaapActivityCalendar {
    const todayKey = localDayKey(now);
    const counts = new Map<string, number>();
    const knownYears = new Set<number>([year, now.getFullYear()]);
    for (const timestamp of timestamps) {
        if (!Number.isFinite(timestamp)) {
            continue;
        }
        const date = new Date(timestamp);
        knownYears.add(date.getFullYear());
        const key = localDayKey(date);
        if (key > todayKey) {
            continue;
        }
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const yearLength = daysInYear(year);
    const leadingPadding = new Date(year, 0, 1).getDay();
    const weekCount = Math.ceil((leadingPadding + yearLength) / DAYS_PER_WEEK);

    const cells: { date: Date; count: number }[] = [];
    let totalCount = 0;
    for (let index = 0; index < yearLength; index++) {
        const date = new Date(year, 0, 1 + index);
        const key = localDayKey(date);
        const count = key > todayKey ? 0 : (counts.get(key) ?? 0);
        totalCount += count;
        cells.push({ date, count });
    }

    const nonZero = cells.map(cell => cell.count).filter(count => count > 0).sort((a, b) => a - b);
    const quantile = (ratio: number): number => nonZero[Math.floor((nonZero.length - 1) * ratio)] ?? 0;
    const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];
    const levelOf = (count: number): QaapActivityLevel => {
        if (count === 0) {
            return 0;
        }
        const index = thresholds.findIndex(threshold => count <= threshold);
        return (index === -1 ? LEVEL_COUNT : index + 1) as QaapActivityLevel;
    };

    const weeks: QaapActivityWeek[] = [];
    const monthLabels: QaapActivityMonthLabel[] = [];
    for (let weekIndex = 0; weekIndex < weekCount; weekIndex++) {
        const week: (QaapActivityDay | undefined)[] = [];
        for (let row = 0; row < DAYS_PER_WEEK; row++) {
            const cell = cells[weekIndex * DAYS_PER_WEEK + row - leadingPadding];
            if (!cell) {
                week.push(undefined);
                continue;
            }
            week.push({
                date: cell.date,
                count: cell.count,
                level: levelOf(cell.count),
                future: localDayKey(cell.date) > todayKey,
            });
            if (cell.date.getDate() === 1) {
                monthLabels.push({ weekIndex, monthIndex: cell.date.getMonth() });
            }
        }
        weeks.push(week);
    }

    const years = [...knownYears].sort((a, b) => b - a);
    return { year, totalCount, years, weeks, monthLabels };
}
