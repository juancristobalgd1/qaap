// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as shimModule from './qaap-deferred-perfect-scrollbar';
import QaapDeferredPerfectScrollbar from './qaap-deferred-perfect-scrollbar';

disableImportJSDOM();

describe('qaap-deferred-perfect-scrollbar', () => {

    let disableJSDOM: (() => void) | undefined;
    const globalEvents = global as unknown as { CustomEvent: typeof CustomEvent };
    let nodeCustomEvent: typeof CustomEvent;

    before(() => {
        disableJSDOM = enableJSDOM();
        // perfect-scrollbar fires `new CustomEvent(...)`; Node's own global would be rejected by jsdom elements.
        nodeCustomEvent = globalEvents.CustomEvent;
        globalEvents.CustomEvent = window.CustomEvent;
    });

    after(() => {
        globalEvents.CustomEvent = nodeCustomEvent;
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    function showSplash(): HTMLElement {
        const splash = document.createElement('div');
        splash.className = 'theia-preload';
        document.body.append(splash);
        return splash;
    }

    function scrollContainer(): HTMLElement {
        const container = document.createElement('div');
        document.body.append(container);
        return container;
    }

    function hasRails(container: HTMLElement): boolean {
        return !!container.querySelector('.ps__rail-y');
    }

    it('builds the scrollbar immediately once the app is revealed (upstream behaviour)', () => {
        const container = scrollContainer();
        const scrollbar = new QaapDeferredPerfectScrollbar(container, { suppressScrollX: true });

        expect(scrollbar.isCreated).to.equal(true);
        expect(hasRails(container)).to.equal(true);
        scrollbar.update();
        scrollbar.destroy();
        expect(hasRails(container)).to.equal(false);
    });

    it('is the default export, as the upstream `import PerfectScrollbar from` sites expect', () => {
        expect(shimModule.default).to.equal(QaapDeferredPerfectScrollbar);
    });

    it('waits behind the splash and builds the scrollbar after the splash is hidden', () => {
        const splash = showSplash();
        const container = scrollContainer();
        const scrollbar = new QaapDeferredPerfectScrollbar(container);

        expect(scrollbar.isCreated).to.equal(false);
        expect(scrollbar.isAlive).to.equal(true);
        scrollbar.update();
        QaapDeferredPerfectScrollbar.flush();
        expect(hasRails(container), 'still under the splash').to.equal(false);

        splash.classList.add('theia-hidden');
        QaapDeferredPerfectScrollbar.flush();

        expect(scrollbar.isCreated).to.equal(true);
        expect(scrollbar.element).to.equal(container);
        expect(hasRails(container)).to.equal(true);
        scrollbar.destroy();
    });

    it('never builds a scrollbar that was destroyed while it waited', () => {
        const splash = showSplash();
        const container = scrollContainer();
        const scrollbar = new QaapDeferredPerfectScrollbar(container);

        scrollbar.destroy();
        splash.remove();
        QaapDeferredPerfectScrollbar.flush();

        expect(scrollbar.isCreated).to.equal(false);
        expect(scrollbar.isAlive).to.equal(false);
        expect(hasRails(container)).to.equal(false);
    });
});
