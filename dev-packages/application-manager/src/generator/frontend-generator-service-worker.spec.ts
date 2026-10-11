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
    registrationScript(): string {
        return this.compileServiceWorkerRegistration();
    }

    serviceWorkerScript(): string {
        return this.compileServiceWorker();
    }

    protected override resolveServiceWorkerVersion(): string {
        return 'test';
    }

    protected override getPwaManifestConfig(): undefined {
        return undefined;
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

interface ServiceWorkerFetchEvent {
    request: object;
    preloadResponse: Promise<object | undefined>;
    respondWith(response: Promise<object>): void;
}

interface LoadedServiceWorker {
    networkRequests: string[];
    dispatchFetch(event: ServiceWorkerFetchEvent): void;
}

const ORIGIN = 'https://qaap.203-0-113-7.sslip.io';

function loadServiceWorker(): LoadedServiceWorker {
    const generator = Object.create(TestFrontendGenerator.prototype) as TestFrontendGenerator;
    Object.assign(generator, { pck: { props: { frontend: { config: { applicationName: 'Qaap' } } } } });
    const listeners = new Map<string, (event: ServiceWorkerFetchEvent) => void>();
    const worker: LoadedServiceWorker = {
        networkRequests: [],
        dispatchFetch: event => listeners.get('fetch')?.(event)
    };
    vm.runInNewContext(generator.serviceWorkerScript(), {
        self: {
            location: { origin: ORIGIN },
            addEventListener: (type: string, listener: (event: ServiceWorkerFetchEvent) => void) => listeners.set(type, listener)
        },
        fetch: (request: { url: string }) => {
            worker.networkRequests.push(request.url);
            return Promise.resolve({ fromNetwork: true });
        },
        caches: { open: () => Promise.reject(new Error('no cache in tests')), match: () => Promise.resolve(undefined) },
        URL,
        console
    });
    return worker;
}

function navigation(pathAndQuery: string, preload: object | undefined | Error): { event: ServiceWorkerFetchEvent; responses: Array<Promise<object>> } {
    const responses: Array<Promise<object>> = [];
    const event: ServiceWorkerFetchEvent = {
        request: {
            method: 'GET',
            url: ORIGIN + pathAndQuery,
            mode: 'navigate',
            cache: 'default',
            destination: 'document',
            headers: { has: () => false, get: () => undefined }
        },
        preloadResponse: preload instanceof Error ? Promise.reject(preload) : Promise.resolve(preload),
        respondWith: response => responses.push(response)
    };
    return { event, responses };
}

describe('FrontendGenerator service worker navigation preload', () => {

    it('answers a bypassed OAuth callback navigation with its preload response (one request, not two)', async () => {
        // With navigation preload enabled the browser has already sent the callback request when the
        // fetch event fires. Returning without respondWith makes it send the callback a second time:
        // the first request consumes the single-use OAuth state and the second fails with state_lost.
        const worker = loadServiceWorker();
        const preload = { preloaded: true };
        const { event, responses } = navigation('/qaap/oauth/github/callback?code=c&state=s', preload);
        worker.dispatchFetch(event);
        expect(responses).to.have.length(1);
        expect(await responses[0]).to.equal(preload);
        expect(worker.networkRequests).to.deep.equal([]);
    });

    it('fetches a bypassed navigation from the network exactly once when there is no preload', async () => {
        const worker = loadServiceWorker();
        const { event, responses } = navigation('/qaap/oauth/github/start', undefined);
        worker.dispatchFetch(event);
        expect(responses).to.have.length(1);
        expect(await responses[0]).to.deep.equal({ fromNetwork: true });
        expect(worker.networkRequests).to.deep.equal([ORIGIN + '/qaap/oauth/github/start']);
    });

    it('falls back to the network once when the navigation preload failed', async () => {
        const worker = loadServiceWorker();
        const { event, responses } = navigation('/qaap/oauth/github/start', new Error('offline'));
        worker.dispatchFetch(event);
        expect(await responses[0]).to.deep.equal({ fromNetwork: true });
        expect(worker.networkRequests).to.have.length(1);
    });
});
