// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    buildQaapActivityCalendar,
    type QaapActivityCalendar,
    type QaapActivityDay,
    type QaapActivityLevel,
} from '../common/qaap-activity-calendar';

/** Row labels for Sunday through Saturday; only Mon, Wed and Fri are shown, as on GitHub. */
const WEEKDAY_LABELS: ReadonlyArray<string> = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

/**
 * GitHub-style contribution graph for the Work Hub Settings Profile page. The owner passes the
 * activity timestamps in; the element only renders them, so the data source stays with the caller.
 */
export class MobileWorkHubActivityCalendar {

    readonly node: HTMLElement;
    protected readonly headingEl: HTMLElement;
    protected readonly bodyEl: HTMLElement;
    protected timestamps: ReadonlyArray<number> = [];
    protected now: Date = new Date();
    protected selectedYear: number | undefined;

    constructor() {
        this.node = document.createElement('section');
        this.node.className = 'theia-mobile-work-hub-settings-card theia-mobile-work-hub-settings-activity-card';
        this.node.setAttribute('aria-busy', 'true');

        this.headingEl = document.createElement('h3');
        this.headingEl.className = 'theia-mobile-work-hub-settings-activity-heading';

        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'theia-mobile-work-hub-settings-activity-body';

        this.node.append(this.headingEl, this.bodyEl);
    }

    /** Shows the skeleton until `setActivity` or `showError` replaces it. */
    showLoading(): void {
        this.node.setAttribute('aria-busy', 'true');
        this.headingEl.textContent = nls.localize('qaap/workHubSettings/activity/loading', 'Loading activity…');
        const skeleton = document.createElement('div');
        skeleton.className = 'q-skeleton theia-mobile-work-hub-settings-activity-skeleton';
        skeleton.setAttribute('aria-hidden', 'true');
        this.bodyEl.replaceChildren(skeleton);
    }

    /** Replaces the skeleton with a short message when the activity could not be loaded. */
    showError(): void {
        this.node.removeAttribute('aria-busy');
        this.headingEl.textContent = nls.localize(
            'qaap/workHubSettings/activity/unavailable',
            'Activity is unavailable right now.',
        );
        this.bodyEl.replaceChildren();
    }

    /** Renders the grid for the current year (or the latest year with data when the user has not picked one). */
    setActivity(timestamps: ReadonlyArray<number>, now: Date): void {
        this.timestamps = timestamps;
        this.now = now;
        this.selectedYear = undefined;
        this.render();
    }

    protected render(): void {
        const year = this.selectedYear ?? this.now.getFullYear();
        const calendar = buildQaapActivityCalendar(this.timestamps, year, this.now);
        this.node.removeAttribute('aria-busy');
        this.headingEl.textContent = this.createHeadingText(calendar);
        this.bodyEl.replaceChildren(this.createGraph(calendar), this.createYearList(calendar));
        // Latest weeks first: the newest column is the one the user came to see.
        const scroller = this.bodyEl.querySelector<HTMLElement>('.theia-mobile-work-hub-settings-activity-scroll');
        if (scroller) {
            scroller.scrollLeft = scroller.scrollWidth;
        }
    }

    protected createHeadingText(calendar: QaapActivityCalendar): string {
        if (calendar.totalCount === 0) {
            return nls.localize('qaap/workHubSettings/activity/empty', 'No contributions in {0}', calendar.year);
        }
        if (calendar.totalCount === 1) {
            return nls.localize('qaap/workHubSettings/activity/headingOne', '1 contribution in {0}', calendar.year);
        }
        return nls.localize(
            'qaap/workHubSettings/activity/heading',
            '{0} contributions in {1}',
            calendar.totalCount,
            calendar.year,
        );
    }

