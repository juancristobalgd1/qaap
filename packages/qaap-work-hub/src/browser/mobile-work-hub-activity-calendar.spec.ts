// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The renderer touches the DOM only when instantiated; keep the global environment scoped to this suite.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { MobileWorkHubActivityCalendar } from './mobile-work-hub-activity-calendar';

disableImportJSDOM();

const NOW = new Date(2026, 10, 12, 9, 0);

function at(year: number, month: number, day: number): number {
    return new Date(year, month, day, 12).getTime();
}

describe('MobileWorkHubActivityCalendar', () => {

    useSuiteJSDOM();

    function renderWith(timestamps: number[]): MobileWorkHubActivityCalendar {
        const calendar = new MobileWorkHubActivityCalendar();
        document.body.append(calendar.node);
        calendar.setActivity(timestamps, NOW);
        return calendar;
    }

    function cells(calendar: MobileWorkHubActivityCalendar): HTMLElement[] {
        return [...calendar.node.querySelectorAll<HTMLElement>('.theia-mobile-work-hub-settings-activity-grid > .theia-mobile-work-hub-settings-activity-cell')];
    }

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('starts with a busy skeleton until activity arrives', () => {
        const calendar = new MobileWorkHubActivityCalendar();
        calendar.showLoading();
        expect(calendar.node.getAttribute('aria-busy')).to.equal('true');
        expect(calendar.node.querySelector('.q-skeleton')).to.exist;
        expect(calendar.node.querySelector('.theia-mobile-work-hub-settings-activity-grid')).to.not.exist;
    });

    it('renders a seven-row grid with one cell per day of the year plus padding', () => {
        const calendar = renderWith([at(2026, 0, 5)]);
        const grid = calendar.node.querySelector('.theia-mobile-work-hub-settings-activity-grid');
        expect(grid).to.exist;
        expect(calendar.node.getAttribute('aria-busy')).to.not.exist;
        // 53 columns of seven rows for 2026.
        expect(cells(calendar).length).to.equal(53 * 7);
    });

    it('states the total in the heading and labels each cell with its count and date', () => {
        const calendar = renderWith([at(2026, 0, 5), at(2026, 0, 5), at(2026, 0, 6)]);
        expect(calendar.node.querySelector('.theia-mobile-work-hub-settings-activity-heading')?.textContent)
            .to.contain('3 contributions in 2026');
        const labels = cells(calendar).map(cell => cell.getAttribute('aria-label') ?? '');
        expect(labels.some(label => label.startsWith('2 contributions on'))).to.equal(true);
        expect(labels.some(label => label.startsWith('1 contribution on'))).to.equal(true);
        expect(labels.some(label => label.startsWith('No contributions on'))).to.equal(true);
        const withTitle = cells(calendar).filter(cell => cell.title !== '');
        expect(withTitle.length).to.equal(cells(calendar).filter(cell => cell.getAttribute('role') === 'img').length);
    });

    it('assigns intensity classes and marks padding and future days', () => {
        const calendar = renderWith([at(2026, 0, 5), at(2026, 0, 6), at(2026, 0, 6)]);
        const levelCells = cells(calendar).filter(cell => /activity-level-[1-4]/.test(cell.className));
        expect(levelCells.length).to.equal(2);
        expect(cells(calendar).some(cell => cell.classList.contains('theia-mod-outside'))).to.equal(true);
        expect(cells(calendar).some(cell => cell.classList.contains('theia-mod-future'))).to.equal(true);
    });

    it('renders the empty state wording and an all-empty grid when there is no activity', () => {
        const calendar = renderWith([]);
        expect(calendar.node.querySelector('.theia-mobile-work-hub-settings-activity-heading')?.textContent)
            .to.equal('No contributions in 2026');
        const active = cells(calendar).filter(cell => /activity-level-[1-4]/.test(cell.className));
        expect(active.length).to.equal(0);
    });

    it('offers one year button per year with data, with the current year pressed', () => {
        const calendar = renderWith([at(2025, 3, 1), at(2026, 1, 1)]);
        const years = [...calendar.node.querySelectorAll<HTMLButtonElement>('.theia-mobile-work-hub-settings-activity-year')];
        expect(years.map(button => button.textContent)).to.deep.equal(['2026', '2025']);
        expect(years[0].getAttribute('aria-pressed')).to.equal('true');
        expect(years[1].getAttribute('aria-pressed')).to.equal('false');
    });

    it('re-renders the chosen year when its button is pressed', () => {
        const calendar = renderWith([at(2025, 3, 1), at(2025, 3, 2)]);
        const yearButton = [...calendar.node.querySelectorAll<HTMLButtonElement>('.theia-mobile-work-hub-settings-activity-year')]
            .find(button => button.textContent === '2025');
        yearButton?.click();
        expect(calendar.node.querySelector('.theia-mobile-work-hub-settings-activity-heading')?.textContent)
            .to.contain('2 contributions in 2025');
        const pressed = [...calendar.node.querySelectorAll<HTMLButtonElement>('.theia-mobile-work-hub-settings-activity-year[aria-pressed="true"]')];
        expect(pressed.map(button => button.textContent)).to.deep.equal(['2025']);
    });

    it('renders the Less/More legend with five swatches, one per level', () => {
        const calendar = renderWith([]);
        const swatches = calendar.node.querySelectorAll('.theia-mobile-work-hub-settings-activity-legend-swatches > span');
        expect(swatches.length).to.equal(5);
        for (let level = 0; level < 5; level++) {
            expect(swatches[level].classList.contains(`theia-mobile-work-hub-settings-activity-level-${level}`)).to.equal(true);
        }
        expect(calendar.node.querySelector('.theia-mobile-work-hub-settings-activity-legend')?.textContent).to.contain('Less');
        expect(calendar.node.querySelector('.theia-mobile-work-hub-settings-activity-legend')?.textContent).to.contain('More');
    });

    it('exposes the horizontal scroller as a keyboard-focusable region', () => {
        const calendar = renderWith([at(2026, 0, 5)]);
        const scroller = calendar.node.querySelector<HTMLElement>('.theia-mobile-work-hub-settings-activity-scroll');
        expect(scroller?.getAttribute('role')).to.equal('region');
        expect(scroller?.tabIndex).to.equal(0);
    });

    it('shows a short message when the activity could not be loaded', () => {
        const calendar = new MobileWorkHubActivityCalendar();
        calendar.showError();
        expect(calendar.node.getAttribute('aria-busy')).to.not.exist;
        expect(calendar.node.querySelector('.theia-mobile-work-hub-settings-activity-heading')?.textContent)
            .to.equal('Activity is unavailable right now.');
        expect(calendar.node.querySelector('.q-skeleton')).to.not.exist;
    });
});
