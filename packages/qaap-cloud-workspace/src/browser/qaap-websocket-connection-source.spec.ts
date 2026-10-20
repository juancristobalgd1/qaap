// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapHandshakeSocket, QaapWebSocketConnectionSource } from './qaap-websocket-connection-source';

describe('QaapWebSocketConnectionSource', () => {

    class FakeSocket implements QaapHandshakeSocket {
        readonly calls: string[] = [];
        connectError?: () => void;
        readonly io = { reconnection: (enabled: boolean) => this.calls.push(`reconnection:${enabled}`) };
        on(_event: 'connect_error', listener: () => void): void {
            this.connectError = listener;
        }
        connect(): void {
            this.calls.push('connect');
        }
        disconnect(): void {
            this.calls.push('disconnect');
        }
    }

    class TestableSource extends QaapWebSocketConnectionSource {
        probes = 0;
        constructor(protected readonly answer: () => Promise<boolean>) {
            super();
        }
        protected override async isSignedOut(): Promise<boolean> {
            this.probes += 1;
            return this.answer();
        }
        refused(socket: FakeSocket, now: number): Promise<void> {
            return this.handleHandshakeError(socket, now);
        }
        resume(socket: FakeSocket): void {
            this.resumeAfterLogin(socket);
        }
    }

    it('stops reconnecting once the server says the session is gone', async () => {
        const socket = new FakeSocket();
        const source = new TestableSource(async () => true);
        await source.refused(socket, 100_000);
        expect(socket.calls).to.deep.equal(['reconnection:false', 'disconnect']);
        await source.refused(socket, 200_000);
        expect(source.probes).to.equal(1);
    });

    it('keeps reconnecting while the backend restarts or the network fails', async () => {
        const socket = new FakeSocket();
        const restarting = new TestableSource(async () => false);
        await restarting.refused(socket, 100_000);
        const unreachable = new TestableSource(async () => {
            throw new TypeError('Failed to fetch');
        });
        await unreachable.refused(socket, 100_000);
        expect(socket.calls).to.deep.equal([]);
    });

    it('asks the auth endpoint at most once per 10 seconds', async () => {
        const socket = new FakeSocket();
        const source = new TestableSource(async () => false);
        await source.refused(socket, 100_000);
        await source.refused(socket, 105_000);
        await source.refused(socket, 110_000);
        expect(source.probes).to.equal(2);
    });

    it('resumes the connection after signing in again', async () => {
        const socket = new FakeSocket();
        const source = new TestableSource(async () => true);
        source.resume(socket);
        expect(socket.calls).to.deep.equal([]);
        await source.refused(socket, 100_000);
        source.resume(socket);
        expect(socket.calls).to.deep.equal(['reconnection:false', 'disconnect', 'reconnection:true', 'connect']);
    });

    it('treats only an explicit signedIn:false from the auth endpoint as a lost session', async () => {
        const originalFetch = globalThis.fetch;
        const probe = (status: number, body: unknown): Promise<boolean> => {
            globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
            return (new QaapWebSocketConnectionSource() as unknown as { isSignedOut(): Promise<boolean> }).isSignedOut();
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
});
