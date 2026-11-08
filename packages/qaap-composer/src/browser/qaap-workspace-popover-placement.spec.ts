// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { positionStickyComposerPopover } from '@theia/qaap-transcript/lib/browser/qaap-sticky-composer-popover';

interface Rect { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** Places a workspace popover from a trigger with a fake rect, as the Work Hub and the composer do. */
function place(trigger: Rect, popoverWidth: number, popoverHeight: number, viewport: { width: number; height: number }): HTMLElement {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height });
    const popover = document.createElement('div');
    popover.className = 'qaap-sticky-composer-sheet-popover theia-mod-project-sheet';
    popover.dataset.viewportInset = '16';
    Object.defineProperty(popover, 'offsetWidth', { configurable: true, get: () => popoverWidth });
    Object.defineProperty(popover, 'offsetHeight', { configurable: true, get: () => popoverHeight });
    const anchor = document.createElement('button');
    anchor.getBoundingClientRect = (): DOMRect => ({
        x: trigger.left, y: trigger.top, left: trigger.left, top: trigger.top,
        width: trigger.width, height: trigger.height,
        right: trigger.left + trigger.width, bottom: trigger.top + trigger.height,
        toJSON: () => ({}),
    }) as DOMRect;
    document.body.append(popover, anchor);
    positionStickyComposerPopover(popover, anchor, 'start', popoverWidth);
    return popover;
}

describe('workspace popover placement', () => {
    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        document.body.replaceChildren();
        disableJSDOM();
    });

    it('opens under the header project button, 6px below it, aligned to its left edge (1280px)', () => {
        const popover = place({ left: 40, top: 12, width: 160, height: 33 }, 320, 300, { width: 1280, height: 800 });
        expect(popover.style.top).to.equal('51px');
        expect(popover.style.left).to.equal('40px');
    });

    it('keeps 16px from the left edge when the trigger sits at the edge (375px)', () => {
        const popover = place({ left: 4, top: 12, width: 120, height: 33 }, 343, 300, { width: 375, height: 812 });
        expect(popover.style.top).to.equal('51px');
        expect(popover.style.left).to.equal('16px');
    });

    it('opens above the composer pill when there is no room below it', () => {
        const popover = place({ left: 300, top: 740, width: 260, height: 44 }, 320, 300, { width: 1280, height: 800 });
        expect(popover.style.top).to.equal(`${740 - 6 - 300}px`);
        expect(popover.style.left).to.equal('300px');
    });
});
