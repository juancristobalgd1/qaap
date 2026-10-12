// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as net from 'net';
import { isQaapDevPreviewPortBindable } from './qaap-dev-preview-port-bind-probe';

describe('isQaapDevPreviewPortBindable', () => {

    async function listen(host: string): Promise<net.Server> {
        const server = net.createServer();
        await new Promise<void>(resolve => server.listen({ port: 0, host }, resolve));
        return server;
    }

    function close(server: net.Server): Promise<void> {
        return new Promise(resolve => server.close(() => resolve()));
    }

    it('reports a loopback listener as taken even though it never answers HTTP', async () => {
        const server = await listen('127.0.0.1');
        try {
            expect(await isQaapDevPreviewPortBindable((server.address() as net.AddressInfo).port)).to.equal(false);
        } finally {
            await close(server);
        }
    });

    it('reports a wildcard listener as taken', async () => {
        const server = await listen('0.0.0.0');
        try {
            expect(await isQaapDevPreviewPortBindable((server.address() as net.AddressInfo).port)).to.equal(false);
        } finally {
            await close(server);
        }
    });

    it('reports a released port as free', async () => {
        const server = await listen('127.0.0.1');
        const port = (server.address() as net.AddressInfo).port;
        await close(server);
        expect(await isQaapDevPreviewPortBindable(port)).to.equal(true);
    });
});
