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

    it('reuses a stylesheet the login gate already attached and keeps later sheets after it', async () => {
        const anchor = document.createElement('link');
        anchor.rel = 'stylesheet';
        anchor.href = 'bundle-mobile.css';
        const preattached = document.createElement('link');
        preattached.rel = 'stylesheet';
        preattached.href = 'chunk-BOOT.css';
        preattached.dataset.qaapLazy = '';
        document.head.append(anchor, preattached);
        const loading = QaapLazyStylesheets.loadModules(
            Promise.resolve({ default: 'chunk-BOOT.css' }),
            Promise.resolve({ default: 'chunk-LATER.css' }),
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(lazyHrefs().filter(href => href === 'chunk-BOOT.css')).to.have.length(1);
        expect(preattached.nextElementSibling?.getAttribute('href')).to.equal('chunk-LATER.css');
        Array.from(document.querySelectorAll('link[data-qaap-lazy]')).forEach(link => link.dispatchEvent(new window.Event('load')));
        await loading;
    });

    const preattach = (href: string, state?: string): HTMLLinkElement => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.qaapLazy = '';
        if (state) {
            link.dataset.qaapLazyState = state;
        }
        document.head.appendChild(link);
        return link;
    };

    it('resolves immediately for a pre-attached link the gate already saw load', async () => {
        const link = preattach('chunk-DONE.css', 'loaded');
        await QaapLazyStylesheets.loadModules(Promise.resolve({ default: 'chunk-DONE.css' }));
        expect(link.isConnected).to.equal(true);
    });

    it('retries once with a fresh link when the pre-attached link already errored, then resolves', async () => {
        const failed = preattach('chunk-BAD.css', 'error');
        const loading = QaapLazyStylesheets.loadModules(Promise.resolve({ default: 'chunk-BAD.css' }));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(failed.isConnected).to.equal(false);
        const retry = document.querySelector<HTMLLinkElement>('link[data-qaap-lazy][href="chunk-BAD.css"]');
        expect(retry).to.not.equal(null);
        retry!.dispatchEvent(new window.Event('error'));
        await loading;
    });

    it('waits for a still-loading pre-attached link and settles on its load event', async () => {
        const link = preattach('chunk-SLOW.css');
        let settled = false;
        const loading = QaapLazyStylesheets.loadModules(Promise.resolve({ default: 'chunk-SLOW.css' })).then(() => { settled = true; });
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(settled).to.equal(false);
        link.dispatchEvent(new window.Event('load'));
        await loading;
        expect(settled).to.equal(true);
    });
});
