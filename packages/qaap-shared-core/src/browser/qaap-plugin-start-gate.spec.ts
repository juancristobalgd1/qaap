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

    afterEach(() => clearPreferDesktopIde());

    it('holds plugins on a Work Hub page without a project (it may reload into the IDE)', () => {
        const gate = createGate();
        gate.releaseForBootWorkspace(undefined);
        gate.releaseForBootWorkspace('/workspace/repos/users/alice');
        expect(gate.released).to.equal(false);
    });

    it('starts plugins at boot when the page boots into the IDE', async () => {
        markPreferDesktopIde();
        const gate = createGate();
        expect(gate.released).to.equal(true);
        await gate.whenReleased;
    });

    it('starts plugins on a Work Hub page rooted on a project', () => {
        const gate = createGate();
        gate.releaseForBootWorkspace('/workspace/repos/users/alice/acme/landing');
        expect(gate.released).to.equal(true);
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
