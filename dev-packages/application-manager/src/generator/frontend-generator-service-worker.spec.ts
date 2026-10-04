// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
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
import { ApplicationPackage } from '@theia/application-package';
import { FrontendGenerator } from './frontend-generator';

const ORIGIN = 'https://app.test';
const ENTRY_HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

class TestFrontendGenerator extends FrontendGenerator {
    serviceWorker(): string {
        return this.compileServiceWorker();
    }
    registration(): string {
        return this.compileServiceWorkerRegistration();
    }
}

function createGenerator(): TestFrontendGenerator {
    const pck = {
        pck: { version: '1.2.3' },
        props: { frontend: { config: { applicationName: 'Qaap App', pwa: {} } } }
    };
    return new TestFrontendGenerator(pck as unknown as ApplicationPackage, { mode: 'production' });
}

/** Same rewrite the post-bundle step (`copy-frontend-static.mjs`) applies. */
function stampEntryBuild(source: string, hash: string): string {
    return source.replace(/\bQAAP_ENTRY_BUILD(\s*=\s*)"[^"]*"/g, `QAAP_ENTRY_BUILD$1"${hash}"`);
}

class FakeCache {
    readonly entries = new Map<string, Response>();
    puts = 0;
    async match(request: Request | string): Promise<Response | undefined> {
        return this.entries.get(cacheKey(request))?.clone();
    }
    async put(request: Request | string, response: Response): Promise<void> {
        this.puts++;
        this.entries.set(cacheKey(request), response);
    }
    async add(request: Request | string): Promise<void> {
        this.entries.set(cacheKey(request), new Response('shell'));
    }
    async delete(request: Request | string): Promise<boolean> {
        return this.entries.delete(cacheKey(request));
    }
}

function cacheKey(request: Request | string): string {
    return typeof request === 'string' ? new URL(request, ORIGIN + '/').href : request.url;
}

class FakeCacheStorage {
    readonly stores = new Map<string, FakeCache>();
    async open(name: string): Promise<FakeCache> {
        let cache = this.stores.get(name);
        if (!cache) {
            cache = new FakeCache();
            this.stores.set(name, cache);
        }
        return cache;
    }
    async keys(): Promise<string[]> {
        return [...this.stores.keys()];
    }
    async delete(name: string): Promise<boolean> {
        return this.stores.delete(name);
    }
    async match(request: Request | string): Promise<Response | undefined> {
        for (const cache of this.stores.values()) {
            const hit = await cache.match(request);
            if (hit) {
                return hit;
            }
        }
        return undefined;
    }
}

interface DispatchedEvent {
    response?: Promise<Response>;
    waits: Promise<unknown>[];
}

class ServiceWorkerHarness {
    readonly caches = new FakeCacheStorage();
    readonly handlers = new Map<string, (event: object) => void>();
    readonly network: string[] = [];
    windowIds: string[] = [];
    skipWaitingCalls = 0;
    active: object | undefined;
    respond: (url: string) => Response = () => new Response('body', {
        headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    });
    readonly context: vm.Context;

    constructor(source: string) {
        const harness = this;
        const self = {
            location: { origin: ORIGIN },
            registration: {
                scope: ORIGIN + '/',
                get active(): object | undefined { return harness.active; }
            },
            clients: {
                matchAll: async () => harness.windowIds.map(id => ({ id })),
                claim: async () => undefined
            },
            skipWaiting: async () => { harness.skipWaitingCalls++; },
            addEventListener: (type: string, handler: (event: object) => void) => harness.handlers.set(type, handler)
        };
        this.context = vm.createContext({
            self,
            caches: this.caches,
            fetch: async (request: Request) => {
                harness.network.push(request.url);
                return harness.respond(request.url);
            },
            Request, Response, URL, Set, Promise, JSON,
            console: { warn: () => undefined, log: () => undefined }
        });
        vm.runInContext(source, this.context);
    }

    evaluate<T>(expression: string): T {
        return vm.runInContext(expression, this.context) as T;
    }

    async dispatch(type: string, init: object = {}): Promise<DispatchedEvent> {
        const event: DispatchedEvent & Record<string, unknown> = {
            waits: [],
            ...init,
            waitUntil(promise: Promise<unknown>): void { event.waits.push(promise); },
            respondWith(promise: Promise<Response>): void { event.response = promise; }
        };
        this.handlers.get(type)!(event);
        await event.response;
        await Promise.all(event.waits);
        return event;
    }

    fetch(path: string, init: RequestInit = {}): Promise<DispatchedEvent> {
        return this.dispatch('fetch', { request: new Request(ORIGIN + path, init) });
    }

