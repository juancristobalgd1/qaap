// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildQaapActivityCalendar,
    collectQaapActivityTimestamps,
    type QaapActivityDay,
} from './qaap-activity-calendar';

const NOW = new Date(2026, 10, 12, 9, 0);

function at(year: number, month: number, day: number, hour = 12): number {
    return new Date(year, month, day, hour).getTime();
}

function definedDays(weeks: ReadonlyArray<ReadonlyArray<QaapActivityDay | undefined>>): QaapActivityDay[] {
    return weeks.flatMap(week => week.filter((day): day is QaapActivityDay => day !== undefined));
}

describe('qaap-activity-calendar', () => {

    describe('buildQaapActivityCalendar layout', () => {

        it('starts every column on Sunday and keeps seven rows per column', () => {
            const calendar = buildQaapActivityCalendar([], 2026, NOW);
            for (const week of calendar.weeks) {
                expect(week.length).to.equal(7);
            }
            // 2026 starts on a Thursday: Sunday to Wednesday of the first column are padding.
            const first = calendar.weeks[0];
            expect(first.slice(0, 4).every(day => day === undefined)).to.equal(true);
            expect(first[4]?.date.getDate()).to.equal(1);
            expect(first[4]?.date.getMonth()).to.equal(0);
            expect(first[4]?.date.getDay()).to.equal(4);
        });

        it('places the last day of the year in the last column and pads the rest of it', () => {
            const calendar = buildQaapActivityCalendar([], 2026, NOW);
            const last = calendar.weeks[calendar.weeks.length - 1];
            // 2026 ends on a Thursday, so Friday and Saturday are padding.
            expect(last[4]?.date.getMonth()).to.equal(11);
            expect(last[4]?.date.getDate()).to.equal(31);
            expect(last[5]).to.equal(undefined);
            expect(last[6]).to.equal(undefined);
            expect(calendar.weeks.length).to.equal(53);
        });

        it('covers every day of a common year exactly once', () => {
            const days = definedDays(buildQaapActivityCalendar([], 2025, NOW).weeks);
            expect(days.length).to.equal(365);
            expect(new Set(days.map(day => day.date.getTime())).size).to.equal(365);
        });

        it('covers 366 days in a leap year', () => {
            const calendar = buildQaapActivityCalendar([], 2024, NOW);
            expect(definedDays(calendar.weeks).length).to.equal(366);
            expect(calendar.weeks.length).to.equal(53);
            const feb29 = definedDays(calendar.weeks).find(day => day.date.getMonth() === 1 && day.date.getDate() === 29);
            expect(feb29).to.not.equal(undefined);
        });

        it('needs a 54th column when a leap year starts on a Saturday', () => {
            // 2028 starts on a Saturday: six padding cells plus 366 days span 54 columns.
            const calendar = buildQaapActivityCalendar([], 2028, NOW);
            expect(calendar.weeks.length).to.equal(54);
            expect(definedDays(calendar.weeks).length).to.equal(366);
        });

        it('labels the column that holds the 1st of each month', () => {
            const calendar = buildQaapActivityCalendar([], 2026, NOW);
            expect(calendar.monthLabels.length).to.equal(12);
            expect(calendar.monthLabels[0]).to.deep.equal({ weekIndex: 0, monthIndex: 0 });
            for (const label of calendar.monthLabels) {
                const week = calendar.weeks[label.weekIndex];
                expect(week.some(day => day?.date.getDate() === 1 && day.date.getMonth() === label.monthIndex)).to.equal(true);
            }
        });
    });

    describe('buildQaapActivityCalendar counts and levels', () => {

        it('returns an all-empty grid when there is no data', () => {
            const calendar = buildQaapActivityCalendar([], 2026, NOW);
            expect(calendar.totalCount).to.equal(0);
            expect(definedDays(calendar.weeks).every(day => day.level === 0 && day.count === 0)).to.equal(true);
            expect(calendar.years).to.deep.equal([2026]);
        });

        it('sums contributions per local day into the year total', () => {
            const calendar = buildQaapActivityCalendar([
                at(2026, 0, 5, 9), at(2026, 0, 5, 18), at(2026, 6, 1), at(2025, 11, 31),
            ], 2026, NOW);
            expect(calendar.totalCount).to.equal(3);
            const jan5 = definedDays(calendar.weeks).find(day => day.date.getMonth() === 0 && day.date.getDate() === 5);
            expect(jan5?.count).to.equal(2);
        });

        it('assigns levels from the quartiles of the non-zero days', () => {
            const timestamps = [
                at(2026, 0, 1), // 1 contribution
                at(2026, 0, 2), at(2026, 0, 2), // 2
                at(2026, 0, 3), at(2026, 0, 3), at(2026, 0, 3), // 3
                at(2026, 0, 4), at(2026, 0, 4), at(2026, 0, 4), at(2026, 0, 4), // 4
            ];
            const calendar = buildQaapActivityCalendar(timestamps, 2026, NOW);
            const levelOf = (day: number): number | undefined =>
                definedDays(calendar.weeks).find(cell => cell.date.getMonth() === 0 && cell.date.getDate() === day)?.level;
            expect(levelOf(1)).to.equal(1);
            expect(levelOf(2)).to.equal(2);
            expect(levelOf(3)).to.equal(3);
            expect(levelOf(4)).to.equal(4);
            expect(levelOf(5)).to.equal(0);
        });

        it('keeps every non-zero day at level 1 or above when counts are equal', () => {
            const calendar = buildQaapActivityCalendar([at(2026, 2, 1), at(2026, 2, 2)], 2026, NOW);
            const active = definedDays(calendar.weeks).filter(day => day.count > 0);
            expect(active.map(day => day.level)).to.deep.equal([1, 1]);
        });
    });

    describe('buildQaapActivityCalendar years and future days', () => {

        it('lists the years with data, the requested year and the current year, newest first', () => {
            const calendar = buildQaapActivityCalendar([at(2024, 4, 1), at(2026, 1, 1)], 2025, NOW);
            expect(calendar.years).to.deep.equal([2026, 2025, 2024]);
            expect(calendar.year).to.equal(2025);
            expect(calendar.totalCount).to.equal(0);
        });

        it('flags days after now as future and ignores timestamps on them', () => {
            const now = new Date(2026, 2, 10, 12);
            const calendar = buildQaapActivityCalendar([at(2026, 2, 10), at(2026, 6, 1)], 2026, now);
            expect(calendar.totalCount).to.equal(1);
            const days = definedDays(calendar.weeks);
            expect(days.find(day => day.date.getMonth() === 2 && day.date.getDate() === 10)?.future).to.equal(false);
            expect(days.find(day => day.date.getMonth() === 2 && day.date.getDate() === 11)?.future).to.equal(true);
            expect(days.find(day => day.date.getMonth() === 6 && day.date.getDate() === 1)?.count).to.equal(0);
        });

        it('ignores non-finite timestamps', () => {
            const calendar = buildQaapActivityCalendar([Number.NaN, at(2026, 0, 2)], 2026, NOW);
            expect(calendar.totalCount).to.equal(1);
        });
    });

    describe('collectQaapActivityTimestamps', () => {

        it('counts the start of each conversation', () => {
            const created = at(2026, 4, 3);
            expect(collectQaapActivityTimestamps([{ createdAt: created, updatedAt: created }])).to.deep.equal([created]);
        });

        it('adds the last update only when it falls on a different local day', () => {
            const created = at(2026, 4, 3, 9);
            const laterSameDay = at(2026, 4, 3, 20);
            const nextDay = at(2026, 4, 4, 9);
            expect(collectQaapActivityTimestamps([{ createdAt: created, updatedAt: laterSameDay }])).to.deep.equal([created]);
            expect(collectQaapActivityTimestamps([{ createdAt: created, updatedAt: nextDay }])).to.deep.equal([created, nextDay]);
        });

        it('skips conversations without a finite creation time', () => {
            expect(collectQaapActivityTimestamps([{ createdAt: Number.NaN, updatedAt: Number.NaN }])).to.deep.equal([]);
        });
    });
});
