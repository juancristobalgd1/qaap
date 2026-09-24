// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import {
    attachTaskTitleMarquee,
    createTaskTitleText,
    refreshTaskTitleMarquee,
    setTaskTitleText,
    TASK_TITLE_OVERFLOW_CLASS,
} from './mobile-projects-task-title-marquee';

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
});