    navigate(): Promise<DispatchedEvent> {
        // Node's Request cannot be constructed in `navigate` mode.
        return this.dispatch('fetch', { request: { url: ORIGIN + '/', method: 'GET', mode: 'navigate', cache: 'default', destination: 'document', headers: new Headers() } });
    }
}

describe('FrontendGenerator service worker', () => {

    let savedBuildVersion: string | undefined;
    let savedVercelSha: string | undefined;

    beforeEach(() => {
        savedBuildVersion = process.env.BUILD_VERSION;
        savedVercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
        delete process.env.BUILD_VERSION;
        delete process.env.VERCEL_GIT_COMMIT_SHA;
    });

    afterEach(() => {
        restoreEnv('BUILD_VERSION', savedBuildVersion);
        restoreEnv('VERCEL_GIT_COMMIT_SHA', savedVercelSha);
    });

    function restoreEnv(name: string, value: string | undefined): void {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }

    function stampedWorker(hash = ENTRY_HASH): ServiceWorkerHarness {
        return new ServiceWorkerHarness(stampEntryBuild(createGenerator().serviceWorker(), hash));
    }

    describe('build-keyed caches', () => {

        it('keys caches by BUILD_VERSION when it is set', () => {
            process.env.BUILD_VERSION = 'deploy-42';
            const worker = new ServiceWorkerHarness(stampEntryBuild(createGenerator().serviceWorker(), ENTRY_HASH));
            expect(worker.evaluate<string>('RUNTIME_CACHE')).to.equal('qaap-app-runtime-1.2.3+deploy-42');
        });

        it('falls back to the entry bundle fingerprint without BUILD_VERSION', () => {
            expect(stampedWorker().evaluate<string>('RUNTIME_CACHE')).to.equal(`qaap-app-runtime-1.2.3+${ENTRY_HASH.slice(0, 16)}`);
            expect(stampedWorker(OTHER_HASH).evaluate<string>('SHELL_CACHE')).to.equal(`qaap-app-shell-1.2.3+${OTHER_HASH.slice(0, 16)}`);
        });

        it('keeps the package version when the entry fingerprint was never stamped', () => {
            const worker = new ServiceWorkerHarness(createGenerator().serviceWorker());
            expect(worker.evaluate<string>('RUNTIME_CACHE')).to.equal('qaap-app-runtime-1.2.3');
            expect(worker.evaluate<string>('ENTRY_BUILD')).to.equal('');
        });

        it('reports its entry build to pages that ask', async () => {
            const worker = stampedWorker();
            const replies: unknown[] = [];
            await worker.dispatch('message', { data: { type: 'QAAP_SW_BUILD' }, ports: [{ postMessage: (reply: unknown) => replies.push(reply) }] });
            expect(replies).to.deep.equal([{ entryBuild: ENTRY_HASH, version: `1.2.3+${ENTRY_HASH.slice(0, 16)}` }]);
        });
    });

    describe('install', () => {

        it('activates the first worker at once', async () => {
            const worker = stampedWorker();
            await worker.dispatch('install');
            expect(worker.skipWaitingCalls).to.equal(1);
        });

        it('lets an update wait instead of taking over open tabs', async () => {
            const worker = stampedWorker();
            worker.active = {};
            await worker.dispatch('install');
            expect(worker.skipWaitingCalls).to.equal(0);
        });
    });

    describe('fetch', () => {

        it('serves hashed chunks cache-first and writes each one once', async () => {
            const worker = stampedWorker();
            const first = await worker.fetch('/chunk-ABC123.js');
            const second = await worker.fetch('/chunk-ABC123.js');
            expect(worker.network).to.deep.equal([`${ORIGIN}/chunk-ABC123.js`]);
            expect(await (await second.response!).text()).to.equal('body');
            expect(first.response).to.not.equal(undefined);
            const runtime = worker.caches.stores.get(worker.evaluate<string>('RUNTIME_CACHE'))!;
            expect(runtime.puts).to.equal(1);
        });

        it('serves fingerprinted entry assets cache-first', async () => {
            const worker = stampedWorker();
            await worker.fetch(`/bundle.js?qaap-build=${ENTRY_HASH}`);
            await worker.fetch(`/bundle.js?qaap-build=${ENTRY_HASH}`);
            expect(worker.network).to.have.length(1);
        });

        it('does not store a fingerprinted response the server did not mark immutable', async () => {
            const worker = stampedWorker();
            worker.respond = () => new Response('new bytes', { headers: { 'Cache-Control': 'no-cache' } });
            await worker.fetch(`/bundle.js?qaap-build=${OTHER_HASH}`);
            await worker.fetch(`/bundle.js?qaap-build=${OTHER_HASH}`);
            expect(worker.network).to.have.length(2);
        });

        it('leaves unfingerprinted code to the network and never copies it into Cache Storage', async () => {
            const worker = stampedWorker();
            for (const path of ['/bundle.js', '/bundle.css?v=1', '/chunk-ABC123.js?v=1', '/nested/chunk-ABC123.js', '/secondary-window.js']) {
                const event = await worker.fetch(path);
                expect(event.response, path).to.equal(undefined);
            }
            expect([...worker.caches.stores.values()].every(cache => cache.puts === 0)).to.equal(true);
        });

        it('serves a previous build\'s cached chunk after a deploy removed it from the server', async () => {
            const worker = stampedWorker();
            const previous = await worker.caches.open('qaap-app-runtime-1.2.3+previous');
            await previous.put(`${ORIGIN}/chunk-OLD1.js`, new Response('old chunk'));
            worker.respond = () => new Response('missing', { status: 404 });
            const event = await worker.fetch('/chunk-OLD1.js');
            expect(await (await event.response!).text()).to.equal('old chunk');
            expect(worker.network).to.deep.equal([]);
        });

        it('does not rewrite a revalidated static asset whose bytes did not change', async () => {
            const worker = stampedWorker();
            worker.respond = () => new Response('font', { headers: { ETag: '"v1"' } });
            await worker.fetch('/fonts/codicon.ttf');
            await worker.fetch('/fonts/codicon.ttf');
            const runtime = worker.caches.stores.get(worker.evaluate<string>('RUNTIME_CACHE'))!;
            expect(worker.network).to.have.length(2);
            expect(runtime.puts).to.equal(1);
        });
    });

    describe('activate', () => {

        async function seedCaches(worker: ServiceWorkerHarness): Promise<void> {
            await worker.caches.open('qaap-app-runtime-1.2.3+previous');
            await worker.caches.open('qaap-app-shell-1.2.3+previous');
            await worker.caches.open(worker.evaluate<string>('RUNTIME_CACHE'));
            await worker.caches.open(worker.evaluate<string>('SHELL_CACHE'));
            await worker.caches.open('unrelated-cache');
        }

        it('deletes other builds\' caches when no window is open', async () => {
            const worker = stampedWorker();
            await seedCaches(worker);
            await worker.dispatch('activate');
            expect(await worker.caches.keys()).to.have.members([
                worker.evaluate<string>('RUNTIME_CACHE'),
                worker.evaluate<string>('SHELL_CACHE'),
                'unrelated-cache'
            ]);
        });

        it('keeps other builds\' caches until every window open at activation is gone', async () => {
            const worker = stampedWorker();
            await seedCaches(worker);
            worker.windowIds = ['old-tab', 'other-tab'];
            await worker.dispatch('activate');
            expect(await worker.caches.keys()).to.include('qaap-app-runtime-1.2.3+previous');

            worker.windowIds = ['other-tab', 'reloaded-tab'];
            await worker.navigate();
            expect(await worker.caches.keys()).to.include('qaap-app-runtime-1.2.3+previous');

            worker.windowIds = ['reloaded-tab'];
            await worker.navigate();
            const remaining = await worker.caches.keys();
            expect(remaining).to.not.include('qaap-app-runtime-1.2.3+previous');
            expect(remaining).to.not.include('qaap-app-shell-1.2.3+previous');
            expect(remaining).to.include(worker.evaluate<string>('RUNTIME_CACHE'));
        });
    });
});

