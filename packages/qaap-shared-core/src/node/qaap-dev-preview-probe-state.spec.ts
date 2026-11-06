// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import * as net from 'net';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';
import { probeLocalDevServerStateExtracted } from './qaap-dev-preview-endpoint-timeline';

/** Only the members the readiness probe reads; the probe never touches the rest of the endpoint. */
function probeContext(): QaapDevPreviewEndpointContext {
    return {
        resolveTargetHost: async (): Promise<string> => '127.0.0.1',
        isIdeListenPort: (): boolean => false,
        upstreamAgentFor: (): undefined => undefined,
        firstHeaderValue: (): undefined => undefined,
    } as unknown as QaapDevPreviewEndpointContext;
}

function listen(server: net.Server): Promise<number> {
    return new Promise(resolve => server.listen({ port: 0, host: '127.0.0.1' }, () => {
        resolve((server.address() as net.AddressInfo).port);
    }));
}

function close(server: net.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

describe('qaap-dev-preview probe state (ready / busy / down)', () => {

    it('reports busy when the port accepts the connection but never answers', async function (): Promise<void> {
        this.timeout(15_000);
        const sockets: net.Socket[] = [];
        // Accepts TCP, reads nothing and writes nothing: the shape of a dev server still compiling.
        const silent = net.createServer(socket => { sockets.push(socket); });
        const port = await listen(silent);
        try {
            expect(await probeLocalDevServerStateExtracted(probeContext(), port)).to.equal('busy');
        } finally {
            sockets.forEach(socket => socket.destroy());
            await close(silent);
        }
    });

    it('reports down when nothing listens on the port', async function (): Promise<void> {
        this.timeout(15_000);
        const probe = net.createServer();
        const port = await listen(probe);
        await close(probe);
        expect(await probeLocalDevServerStateExtracted(probeContext(), port)).to.equal('down');
    });

    it('reports ready when the server answers with its app', async () => {
        const app = http.createServer((_req, res) => {
            res.statusCode = 200;
            res.end('ok');
        });
        const port = await listen(app as unknown as net.Server);
        try {
            expect(await probeLocalDevServerStateExtracted(probeContext(), port)).to.equal('ready');
        } finally {
            await close(app as unknown as net.Server);
        }
    });
});

describe('qaap-dev-preview probe state: silent HEAD and GET', () => {
    it('reports busy after both HEAD and GET hang on an accepted connection', async function (): Promise<void> {
        this.timeout(15_000);
        const sockets: net.Socket[] = [];
        const methods: string[] = [];
        const server = net.createServer(socket => {
            sockets.push(socket);
            socket.once('data', data => { methods.push(String(data).split(' ')[0]); });
        });
        const port = await listen(server);
        try {
            expect(await probeLocalDevServerStateExtracted(probeContext(), port)).to.equal('busy');
            expect(methods).to.deep.equal(['HEAD', 'GET']);
        } finally {
            sockets.forEach(socket => socket.destroy());
            await close(server);
        }
    });
});
