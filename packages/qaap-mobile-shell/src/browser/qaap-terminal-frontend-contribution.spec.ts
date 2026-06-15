// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

describe('qaap-defer-terminal-layout-init', () => {

    let shouldDeferTerminalLayoutInit: () => boolean;
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        shouldDeferTerminalLayoutInit = require('./qaap-defer-terminal-layout-init').shouldDeferTerminalLayoutInit;
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('defers terminal layout init on narrow viewport with workspace route', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => ({
                matches: query.includes('767px'),
                media: query,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
            }),
        });
        window.location.hash = '#/tmp/qaap-ws';
        expect(shouldDeferTerminalLayoutInit()).to.equal(true);
    });
});