class FakeWorker {
    readonly messages: unknown[] = [];
    readonly listeners = new Map<string, () => void>();
    state = 'installing';
    constructor(protected readonly entryBuild: string) { }
    postMessage(message: { type: string }, ports?: { postMessage(reply: unknown): void }[]): void {
        this.messages.push(message);
        if (message.type === 'QAAP_SW_BUILD' && ports) {
            ports[0].postMessage({ entryBuild: this.entryBuild });
        }
    }
    addEventListener(type: string, listener: () => void): void {
        this.listeners.set(type, listener);
    }
}

class RegistrationHarness {
    readonly navigatorListeners = new Map<string, () => void>();
    readonly registrationListeners = new Map<string, () => void>();
    readonly announcements: string[] = [];
    reloads = 0;
    controller: FakeWorker | undefined;
    waiting: FakeWorker | undefined;
    installing: FakeWorker | undefined;
    readonly window: { __qaapServiceWorkerUpdate?: { apply(): void } } & Record<string, unknown>;

    constructor(script: string, controller: FakeWorker | undefined, waiting?: FakeWorker) {
        this.controller = controller;
        this.waiting = waiting;
        const harness = this;
        const registration = {
            get waiting(): FakeWorker | undefined { return harness.waiting; },
            get installing(): FakeWorker | undefined { return harness.installing; },
            update: async () => undefined,
            addEventListener: (type: string, listener: () => void) => harness.registrationListeners.set(type, listener)
        };
        this.window = {
            location: { search: '', reload: () => { harness.reloads++; } },
            dispatchEvent: (event: { type: string }) => { harness.announcements.push(event.type); }
        };
        const source = /<script type="text\/javascript">([\s\S]*)<\/script>/.exec(script)![1];
        const context = vm.createContext({
            window: this.window,
            location: this.window.location,
            document: { readyState: 'complete' },
            navigator: {
                serviceWorker: {
                    get controller(): FakeWorker | undefined { return harness.controller; },
                    register: () => ({ then: (onRegistered: (reg: object) => void) => { onRegistered(registration); return { catch: () => undefined }; } }),
                    addEventListener: (type: string, listener: () => void) => harness.navigatorListeners.set(type, listener)
                }
            },
            MessageChannel: class {
                port1: { onmessage?: (event: { data: unknown }) => void } = {};
                port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
            },
            CustomEvent: class { constructor(readonly type: string) { } },
            setTimeout: () => undefined,
            setInterval: () => undefined,
            console
        });
        vm.runInContext(source, context);
    }

