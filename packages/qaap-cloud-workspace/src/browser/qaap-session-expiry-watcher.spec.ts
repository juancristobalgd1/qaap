// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Container, ContainerModule, injectable } from '@theia/core/shared/inversify';
import { WebSocketConnectionSource } from '@theia/core/lib/browser/messaging/ws-connection-source';
import { ConnectionSource } from '@theia/core/lib/browser/messaging/connection-source';
import { bindQaapSessionExpiryWatcher, QaapHandshakeSocket, QaapSessionExpiryWatcher } from './qaap-session-expiry-watcher';

describe('QaapSessionExpiryWatcher', () => {

    class FakeSocket implements QaapHandshakeSocket {
        readonly calls: string[] = [];
        connectErrorListeners: Array<() => void> = [];
        readonly io = { reconnection: (enabled: boolean) => this.calls.push(`reconnection:${enabled}`) };
        on(_event: 'connect_error', listener: () => void): void {
            this.connectErrorListeners.push(listener);
        }
        connect(): void {
            this.calls.push('connect');
        }
        disconnect(): void {
            this.calls.push('disconnect');
        }
    }

    class TestableWatcher extends QaapSessionExpiryWatcher {
        probes = 0;
        signedIn = true;
        constructor(protected readonly answer: () => Promise<boolean>) {
            super();
        }
        protected override async isSignedOut(): Promise<boolean> {
            this.probes += 1;
            return this.answer();
        }
        protected override isSignedIn(): boolean {
            return this.signedIn;
        }
        refused(socket: FakeSocket, now: number): Promise<void> {
            return this.handleHandshakeError(socket, now);
        }
        sessionChanged(): void {
            this.resumeAfterLogin();
        }
    }

    it('stops reconnecting once the server says the session is gone', async () => {
        const socket = new FakeSocket();
        const watcher = new TestableWatcher(async () => true);
        await watcher.refused(socket, 100_000);
        expect(socket.calls).to.deep.equal(['reconnection:false', 'disconnect']);
        await watcher.refused(socket, 200_000);
        expect(watcher.probes).to.equal(1);
    });

    it('keeps reconnecting while the backend restarts or the network fails', async () => {
        const socket = new FakeSocket();
        const restarting = new TestableWatcher(async () => false);
        await restarting.refused(socket, 100_000);
        const unreachable = new TestableWatcher(async () => {
            throw new TypeError('Failed to fetch');
        });
        await unreachable.refused(socket, 100_000);
        expect(socket.calls).to.deep.equal([]);
    });

    it('asks the auth endpoint at most once per 10 seconds, one probe in flight', async () => {
        const socket = new FakeSocket();
        const watcher = new TestableWatcher(async () => false);
        await watcher.refused(socket, 100_000);
        await watcher.refused(socket, 105_000);
        await watcher.refused(socket, 110_000);
        expect(watcher.probes).to.equal(2);

        let release: (value: boolean) => void = () => undefined;
        const slow = new TestableWatcher(() => new Promise<boolean>(resolve => release = resolve));
        const first = slow.refused(socket, 100_000);
        await slow.refused(socket, 200_000);
        release(false);
        await first;
        expect(slow.probes).to.equal(1);
    });

    it('resumes the connection after signing in again', async () => {
        const socket = new FakeSocket();
        const watcher = new TestableWatcher(async () => true);
        watcher.sessionChanged();
        expect(socket.calls).to.deep.equal([]);
        await watcher.refused(socket, 100_000);
        watcher.sessionChanged();
        expect(socket.calls).to.deep.equal(['reconnection:false', 'disconnect', 'reconnection:true', 'connect']);
    });

    it('does not resume when the session-changed event is a sign-out', async () => {
        const socket = new FakeSocket();
        const watcher = new TestableWatcher(async () => true);
        await watcher.refused(socket, 100_000);
        watcher.signedIn = false;
        watcher.sessionChanged();
        expect(socket.calls).to.deep.equal(['reconnection:false', 'disconnect']);
        watcher.signedIn = true;
        watcher.sessionChanged();
        expect(socket.calls).to.deep.equal(['reconnection:false', 'disconnect', 'reconnection:true', 'connect']);
    });

    it('treats only an explicit signedIn:false from the auth endpoint as a lost session', async () => {
        const originalFetch = globalThis.fetch;
        const probe = (status: number, body: unknown): Promise<boolean> => {
            globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
            return (new QaapSessionExpiryWatcher() as unknown as { isSignedOut(): Promise<boolean> }).isSignedOut();
        };
        try {
            expect(await probe(200, { signedIn: false })).to.equal(true);
            expect(await probe(200, { signedIn: true })).to.equal(false);
            expect(await probe(502, { signedIn: false })).to.equal(false);
            expect(await probe(401, {})).to.equal(false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    describe('container wiring', () => {

        let constructed = 0;

        @injectable()
        class FakeBrowserSource {
            readonly socket = new FakeSocket();
            constructor() {
                constructed += 1;
            }
        }

        @injectable()
        class FakeElectronSource extends FakeBrowserSource { }

        const qaapModule = new ContainerModule((bind, _unbind, _isBound, _rebind, _unbindAsync, onActivation) => {
            bindQaapSessionExpiryWatcher(bind, onActivation);
        });

        beforeEach(() => {
            constructed = 0;
        });

        it('decorates the browser source without creating a second instance or socket', () => {
            const container = new Container();
            container.bind(WebSocketConnectionSource).to(FakeBrowserSource as never).inSingletonScope();
            container.load(qaapModule);
            const child = container.createChild();
            child.bind(ConnectionSource).toService(WebSocketConnectionSource);

            const source = container.get<FakeBrowserSource>(WebSocketConnectionSource);
            expect(container.get(WebSocketConnectionSource)).to.equal(source);
            expect(child.get(ConnectionSource)).to.equal(source);
            expect(constructed).to.equal(1);
            expect(source.socket.connectErrorListeners).to.have.length(1);
        });

        it('decorates the Electron source bound via toService without a second instance or socket', () => {
            const container = new Container();
            // Mirrors core's electron-messaging-frontend-module bindings.
            container.bind(FakeElectronSource).toSelf().inSingletonScope();
            container.bind(WebSocketConnectionSource).toService(FakeElectronSource as never);
            container.load(qaapModule);
            const child = container.createChild();
            child.bind(ConnectionSource).toService(FakeElectronSource as never);

            const source = container.get<FakeElectronSource>(WebSocketConnectionSource);
            expect(container.get(WebSocketConnectionSource)).to.equal(source);
            expect(container.get(FakeElectronSource)).to.equal(source);
            expect(child.get(ConnectionSource)).to.equal(source);
            expect(constructed).to.equal(1);
            // toService re-runs activation on each resolution; the watcher attaches only once.
            expect(source.socket.connectErrorListeners).to.have.length(1);
        });
    });
});
