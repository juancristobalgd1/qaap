// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { HostedPluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { QaapPluginStartGate } from '@theia/qaap-shared-core/lib/browser/qaap-plugin-start-gate';
import { clearPreferDesktopIde } from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import { QaapPluginLoadGate } from './qaap-plugin-load-gate';

disableImportJSDOM();

/** Records every call the page makes to the backend plugin server. */
function recordingServer(calls: string[]): HostedPluginServer {
    return new Proxy({}, {
        get: (_target, name) => (..._args: unknown[]) => {
            calls.push(String(name));
            return Promise.resolve([]);
        },
    }) as HostedPluginServer;
}

function createStartGate(): QaapPluginStartGate {
    const container = new Container();
    container.bind(QaapPluginStartGate).toSelf().inSingletonScope();
    return container.get(QaapPluginStartGate);
}

describe('QaapPluginLoadGate', () => {
    let disableSuiteJSDOM: () => void;
    before(() => { disableSuiteJSDOM = enableJSDOM(); });
    after(() => disableSuiteJSDOM());

    afterEach(() => {
        clearPreferDesktopIde();
        delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it('a Work Hub page never calls the plugin server (no deployment, no plugin host) until the IDE is shown', async () => {
        const calls: string[] = [];
        const startGate = createStartGate();
        let loads = 0;
        const loadGate = new QaapPluginLoadGate(startGate, recordingServer(calls), () => loads++);

        expect(await loadGate.beginSync()).to.equal(false);
        expect(loadGate.syncHeld).to.equal(true);
        expect(await loadGate.beginSync()).to.equal(false);
        expect(calls).to.deep.equal([]);

        startGate.release();
        await startGate.whenReleased;
        await Promise.resolve();
        expect(loads).to.equal(1);
        expect(await loadGate.beginSync()).to.equal(true);
        expect(loadGate.syncHeld).to.equal(false);
        expect(calls).to.deep.equal(['requestPlugins']);
    });

    it('a phone never calls the plugin server, even after the IDE was shown', async () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => ({ matches: true, media: query }),
        });
        const calls: string[] = [];
        const startGate = createStartGate();
        let loads = 0;
        const loadGate = new QaapPluginLoadGate(startGate, recordingServer(calls), () => loads++);
        startGate.release();
        expect(await loadGate.beginSync()).to.equal(false);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(loads).to.equal(0);
        expect(calls).to.deep.equal([]);
    });
});
