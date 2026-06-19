// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { attachTranscriptUserScrollPin } from './qaap-transcript-user-scroll-pin';

describe('attachTranscriptUserScrollPin', () => {

    let disableJSDOM: (() => void) | undefined;
    let previousRequestAnimationFrame: typeof requestAnimationFrame | undefined;
    let previousCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    beforeEach(() => {
        document.body.innerHTML = '';
        previousRequestAnimationFrame = window.requestAnimationFrame;
        previousCancelAnimationFrame = window.cancelAnimationFrame;
        const raf = ((callback: FrameRequestCallback): number => {
            return window.setTimeout(() => callback(0), 0);
        }) as typeof requestAnimationFrame;
        const caf = ((handle: number) => window.clearTimeout(handle)) as typeof cancelAnimationFrame;
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = caf;
        (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = raf;
        (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = caf;
    });

    afterEach(() => {
        if (previousRequestAnimationFrame) {
            window.requestAnimationFrame = previousRequestAnimationFrame;
            (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = previousRequestAnimationFrame;
        }
        if (previousCancelAnimationFrame) {
            window.cancelAnimationFrame = previousCancelAnimationFrame;
            (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = previousCancelAnimationFrame;
        }
    });

    function createUserWrap(label: string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-agent-transcript-user-wrap';
        const bubble = document.createElement('button');
        bubble.className = 'theia-mobile-agent-transcript-msg theia-mod-user';
        const content = document.createElement('span');
        content.className = 'theia-mobile-agent-transcript-content';
        content.textContent = label;
        bubble.append(content);
        wrap.append(bubble);
        return wrap;
    }

    it('re-measures sticky user anchors when an expanded reasoning block toggles layout', async () => {
        const scroller = document.createElement('div');
        const first = createUserWrap('First prompt');
        const reasoning = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Reasoning';
        reasoning.append(summary, document.createElement('div'));
        const second = createUserWrap('Second prompt');
        scroller.append(first, reasoning, second);
        document.body.append(scroller);

        Object.defineProperties(scroller, {
            scrollTop: { value: 150, configurable: true },
            clientHeight: { value: 200, configurable: true },
            scrollHeight: { value: 1000, configurable: true },
        });
        scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 320, width: 320, height: 200 } as DOMRect);

        let secondMeasureCount = 0;
        first.getBoundingClientRect = () => ({ top: 0, bottom: 40, left: 0, right: 200, width: 200, height: 40 } as DOMRect);
        second.getBoundingClientRect = () => {
            secondMeasureCount++;
            return { top: 150, bottom: 190, left: 0, right: 200, width: 200, height: 40 } as DOMRect;
        };

        const disposable = attachTranscriptUserScrollPin(scroller);
        await new Promise(resolve => window.setTimeout(resolve, 0));
        const measuredBeforeToggle = secondMeasureCount;

        reasoning.open = true;
        reasoning.dispatchEvent(new window.Event('toggle', { bubbles: true }));
        await new Promise(resolve => window.setTimeout(resolve, 0));

        expect(secondMeasureCount).to.be.greaterThan(measuredBeforeToggle);
        disposable.dispose();
    });

    it('does not re-measure from sticky-owned class mutations', async () => {
        const scroller = document.createElement('div');
        const first = createUserWrap('First prompt');
        const second = createUserWrap('Second prompt');
        scroller.append(first, second);
        document.body.append(scroller);

        Object.defineProperties(scroller, {
            scrollTop: { value: 150, configurable: true },
            clientHeight: { value: 200, configurable: true },
            scrollHeight: { value: 1000, configurable: true },
        });
        scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 320, width: 320, height: 200 } as DOMRect);

        let secondMeasureCount = 0;
        first.getBoundingClientRect = () => ({ top: 0, bottom: 40, left: 0, right: 200, width: 200, height: 40 } as DOMRect);
        second.getBoundingClientRect = () => {
            secondMeasureCount++;
            return { top: 150, bottom: 190, left: 0, right: 200, width: 200, height: 40 } as DOMRect;
        };

        const disposable = attachTranscriptUserScrollPin(scroller);
        await new Promise(resolve => window.setTimeout(resolve, 0));
        const measuredBeforeStickyClassChange = secondMeasureCount;

        first.classList.add('theia-mod-sticky-stuck-test-only');
        await new Promise(resolve => window.setTimeout(resolve, 160));

        expect(secondMeasureCount).to.equal(measuredBeforeStickyClassChange);
        disposable.dispose();
    });

    it('does not mark a user bubble sticky before it reaches the scrollport top tolerance', async () => {
        const scroller = document.createElement('div');
        const first = createUserWrap('First prompt');
        const second = createUserWrap('Second prompt');
        scroller.append(first, second);
        document.body.append(scroller);

        Object.defineProperties(scroller, {
            scrollTop: { value: 150, configurable: true },
            clientHeight: { value: 200, configurable: true },
            scrollHeight: { value: 1000, configurable: true },
        });
        scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 320, width: 320, height: 200 } as DOMRect);

        first.getBoundingClientRect = () => ({ top: 7, bottom: 47, left: 0, right: 200, width: 200, height: 40 } as DOMRect);
        second.getBoundingClientRect = () => ({ top: 240, bottom: 280, left: 0, right: 200, width: 200, height: 40 } as DOMRect);

        const disposable = attachTranscriptUserScrollPin(scroller);
        await new Promise(resolve => window.setTimeout(resolve, 0));

        expect(first.classList.contains('theia-mod-sticky-stuck')).to.equal(false);
        expect(second.classList.contains('theia-mod-sticky-stuck')).to.equal(false);
        disposable.dispose();
    });

    it('compacts a tall sticky bubble without reserving its full natural height', async () => {
        const scroller = document.createElement('div');
        const first = createUserWrap('Long prompt');
        const second = createUserWrap('Second prompt');
        const content = first.querySelector<HTMLElement>('.theia-mobile-agent-transcript-content')!;
        Object.defineProperty(content, 'scrollHeight', { value: 240, configurable: true });
        first.style.minHeight = '420px';
        scroller.append(first, second);
        document.body.append(scroller);

        Object.defineProperties(scroller, {
            scrollTop: { value: 150, configurable: true },
            clientHeight: { value: 200, configurable: true },
            scrollHeight: { value: 1000, configurable: true },
        });
        scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 320, width: 320, height: 200 } as DOMRect);
        first.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 200, width: 200, height: 240 } as DOMRect);
        second.getBoundingClientRect = () => ({ top: 260, bottom: 300, left: 0, right: 200, width: 200, height: 40 } as DOMRect);

        const disposable = attachTranscriptUserScrollPin(scroller);
        await new Promise(resolve => window.setTimeout(resolve, 0));

        expect(first.classList.contains('theia-mod-sticky-stuck')).to.equal(true);
        expect(content.classList.contains('theia-mod-sticky-compact')).to.equal(true);
        expect(first.style.minHeight).to.equal('');
        disposable.dispose();
    });

    it('keeps the last user bubble sticky at the end of the response scroll', async () => {
        const scroller = document.createElement('div');
        const first = createUserWrap('Last prompt');
        scroller.append(first, document.createElement('div'));
        document.body.append(scroller);

        Object.defineProperties(scroller, {
            scrollTop: { value: 776, configurable: true },
            clientHeight: { value: 200, configurable: true },
            scrollHeight: { value: 1000, configurable: true },
        });
        scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 320, width: 320, height: 200 } as DOMRect);
        first.getBoundingClientRect = () => ({ top: 0, bottom: 40, left: 0, right: 200, width: 200, height: 40 } as DOMRect);

        const disposable = attachTranscriptUserScrollPin(scroller);
        await new Promise(resolve => window.setTimeout(resolve, 0));

        expect(first.classList.contains('theia-mod-sticky-stuck')).to.equal(true);
        disposable.dispose();
    });

});
