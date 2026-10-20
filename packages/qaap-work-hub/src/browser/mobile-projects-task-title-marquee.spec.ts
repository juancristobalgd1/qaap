// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    attachTaskTitleMarquee,
    createTaskTitleText,
    refreshTaskTitleMarquee,
    setTaskTitleText,
    TASK_TITLE_OVERFLOW_CLASS,
} from './mobile-projects-task-title-marquee';

disableImportJSDOM();

describe('task title marquee', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    it('measures overflow on the title viewport and stores the travel distance', () => {
        const viewport = document.createElement('span');
        const text = createTaskTitleText('A long task title');
        viewport.append(text);
        document.body.append(viewport);
        Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 100 });
        Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 176 });

        refreshTaskTitleMarquee(viewport);

        expect(viewport.classList.contains(TASK_TITLE_OVERFLOW_CLASS)).to.equal(true);
        expect(viewport.style.getPropertyValue('--qaap-task-title-overflow')).to.equal('76px');
    });

    it('updates the inner title without removing the marquee structure', () => {
        const row = document.createElement('div');
        const viewport = document.createElement('span');
        const text = createTaskTitleText('Old title');
        viewport.append(text);
        row.append(viewport);
        document.body.append(row);
        Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 100 });
        Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 180 });
        refreshTaskTitleMarquee(viewport);

        Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 60 });
        setTaskTitleText(viewport, 'New title');

        expect(viewport.textContent).to.equal('New title');
        expect(viewport.querySelector('.theia-mobile-projects-task-title-text')).to.equal(text);
        expect(viewport.classList.contains(TASK_TITLE_OVERFLOW_CLASS)).to.equal(false);
        expect(viewport.style.getPropertyValue('--qaap-task-title-overflow')).to.equal('');
    });

    it('attaches the measurement to row hover and focus interactions', () => {
        const row = document.createElement('div');
        const viewport = document.createElement('span');
        const text = createTaskTitleText('Hover title');
        viewport.append(text);
        row.append(viewport);
        document.body.append(row);
        Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 80 });
        Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 140 });

        attachTaskTitleMarquee(row, viewport);
        const view = row.ownerDocument.defaultView!;
        row.dispatchEvent(new view.Event('mouseenter'));
        row.dispatchEvent(new view.Event('focusin'));

        expect(viewport.classList.contains(TASK_TITLE_OVERFLOW_CLASS)).to.equal(true);
    });
    it('travels past the width the hover actions cover only while the row is in use', () => {
        const viewport = document.createElement('span');
        const text = createTaskTitleText('A title that fits until the actions cover its end');
        viewport.append(text);
        viewport.style.setProperty('--qaap-task-title-hover-reserve', '36px');
        document.body.append(viewport);
        Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 100 });
        Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 90 });

        // At rest the title fits: no fade, no marquee.
        refreshTaskTitleMarquee(viewport);
        expect(viewport.classList.contains(TASK_TITLE_OVERFLOW_CLASS)).to.equal(false);

        refreshTaskTitleMarquee(viewport, { interacting: true });
        expect(viewport.classList.contains(TASK_TITLE_OVERFLOW_CLASS)).to.equal(true);
        expect(viewport.style.getPropertyValue('--qaap-task-title-overflow')).to.equal('26px');
    });
    it('keeps the hover reserve when the title changes while its row is in use', () => {
        const row = document.createElement('div');
        row.className = 'theia-mobile-projects-task-row';
        const viewport = document.createElement('span');
        const text = createTaskTitleText('Short');
        viewport.append(text);
        viewport.style.setProperty('--qaap-task-title-hover-reserve', '36px');
        const action = document.createElement('button');
        row.append(viewport, action);
        document.body.append(row);
        Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 100 });
        Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 90 });
        action.focus();

        setTaskTitleText(viewport, 'Renamed while in use');

        expect(viewport.classList.contains(TASK_TITLE_OVERFLOW_CLASS)).to.equal(true);
        expect(viewport.style.getPropertyValue('--qaap-task-title-overflow')).to.equal('26px');
        row.remove();
    });
});
