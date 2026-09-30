// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Disposable } from '@theia/core/lib/common/disposable';
import { findNativeTouchScrollHost, installMobileNativeTouchScrollGuard } from './mobile-native-touch-scroll-guard';

disableJSDOM();

describe('installMobileNativeTouchScrollGuard', () => {

    let guard: Disposable | undefined;
    let upstreamPrevented: boolean;
    const upstreamListener = (event: Event): void => {
        upstreamPrevented = true;
        event.preventDefault();
    };

    const makeScroller = (scrollable: boolean): { scroller: HTMLElement; item: HTMLElement } => {
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: scrollable ? 500 : 100 });
        const item = document.createElement('span');
        scroller.append(item);
        document.body.append(scroller);
        return { scroller, item };
    };

    const touch = (target: HTMLElement, type: string, touches: number): TouchEvent => {
        const event = new window.Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
        Object.defineProperty(event, 'touches', { value: new Array(touches).fill({}) });
        target.dispatchEvent(event);
        return event;
    };

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        upstreamPrevented = false;
        document.addEventListener('touchmove', upstreamListener);
        guard = installMobileNativeTouchScrollGuard();
    });

    afterEach(() => {
        guard?.dispose();
        document.removeEventListener('touchmove', upstreamListener);
        disableJSDOM();
    });

    it('keeps the upstream preventDefault away from a pan inside a scrollable host', () => {
        const { item } = makeScroller(true);
        touch(item, 'touchstart', 1);
        const move = touch(item, 'touchmove', 1);
        expect(upstreamPrevented).to.equal(false);
        expect(move.defaultPrevented).to.equal(false);
    });

    it('lets the upstream listener handle moves outside any scrollable host', () => {
        const { item } = makeScroller(false);
        touch(item, 'touchstart', 1);
        touch(item, 'touchmove', 1);
        expect(upstreamPrevented).to.equal(true);
    });

    it('lets the upstream listener handle pinches', () => {
        const { item } = makeScroller(true);
        touch(item, 'touchstart', 2);
        touch(item, 'touchmove', 2);
        expect(upstreamPrevented).to.equal(true);
    });

    it('does not interfere once an element handler claimed the gesture', () => {
        const { scroller, item } = makeScroller(true);
        scroller.addEventListener('touchmove', event => event.preventDefault());
        touch(item, 'touchstart', 1);
        touch(item, 'touchmove', 1);
        expect(upstreamPrevented).to.equal(true);
    });

    it('finds the nearest scrollable ancestor', () => {
        const { scroller, item } = makeScroller(true);
        expect(findNativeTouchScrollHost(item)).to.equal(scroller);
    });
});
