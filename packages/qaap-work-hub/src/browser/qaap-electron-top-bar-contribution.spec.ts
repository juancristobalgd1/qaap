// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { environment } from '@theia/core/lib/common';
import { QaapElectronTopBarContribution } from './qaap-electron-top-bar-contribution';

describe('qaap-electron-top-bar-contribution', () => {
    let disableJSDOM: () => void;
    let isElectron: sinon.SinonStub;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        isElectron = sinon.stub(environment.electron, 'is').returns(true);
    });

    afterEach(() => {
        sinon.restore();
        delete (window as unknown as { electronTheiaCore?: unknown }).electronTheiaCore;
        disableJSDOM();
    });

    it('does nothing at start when the preload API is missing, even where Electron is detected', () => {
        const contribution = new QaapElectronTopBarContribution();
        expect(() => contribution.onStart(undefined as never)).to.not.throw();
        expect(isElectron.called).to.equal(true);
    });

    it('asks the preload API for the title bar style when it is present', async () => {
        const getTitleBarStyleAtStartup = sinon.stub().resolves('custom');
        (window as unknown as { electronTheiaCore?: unknown }).electronTheiaCore = { getTitleBarStyleAtStartup, isFullScreen: () => false };
        const contribution = new QaapElectronTopBarContribution();
        contribution.onStart(undefined as never);
        expect(getTitleBarStyleAtStartup.callCount).to.equal(1);
    });
});
