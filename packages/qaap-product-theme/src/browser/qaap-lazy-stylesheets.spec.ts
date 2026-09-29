// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { QaapLazyStylesheets } from './qaap-lazy-stylesheets';

describe('QaapLazyStylesheets.loadModules', () => {

    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    const lazyHrefs = (): string[] => Array.from(document.querySelectorAll('link[data-qaap-lazy]'))
        .map(link => link.getAttribute('href') ?? '');

    it('resolves without attaching anything when the ?qaap-lazy import cannot be resolved (unbundled, e.g. mocha)', async () => {
        await QaapLazyStylesheets.loadModules(Promise.reject(new Error('Cannot find module \'foo.css?qaap-lazy\'')));
        expect(lazyHrefs()).to.deep.equal([]);
    });

    it('attaches the resolved stylesheets in argument order, skipping unresolved ones', async () => {
        const loading = QaapLazyStylesheets.loadModules(
            Promise.resolve({ default: 'chunk-FIRST.css' }),
            Promise.reject(new Error('unresolved')),
            Promise.resolve({ default: 'chunk-SECOND.css' }),
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        const links = Array.from(document.querySelectorAll('link[data-qaap-lazy]'));
        expect(lazyHrefs()).to.deep.equal(['chunk-FIRST.css', 'chunk-SECOND.css']);
        links.forEach(link => link.dispatchEvent(new window.Event('load')));
        await loading;
    });
});
