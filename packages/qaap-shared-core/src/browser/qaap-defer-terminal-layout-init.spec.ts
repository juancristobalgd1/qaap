// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { clearPreferDesktopIde, QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY } from '../common/qaap-mobile-work-surface-preference';
import { shouldDeferTerminalLayoutInit } from './qaap-defer-terminal-layout-init';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('shouldDeferTerminalLayoutInit', () => {

    useSuiteJSDOM();

    /** Stubs the one-column media query: `mobile` true means a phone-sized viewport. */
    function setViewport(mobile: boolean): void {
        window.matchMedia = (query: string): MediaQueryList => ({
            matches: mobile,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        } as MediaQueryList);
    }

    beforeEach(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
        clearPreferDesktopIde();
    });

    it('defers the terminal on desktop in a fresh tab with no saved IDE preference', () => {
        setViewport(false);
        expect(shouldDeferTerminalLayoutInit()).to.equal(true);
    });

    it('does not defer on desktop once the user explicitly prefers the classic IDE', () => {
        setViewport(false);
        window.sessionStorage.setItem(QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY, '1');
        expect(shouldDeferTerminalLayoutInit()).to.equal(false);
    });

    it('defers the terminal on a phone-sized viewport', () => {
        setViewport(true);
        expect(shouldDeferTerminalLayoutInit()).to.equal(true);
    });
});
