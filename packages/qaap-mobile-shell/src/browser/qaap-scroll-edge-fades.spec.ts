// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    attachQaapScrollEdgeFades,
    QAAP_SCROLL_FADE_BOTTOM_CLASS,
    QAAP_SCROLL_FADE_END_CLASS,
    QAAP_SCROLL_FADE_START_CLASS,
    QAAP_SCROLL_FADE_TOP_CLASS,
    QAAP_SCROLL_FADES_CLASS,
    QAAP_SCROLL_FADES_X_CLASS,
} from './qaap-scroll-edge-fades';

describe('qaap-scroll-edge-fades', () => {

    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    /** Fake scroller whose geometry is fixed by the test; `scrollTop` stays writable. */
    function createScroller(scrollTop: number, scrollHeight: number, clientHeight: number): HTMLElement {
        const scroller = document.createElement('div');
        document.body.appendChild(scroller);
        Object.defineProperty(scroller, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
        Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight, configurable: true });
        Object.defineProperty(scroller, 'clientHeight', { value: clientHeight, configurable: true });
        return scroller;
    }

    function setScrollTop(scroller: HTMLElement, value: number): void {
        Object.defineProperty(scroller, 'scrollTop', { value, writable: true, configurable: true });
    }

    it('shows only the bottom fade when at the top with more content below', () => {
        const scroller = createScroller(0, 500, 200);
        const fades = attachQaapScrollEdgeFades(scroller);
        expect(scroller.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.true;
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.false;
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.true;
        fades.dispose();
    });

    it('shows both fades in the middle of the content', () => {
        const scroller = createScroller(150, 500, 200);
        const fades = attachQaapScrollEdgeFades(scroller);
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.true;
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.true;
        fades.dispose();
    });

    it('shows only the top fade when scrolled to the bottom', () => {
        const scroller = createScroller(300, 500, 200);
        const fades = attachQaapScrollEdgeFades(scroller);
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.true;
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
        fades.dispose();
    });

    it('shows no fade when the content does not overflow', () => {
        const scroller = createScroller(0, 200, 200);
        const fades = attachQaapScrollEdgeFades(scroller);
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.false;
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
        fades.dispose();
    });

    it('tolerates a sub-pixel gap at the bottom edge', () => {
        const scroller = createScroller(299.5, 500, 200);
        const fades = attachQaapScrollEdgeFades(scroller);
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
        fades.dispose();
    });

    it('updates classes on scroll events', () => {
        const scroller = createScroller(0, 500, 200);
        const fades = attachQaapScrollEdgeFades(scroller);
        setScrollTop(scroller, 150);
        scroller.dispatchEvent(new window.Event('scroll'));
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.true;
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.true;
        fades.dispose();
    });

    it('works without ResizeObserver, MutationObserver or requestAnimationFrame', () => {
        const view = window as unknown as Record<string, unknown>;
        const global = globalThis as unknown as Record<string, unknown>;
        const keys = ['ResizeObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
        const saved = new Map<string, unknown>(keys.map(key => [key, view[key]]));
        const savedGlobal = new Map<string, unknown>(['ResizeObserver', 'MutationObserver'].map(key => [key, global[key]]));
        for (const key of keys) {
            view[key] = undefined;
        }
        global.ResizeObserver = undefined;
        global.MutationObserver = undefined;
        try {
            const scroller = createScroller(0, 500, 200);
            const fades = attachQaapScrollEdgeFades(scroller);
            expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.true;
            setScrollTop(scroller, 300);
            scroller.dispatchEvent(new window.Event('scroll'));
            expect(scroller.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.true;
            expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
            fades.dispose();
        } finally {
            saved.forEach((value, key) => { view[key] = value; });
            savedGlobal.forEach((value, key) => { global[key] = value; });
        }
    });

    it('defers updates to requestAnimationFrame and cancels a pending frame on dispose', () => {
        const view = window as unknown as Record<string, unknown>;
        const savedRaf = view.requestAnimationFrame;
        const savedCaf = view.cancelAnimationFrame;
        const callbacks = new Map<number, () => void>();
        const cancelled: number[] = [];
        let nextId = 1;
        view.requestAnimationFrame = (callback: () => void): number => {
            const id = nextId++;
            callbacks.set(id, callback);
            return id;
        };
        view.cancelAnimationFrame = (id: number): void => {
            cancelled.push(id);
            callbacks.delete(id);
        };
        try {
            const scroller = createScroller(0, 500, 200);
            const fades = attachQaapScrollEdgeFades(scroller);
            expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
            for (const [id, callback] of [...callbacks.entries()]) {
                callbacks.delete(id);
                callback();
            }
            expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.true;

            setScrollTop(scroller, 300);
            scroller.dispatchEvent(new window.Event('scroll'));
            scroller.dispatchEvent(new window.Event('scroll'));
            expect(callbacks.size).to.equal(1, 'repeated scroll events share one pending frame');
            fades.dispose();
            expect(cancelled).to.have.length(1);
            expect(callbacks.size).to.equal(0);
            expect(scroller.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.false;
        } finally {
            view.requestAnimationFrame = savedRaf;
            view.cancelAnimationFrame = savedCaf;
        }
    });

    it('removes every fade class on dispose', () => {
        const scroller = createScroller(150, 500, 200);
        const fades = attachQaapScrollEdgeFades(scroller);
        fades.dispose();
        expect(scroller.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.false;
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.false;
        expect(scroller.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
    });

    describe('horizontal axis', () => {

        /** Fake horizontal rail whose geometry is fixed by the test; `scrollLeft` stays writable. */
        function createRail(scrollLeft: number, scrollWidth: number, clientWidth: number): HTMLElement {
            const rail = document.createElement('nav');
            document.body.appendChild(rail);
            Object.defineProperty(rail, 'scrollLeft', { value: scrollLeft, writable: true, configurable: true });
            Object.defineProperty(rail, 'scrollWidth', { value: scrollWidth, configurable: true });
            Object.defineProperty(rail, 'clientWidth', { value: clientWidth, configurable: true });
            return rail;
        }

        it('shows only the end fade when at the start with more content after it', () => {
            const rail = createRail(0, 500, 200);
            const fades = attachQaapScrollEdgeFades(rail, { axis: 'x' });
            expect(rail.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.true;
            expect(rail.classList.contains(QAAP_SCROLL_FADES_X_CLASS)).to.be.true;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_START_CLASS)).to.be.false;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_END_CLASS)).to.be.true;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.false;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
            fades.dispose();
        });

        it('shows both fades in the middle of the content', () => {
            const rail = createRail(150, 500, 200);
            const fades = attachQaapScrollEdgeFades(rail, { axis: 'x' });
            expect(rail.classList.contains(QAAP_SCROLL_FADE_START_CLASS)).to.be.true;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_END_CLASS)).to.be.true;
            fades.dispose();
        });

        it('shows only the start fade when scrolled to the end', () => {
            const rail = createRail(300, 500, 200);
            const fades = attachQaapScrollEdgeFades(rail, { axis: 'x' });
            expect(rail.classList.contains(QAAP_SCROLL_FADE_START_CLASS)).to.be.true;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_END_CLASS)).to.be.false;
            fades.dispose();
        });

        it('shows no fade when the content does not overflow', () => {
            const rail = createRail(0, 200, 200);
            const fades = attachQaapScrollEdgeFades(rail, { axis: 'x' });
            expect(rail.classList.contains(QAAP_SCROLL_FADE_START_CLASS)).to.be.false;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_END_CLASS)).to.be.false;
            fades.dispose();
        });

        it('ignores vertical geometry on the horizontal axis', () => {
            const rail = createRail(0, 200, 200);
            Object.defineProperty(rail, 'scrollHeight', { value: 900, configurable: true });
            Object.defineProperty(rail, 'clientHeight', { value: 100, configurable: true });
            const fades = attachQaapScrollEdgeFades(rail, { axis: 'x' });
            expect(rail.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
            fades.dispose();
        });

        it('updates start and end classes on scroll and removes all of them on dispose', () => {
            const rail = createRail(0, 500, 200);
            const fades = attachQaapScrollEdgeFades(rail, { axis: 'x' });
            Object.defineProperty(rail, 'scrollLeft', { value: 300, writable: true, configurable: true });
            rail.dispatchEvent(new window.Event('scroll'));
            expect(rail.classList.contains(QAAP_SCROLL_FADE_START_CLASS)).to.be.true;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_END_CLASS)).to.be.false;
            fades.dispose();
            expect(rail.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.false;
            expect(rail.classList.contains(QAAP_SCROLL_FADES_X_CLASS)).to.be.false;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_START_CLASS)).to.be.false;
            expect(rail.classList.contains(QAAP_SCROLL_FADE_END_CLASS)).to.be.false;
        });
    });
});
