// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    MobileKeyboardHelper,
    QAAP_MOBILE_KEYBOARD_OPEN_BODY_CLASS,
} from './mobile-keyboard-helper';

describe('mobile-keyboard-helper', () => {

    let disableJSDOM: (() => void) | undefined;
    let previousRequestAnimationFrame: typeof requestAnimationFrame | undefined;
    let previousCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        disableJSDOM?.();
        disableJSDOM = enableJSDOM();
        document.body.innerHTML = '';
        document.body.className = '';
        document.documentElement.style.cssText = '';
        previousRequestAnimationFrame = globalThis.requestAnimationFrame;
        previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
        const raf = (cb: FrameRequestCallback): number => {
            cb(0);
            return 1;
        };
        (global as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = raf;
        (global as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = () => undefined;
        (global as unknown as { window: Window }).window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = () => undefined;
    });

    afterEach(() => {
        if (previousRequestAnimationFrame) {
            globalThis.requestAnimationFrame = previousRequestAnimationFrame;
            window.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
            delete (globalThis as Partial<typeof globalThis>).requestAnimationFrame;
            delete (window as Partial<Window>).requestAnimationFrame;
        }
        if (previousCancelAnimationFrame) {
            globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
            window.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
            delete (globalThis as Partial<typeof globalThis>).cancelAnimationFrame;
            delete (window as Partial<Window>).cancelAnimationFrame;
        }
    });

    it('marks shell and body while the keyboard inset is active', () => {
        const shell = document.createElement('div');
        document.body.appendChild(shell);

        const innerHeight = 800;
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: innerHeight,
        });
        const visualViewport = {
            height: innerHeight - 300,
            offsetTop: 0,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        };
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        const helper = new MobileKeyboardHelper(shell);
        helper.install();

        expect(shell.classList.contains('theia-mod-mobile-keyboard-open')).to.equal(true);
        expect(document.body.classList.contains(QAAP_MOBILE_KEYBOARD_OPEN_BODY_CLASS)).to.equal(true);
        expect(document.documentElement.style.getPropertyValue('--theia-mobile-keyboard-inset')).to.equal('300px');

        helper.dispose();

        expect(shell.classList.contains('theia-mod-mobile-keyboard-open')).to.equal(false);
        expect(document.body.classList.contains(QAAP_MOBILE_KEYBOARD_OPEN_BODY_CLASS)).to.equal(false);
        expect(document.documentElement.style.getPropertyValue('--theia-mobile-keyboard-inset')).to.equal('');
    });

});
