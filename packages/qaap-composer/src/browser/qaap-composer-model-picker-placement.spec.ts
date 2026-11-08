// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { positionStickyComposerPopover } from '@theia/qaap-transcript/lib/browser/qaap-sticky-composer-popover';

interface PillRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** Places the picker popover the way the picker does: above the pill, width capped by the viewport. */
function placePicker(viewportWidth: number, pill: PillRect, popoverHeight: number): HTMLElement {
    const width = Math.min(560, viewportWidth - 32);
    const popover = document.createElement('div');
    popover.className = 'qaap-sticky-composer-sheet-popover';
    popover.dataset.placement = 'above-start';
    Object.defineProperty(popover, 'offsetWidth', { configurable: true, get: () => width });
    Object.defineProperty(popover, 'offsetHeight', { configurable: true, get: () => popoverHeight });
    const anchor = document.createElement('button');
    anchor.getBoundingClientRect = (): DOMRect => ({
        x: pill.left, y: pill.top, left: pill.left, top: pill.top,
        width: pill.width, height: pill.height,
        right: pill.left + pill.width, bottom: pill.top + pill.height,
        toJSON: () => ({}),
    }) as DOMRect;
    document.body.append(popover, anchor);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
    positionStickyComposerPopover(popover, anchor, 'start', Math.min(560, viewportWidth - 32));
    return popover;
}

describe('qaap-composer-model-picker placement', () => {
    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        document.body.replaceChildren();
        disableJSDOM();
    });

    it('at 375px the popover bottom sits 8px above the pill and its left edge is clamped 16px inside', () => {
        const pill = { left: 59, top: 756, width: 200, height: 44 };
        const popover = placePicker(375, pill, 300);
        expect(popover.style.top).to.equal(`${pill.top - 8 - 300}px`);
        expect(popover.style.left).to.equal('16px');
    });

    it('at 1280px the popover follows the pill: bottom 8px above it, left edge on the pill', () => {
        const pill = { left: 900, top: 740, width: 260, height: 44 };
        const popover = placePicker(1280, pill, 320);
        expect(popover.style.top).to.equal(`${pill.top - 8 - 320}px`);
        // The 560px popover cannot start past 1280 - 560 - 16 = 704px.
        expect(popover.style.left).to.equal('704px');
    });

    it('at 1280px a pill near the left keeps its own left edge', () => {
        const pill = { left: 300, top: 740, width: 260, height: 44 };
        const popover = placePicker(1280, pill, 320);
        expect(popover.style.left).to.equal('300px');
        expect(popover.style.top).to.equal(`${pill.top - 8 - 320}px`);
    });
});
