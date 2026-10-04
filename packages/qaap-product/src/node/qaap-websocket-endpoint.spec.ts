// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as WebSocket from '@theia/core/shared/ws';
import { WebsocketEndpoint } from '@theia/core/lib/node/messaging/websocket-endpoint';
import { QaapWebsocketEndpoint } from './qaap-websocket-endpoint';

interface ConnectedClient {
    readonly ws: WebSocket;
    readonly payload: string;
    readonly bytesRead: number;
}

describe('QaapWebsocketEndpoint', () => {

    const payloadSize = 256 * 1024;
    let server: http.Server;

    afterEach(done => {
        server.close(() => done());
        server.closeAllConnections();
    });

    function start(endpoint: WebsocketEndpoint, allowed: boolean): Promise<number> {
        Object.assign(endpoint, {
            wsRequestValidator: { allowWsUpgrade: async () => allowed },
            messagingListener: { onDidWebSocketUpgrade: () => undefined },
            logger: { error: () => undefined }
        });
        endpoint.registerConnectionHandler('/services', (_params, socket) => {
            socket.emit('payload', 'x'.repeat(payloadSize));
        });
        server = http.createServer();
        endpoint.onStart(server);
        return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
    }

    /** Speaks the raw Engine.IO 4 / Socket.IO 5 protocol so the test sees the negotiated frames. */
    function connect(port: number): Promise<ConnectedClient> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, { perMessageDeflate: true });
            ws.on('error', reject);
            ws.on('unexpected-response', (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
            ws.on('message', data => {
                const frame = data.toString();
                if (frame.startsWith('0')) {
                    ws.send('40/services,');
                } else if (frame.startsWith('42/services,')) {
                    const [, payload] = JSON.parse(frame.substring('42/services,'.length));
                    resolve({ ws, payload, bytesRead: (ws as unknown as { _socket: { bytesRead: number } })._socket.bytesRead });
                }
            });
        });
    }

    it('negotiates permessage-deflate and compresses large RPC frames', async () => {
        const client = await connect(await start(new QaapWebsocketEndpoint(), true));
        try {
            expect(client.ws.extensions).to.contain('permessage-deflate');
            expect(client.payload).to.have.length(payloadSize);
            expect(client.bytesRead).to.be.below(payloadSize / 10);
        } finally {
            client.ws.terminate();
        }
    });

    it('sends raw frames with the upstream endpoint (the cost being fixed)', async () => {
        const client = await connect(await start(new WebsocketEndpoint(), true));
        try {
            expect(client.ws.extensions).to.equal('');
            expect(client.bytesRead).to.be.above(payloadSize);
        } finally {
            client.ws.terminate();
        }
    });

    it('still rejects the upgrade when the request validator refuses it', async () => {
        const port = await start(new QaapWebsocketEndpoint(), false);
        let error: Error | undefined;
        try {
            const client = await connect(port);
            client.ws.terminate();
        } catch (e) {
            error = e;
        }
        // Engine.IO answers a refused handshake with 400 Forbidden.
        expect(error?.message).to.equal('HTTP 400');
    });
});
