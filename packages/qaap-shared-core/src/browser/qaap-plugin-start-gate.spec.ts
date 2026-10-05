// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { clearPreferDesktopIde, markPreferDesktopIde } from './mobile-projects-open';
import { QaapPluginStartGate } from './qaap-plugin-start-gate';

disableImportJSDOM();

function createGate(): QaapPluginStartGate {
    const container = new Container();
    container.bind(QaapPluginStartGate).toSelf().inSingletonScope();
    return container.get(QaapPluginStartGate);
}

describe('QaapPluginStartGate', () => {
    let disableSuiteJSDOM: () => void;
    before(() => { disableSuiteJSDOM = enableJSDOM(); });
    after(() => disableSuiteJSDOM());

    afterEach(() => {
        clearPreferDesktopIde();
        delete (window as { matchMedia?: unknown }).matchMedia;
    });

    /** A phone (narrow or coarse pointer), as `isQaapMobileDevice` sees it. */
    function emulatePhone(): void {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => ({ matches: true, media: query }),
        });
    }

    it('never starts plugins on a phone, even when it boots into the IDE or the IDE is shown', async () => {
        emulatePhone();
        markPreferDesktopIde();
        const gate = createGate();
        expect(gate.mobileDevice).to.equal(true);
        gate.release();
        expect(gate.released).to.equal(false);
        let started = false;
        void gate.whenReleased.then(() => { started = true; });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(started).to.equal(false);
    });

    it('holds plugins on a desktop Work Hub page, with or without a project, until the IDE is shown', () => {
        const gate = createGate();
        expect(gate.released).to.equal(false);
        expect(gate.mobileDevice).to.equal(false);
    });

    it('starts plugins at boot when the page boots into the IDE', async () => {
        markPreferDesktopIde();
        const gate = createGate();
        expect(gate.released).to.equal(true);
        await gate.whenReleased;
    });


    it('settles waiters once released', async () => {
        const gate = createGate();
        let started = false;
        const waiting = gate.whenReleased.then(() => { started = true; });
        await Promise.resolve();
        expect(started).to.equal(false);
        gate.release();
        await waiting;
        expect(started).to.equal(true);
    });
});
