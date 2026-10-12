// *****************************************************************************
// Copyright (C) 2026 Qaap and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as vm from 'vm';
import { FrontendGenerator } from './frontend-generator';

class TestFrontendGenerator extends FrontendGenerator {
    serviceWorkerScript(): string {
        return this.compileServiceWorker();
    }
    registrationScript(): string {
        return this.compileServiceWorkerRegistration();
    }
}

interface RegistrationPage {
    reloads: number;
    fireControllerChange(): void;
}

function loadRegistrationScript(initialController: object | undefined): RegistrationPage {
    const generator = Object.create(TestFrontendGenerator.prototype) as TestFrontendGenerator;
    const html = generator.registrationScript();
    const js = html.replace(/^\s*<script[^>]*>/, '').replace(/<\/script>\s*$/, '');
    const listeners: Array<() => void> = [];
    const page: RegistrationPage = {
        reloads: 0,
        fireControllerChange: () => listeners.forEach(listener => listener())
    };
    const serviceWorker = {
        controller: initialController,
        register: () => new Promise(() => { /* registration stays pending */ }),
        addEventListener: (type: string, listener: () => void) => {
            if (type === 'controllerchange') {
                listeners.push(listener);
            }
        }
    };
    vm.runInNewContext(js, {
        navigator: { serviceWorker },
        document: { readyState: 'complete', addEventListener: () => { } },
        window: { location: { search: '' } },
        location: { reload: () => { page.reloads++; } },
        setInterval: () => 0
    });
    return page;
}

describe('FrontendGenerator service worker registration', () => {

    it('does not reload a page that no service worker controlled yet (first install claims it)', () => {
        // clients.claim() on the first install fires controllerchange. Reloading there starts the
        // frontend twice ("loading modules..." twice) on every fresh profile.
        const page = loadRegistrationScript(undefined);
        page.fireControllerChange();
        expect(page.reloads).to.equal(0);
    });

    it('reloads once when a new service worker replaces the one that controlled the page', () => {
        const page = loadRegistrationScript({});
        page.fireControllerChange();
        page.fireControllerChange();
        expect(page.reloads).to.equal(1);
    });
});

interface SwHarness {
    fetches: string[];
    /** Dispatches a GET for `path`; returns the handled response body, or undefined when passed through. */
    request(path: string): Promise<string | undefined>;
}

function loadServiceWorker(): SwHarness {
    const generator = Object.create(TestFrontendGenerator.prototype) as TestFrontendGenerator;
    const self = generator as unknown as { pck: unknown; options: unknown };
    self.pck = { pck: { version: '1.0.0' }, props: { frontend: { config: { applicationName: 'Qaap' } } } };
    self.options = { mode: 'production' };
    const js = generator.serviceWorkerScript();
    const stores = new Map<string, Map<string, string>>();
    const fetches: string[] = [];
    const listeners: Record<string, (event: unknown) => void> = {};
    const makeResponse = (body: string, ok = true): object => ({ ok, type: 'basic', body, clone: () => makeResponse(body, ok) });
    const caches = {
        keys: async () => [...stores.keys()],
        delete: async (name: string) => stores.delete(name),
        open: async (name: string) => {
            const store = stores.get(name) ?? new Map<string, string>();
            stores.set(name, store);
            return {
                match: async (req: { url: string }) => store.has(req.url) ? makeResponse(store.get(req.url)!) : undefined,
                put: async (req: { url: string }, res: { body: string }) => { store.set(req.url, res.body); },
                add: async () => { }
            };
        }
    };
    const context = {
        URL, Request: class { }, Response: class { constructor(public body: string, public init?: object) { } },
        console, caches,
        fetch: async (req: { url: string }) => { fetches.push(req.url); return makeResponse('net:' + req.url); },
        self: {
            location: { origin: 'https://app.test' },
            skipWaiting: () => { },
            addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; }
        }
    };
    vm.runInNewContext(js, context);
    return {
        fetches,
        request: async (path: string) => {
            let handled: Promise<{ body: string }> | undefined;
            listeners['fetch']({
                request: { method: 'GET', url: 'https://app.test' + path, mode: 'no-cors', cache: 'default', destination: 'script', headers: { has: () => false, get: () => '' } },
                respondWith: (p: Promise<{ body: string }>) => { handled = p; }
            });
            return handled ? (await handled).body : undefined;
        }
    };
}

describe('FrontendGenerator service worker caching strategy', () => {

    it('serves content-hashed chunks cache-first (second request does not hit the network)', async () => {
        const sw = loadServiceWorker();
        expect(await sw.request('/chunk-ABC123XY.js')).to.equal('net:https://app.test/chunk-ABC123XY.js');
        expect(await sw.request('/chunk-ABC123XY.js')).to.equal('net:https://app.test/chunk-ABC123XY.js');
        expect(sw.fetches).to.have.length(1);
    });

    it('keeps the bundle.js entry network-first', async () => {
        const sw = loadServiceWorker();
        await sw.request('/bundle.js');
        await sw.request('/bundle.js');
        expect(sw.fetches).to.have.length(2);
    });

    it('keeps the bundle-mobile.js entry network-first exactly like bundle.js', async () => {
        const sw = loadServiceWorker();
        expect(await sw.request('/bundle-mobile.js')).to.equal('net:https://app.test/bundle-mobile.js');
        await sw.request('/bundle-mobile.js');
        expect(sw.fetches).to.have.length(2);
    });

    it('evicts caches of other versions on activate', () => {
        const generator = Object.create(TestFrontendGenerator.prototype) as TestFrontendGenerator;
        (generator as unknown as { pck: unknown }).pck = { pck: { version: '1.0.0' }, props: { frontend: { config: { applicationName: 'Qaap' } } } };
        (generator as unknown as { options: unknown }).options = { mode: 'production' };
        const js = generator.serviceWorkerScript();
        expect(js).to.contain('name !== SHELL_CACHE && name !== RUNTIME_CACHE');
    });
});