    controllerChange(next: FakeWorker): void {
        this.controller = next;
        this.navigatorListeners.get('controllerchange')!();
    }
}

describe('FrontendGenerator service worker registration', () => {

    function script(hash = ENTRY_HASH): string {
        return stampEntryBuild(createGenerator().registration(), hash);
    }

    it('does not reload or prompt a first visit when the new worker claims it', () => {
        const page = new RegistrationHarness(script(), undefined);
        page.controllerChange(new FakeWorker(OTHER_HASH));
        expect(page.reloads).to.equal(0);
        expect(page.announcements).to.deep.equal([]);
    });

    it('silently activates a waiting worker that serves the build this page already runs', () => {
        const waiting = new FakeWorker(ENTRY_HASH);
        const page = new RegistrationHarness(script(), new FakeWorker(OTHER_HASH), waiting);
        expect(waiting.messages).to.deep.include({ type: 'SKIP_WAITING' });
        page.controllerChange(waiting);
        expect(page.reloads).to.equal(0);
        expect(page.announcements).to.deep.equal([]);
    });

    it('offers a reload instead of forcing one when a newer build is waiting', () => {
        const waiting = new FakeWorker(OTHER_HASH);
        const page = new RegistrationHarness(script(), new FakeWorker(ENTRY_HASH), waiting);
        expect(waiting.messages).to.not.deep.include({ type: 'SKIP_WAITING' });
        expect(page.announcements).to.deep.equal(['qaap-service-worker-update']);

        page.window.__qaapServiceWorkerUpdate!.apply();
        expect(waiting.messages).to.deep.include({ type: 'SKIP_WAITING' });
        page.controllerChange(waiting);
        expect(page.reloads).to.equal(1);
    });

    it('offers an update found while the page is open', () => {
        const page = new RegistrationHarness(script(), new FakeWorker(ENTRY_HASH));
        const installing = new FakeWorker(OTHER_HASH);
        page.installing = installing;
        page.registrationListeners.get('updatefound')!();
        installing.state = 'installed';
        installing.listeners.get('statechange')!();
        expect(page.announcements).to.deep.equal(['qaap-service-worker-update']);
        expect(page.reloads).to.equal(0);
    });

    it('does not reload a tab when another tab activated a newer build', () => {
        const page = new RegistrationHarness(script(), new FakeWorker(ENTRY_HASH));
        page.controllerChange(new FakeWorker(OTHER_HASH));
        expect(page.reloads).to.equal(0);
        expect(page.announcements).to.deep.equal(['qaap-service-worker-update']);
        page.window.__qaapServiceWorkerUpdate!.apply();
        expect(page.reloads).to.equal(1);
    });

    it('stays quiet when another tab activated the build this page already runs', () => {
        const page = new RegistrationHarness(script(), new FakeWorker(OTHER_HASH));
        page.controllerChange(new FakeWorker(ENTRY_HASH));
        expect(page.reloads).to.equal(0);
        expect(page.announcements).to.deep.equal([]);
    });
});
