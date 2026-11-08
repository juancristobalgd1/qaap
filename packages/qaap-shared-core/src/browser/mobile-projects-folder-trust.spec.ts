// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as sinon from 'sinon';
import { MobileProjectFolderTrust, MobileProjectFolderTrustDialogOptions } from './mobile-projects-folder-trust';

disableJSDOM();

const CWD = '/workspace/repos/users/alice/app';

/** Folder trust with the dialog replaced by a controllable promise, so tests can count and answer dialogs. */
class ControllableFolderTrust extends MobileProjectFolderTrust {

    readonly dialogs: Array<(answer: boolean | undefined) => void> = [];

    protected override openTrustDialog(_options: MobileProjectFolderTrustDialogOptions): Promise<boolean | undefined> {
        return new Promise(resolve => this.dialogs.push(resolve));
    }
}

describe('MobileProjectFolderTrust', () => {

    let trust: ControllableFolderTrust;
    let load: sinon.SinonStub;
    let setTrusted: sinon.SinonStub;

    beforeEach(() => {
        trust = new ControllableFolderTrust();
        load = sinon.stub(trust.client, 'load').resolves({ cwd: CWD, decided: false, trusted: false });
        setTrusted = sinon.stub(trust.client, 'setTrusted').callsFake(async (cwd: string, value: boolean) => ({ cwd, decided: true, trusted: value }));
    });

    afterEach(() => {
        sinon.restore();
    });

    /** Lets pending microtasks (the status load) run so the dialog is opened. */
    async function flush(): Promise<void> {
        for (let i = 0; i < 5; i++) {
            await Promise.resolve();
        }
    }

    it('opens one dialog per folder even when asked again while the first is still loading', async () => {
        const first = trust.askIfUndecided(CWD, 'app');
        const second = trust.askIfUndecided(CWD, 'app');
        await flush();
        expect(trust.dialogs).to.have.length(1);
        trust.dialogs[0](true);
        await Promise.all([first, second]);
        expect(setTrusted.calledOnceWith(CWD, true)).to.equal(true);
    });

    it('opens one dialog per folder while the dialog is still open', async () => {
        const first = trust.askIfUndecided(CWD, 'app');
        await flush();
        const again = trust.askIfUndecided(CWD, 'app');
        await flush();
        expect(trust.dialogs).to.have.length(1);
        trust.dialogs[0](false);
        await Promise.all([first, again]);
        expect(setTrusted.calledOnceWith(CWD, false)).to.equal(true);
    });

    it('records nothing when the dialog is dismissed, and does not ask again this session', async () => {
        const first = trust.askIfUndecided(CWD, 'app');
        await flush();
        trust.dialogs[0](undefined);
        await first;
        expect(setTrusted.called).to.equal(false);
        await trust.askIfUndecided(CWD, 'app');
        expect(trust.dialogs).to.have.length(1);
    });

    it('does not open the dialog for a folder that already has a decision', async () => {
        load.resolves({ cwd: CWD, decided: true, trusted: true });
        await trust.askIfUndecided(CWD, 'app');
        expect(trust.dialogs).to.have.length(0);
        expect(load.calledOnceWith(CWD)).to.equal(true);
    });

    it('does not open the dialog when the status could not be read', async () => {
        load.resolves(undefined);
        await trust.askIfUndecided(CWD, 'app');
        expect(trust.dialogs).to.have.length(0);
        expect(trust.isTrusted(CWD)).to.equal(false);
    });

    it('carries the opened folder across a reload exactly once', () => {
        const storage = new Map<string, string>();
        const fakeStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
        };
        const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
        Object.defineProperty(globalThis, 'sessionStorage', { value: fakeStorage, configurable: true });
        try {
            expect(trust.takeAskAfterReload()).to.equal(undefined);
            trust.markAskAfterReload(CWD);
            expect(trust.takeAskAfterReload()).to.equal(CWD);
            expect(trust.takeAskAfterReload()).to.equal(undefined);
        } finally {
            if (original) {
                Object.defineProperty(globalThis, 'sessionStorage', original);
            } else {
                delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
            }
        }
    });
});
