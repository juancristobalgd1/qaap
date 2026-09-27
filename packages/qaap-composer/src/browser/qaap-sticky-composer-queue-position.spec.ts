// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { ensureQueueControlInPillRow } from './qaap-sticky-composer-queue-position';

describe('sticky composer queue positioning', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    function createWrap(expanded: boolean): {
        readonly wrap: HTMLElement;
        readonly row: HTMLElement;
        readonly stack: HTMLElement;
        readonly card: HTMLElement;
    } {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-projects-sticky-composer-inner';
        const host = document.createElement('div');
        host.className = 'theia-mobile-sticky-composer-changes-pill-host';
        const row = document.createElement('div');
        row.className = 'theia-mobile-sticky-composer-changes-pill-row';
        host.append(row);
        const stack = document.createElement('div');
        stack.className = 'theia-mobile-sticky-composer-activity-stack theia-mod-queue-control theia-mod-queue-popover';
        stack.classList.add(expanded ? 'theia-mod-expanded' : 'theia-mod-collapsed');
        row.append(stack);
        const card = document.createElement('div');
        card.className = 'theia-mobile-projects-sticky-composer-card';
        wrap.append(host, card);
        return { wrap, row, stack, card };
    }

    it('keeps an expanded queue as a full-width sibling of the composer card', () => {
        const { wrap, row, stack, card } = createWrap(true);

        ensureQueueControlInPillRow(wrap);

        expect(stack.parentElement).to.equal(wrap);
        expect(stack.nextElementSibling).to.equal(card);
        expect(row.contains(stack)).to.equal(false);
    });

    it('keeps a collapsed queue in the changes-pill row', () => {
        const { wrap, row, stack } = createWrap(false);

        ensureQueueControlInPillRow(wrap);

        expect(stack.parentElement).to.equal(row);
    });
});