    protected createGraph(calendar: QaapActivityCalendar): HTMLElement {
        const graph = document.createElement('div');
        graph.className = 'theia-mobile-work-hub-settings-activity-graph';

        const scroller = document.createElement('div');
        scroller.className = 'theia-mobile-work-hub-settings-activity-scroll';
        scroller.setAttribute('role', 'region');
        scroller.tabIndex = 0;
        scroller.setAttribute('aria-label', nls.localize('qaap/workHubSettings/activity/graphLabel', 'Contribution graph'));

        const inner = document.createElement('div');
        inner.className = 'theia-mobile-work-hub-settings-activity-inner';

        const months = document.createElement('div');
        months.className = 'theia-mobile-work-hub-settings-activity-months';
        months.style.setProperty('--qaap-activity-weeks', String(calendar.weeks.length));
        for (const label of calendar.monthLabels) {
            const month = document.createElement('span');
            month.className = 'theia-mobile-work-hub-settings-activity-month';
            month.textContent = this.formatMonth(label.monthIndex);
            month.style.setProperty('--qaap-activity-column', String(label.weekIndex + 1));
            months.append(month);
        }

        const weekdays = document.createElement('div');
        weekdays.className = 'theia-mobile-work-hub-settings-activity-weekdays';
        weekdays.setAttribute('aria-hidden', 'true');
        for (const label of WEEKDAY_LABELS) {
            const weekday = document.createElement('span');
            weekday.className = 'theia-mobile-work-hub-settings-activity-weekday';
            weekday.textContent = this.localizeWeekday(label);
            weekdays.append(weekday);
        }

        const grid = document.createElement('div');
        grid.className = 'theia-mobile-work-hub-settings-activity-grid';
        for (const week of calendar.weeks) {
            for (const day of week) {
                grid.append(this.createCell(day));
            }
        }

        inner.append(months, weekdays, grid);
        scroller.append(inner);
        graph.append(scroller, this.createLegend());
        return graph;
    }

    protected createCell(day: QaapActivityDay | undefined): HTMLElement {
        const cell = document.createElement('span');
        cell.className = 'theia-mobile-work-hub-settings-activity-cell';
        if (!day) {
            cell.classList.add('theia-mod-outside');
            return cell;
        }
        cell.classList.add(this.levelClass(day.level));
        if (day.future) {
            cell.classList.add('theia-mod-future');
            return cell;
        }
        const label = this.describeDay(day);
        cell.setAttribute('role', 'img');
        cell.setAttribute('aria-label', label);
        cell.title = label;
        return cell;
    }

    protected describeDay(day: QaapActivityDay): string {
        const date = this.formatDay(day.date);
        if (day.count === 0) {
            return nls.localize('qaap/workHubSettings/activity/cellEmpty', 'No contributions on {0}', date);
        }
        if (day.count === 1) {
            return nls.localize('qaap/workHubSettings/activity/cellOne', '1 contribution on {0}', date);
        }
        return nls.localize('qaap/workHubSettings/activity/cellCount', '{0} contributions on {1}', day.count, date);
    }

    protected createLegend(): HTMLElement {
        const legend = document.createElement('div');
        legend.className = 'theia-mobile-work-hub-settings-activity-legend';
        const less = document.createElement('span');
        less.className = 'theia-mobile-work-hub-settings-activity-legend-text';
        less.textContent = nls.localize('qaap/workHubSettings/activity/less', 'Less');
        const more = document.createElement('span');
        more.className = 'theia-mobile-work-hub-settings-activity-legend-text';
        more.textContent = nls.localize('qaap/workHubSettings/activity/more', 'More');
        const swatches = document.createElement('span');
        swatches.className = 'theia-mobile-work-hub-settings-activity-legend-swatches';
        swatches.setAttribute('aria-hidden', 'true');
        for (const level of [0, 1, 2, 3, 4] as const) {
            const swatch = document.createElement('span');
            swatch.className = `theia-mobile-work-hub-settings-activity-cell ${this.levelClass(level)}`;
            swatches.append(swatch);
        }
        legend.append(less, swatches, more);
        return legend;
    }

    protected createYearList(calendar: QaapActivityCalendar): HTMLElement {
        const list = document.createElement('div');
        list.className = 'theia-mobile-work-hub-settings-activity-years';
        list.setAttribute('role', 'group');
        list.setAttribute('aria-label', nls.localize('qaap/workHubSettings/activity/yearsLabel', 'Contribution years'));
        for (const year of calendar.years) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-mobile-work-hub-settings-activity-year';
            const selected = year === calendar.year;
            button.classList.toggle('theia-mod-selected', selected);
            button.setAttribute('aria-pressed', String(selected));
            button.textContent = String(year);
            button.addEventListener('click', () => {
                this.selectedYear = year;
                this.render();
            });
            list.append(button);
        }
        return list;
    }

    protected levelClass(level: QaapActivityLevel): string {
        return `theia-mobile-work-hub-settings-activity-level-${level}`;
    }

    protected formatMonth(monthIndex: number): string {
        return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(2000, monthIndex, 1));
    }

    protected formatDay(date: Date): string {
        return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date);
    }

    protected localizeWeekday(label: string): string {
        switch (label) {
            case 'Mon':
                return nls.localize('qaap/workHubSettings/activity/monday', 'Mon');
            case 'Wed':
                return nls.localize('qaap/workHubSettings/activity/wednesday', 'Wed');
            case 'Fri':
                return nls.localize('qaap/workHubSettings/activity/friday', 'Fri');
            default:
                return '';
        }
    }
}
