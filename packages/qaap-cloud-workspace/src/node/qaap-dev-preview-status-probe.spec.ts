// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import { probeReservedDevPreviewStatus } from './qaap-dev-preview-status-probe';

describe('probeReservedDevPreviewStatus', () => {
    let server: http.Server | undefined;

    afterEach(async () => {
        if (server) {
            await new Promise<void>(resolve => server!.close(() => resolve()));
            server = undefined;
        }
    });

    async function listen(handler: http.RequestListener): Promise<number> {
        server = http.createServer(handler);
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
        return (server.address() as AddressInfo).port;
    }

    it('reports answering with the status of any HTTP response', async () => {
        const port = await listen((_req, res) => {
            res.statusCode = 200;
            res.end();
        });
        const status = await probeReservedDevPreviewStatus(port);
        expect(status).to.deep.equal({ answering: true, httpStatus: 200 });
    });

    it('counts a 404 as answering, with its status', async () => {
        const port = await listen((_req, res) => {
            res.statusCode = 404;
            res.end();
        });
        const status = await probeReservedDevPreviewStatus(port);
        expect(status).to.deep.equal({ answering: true, httpStatus: 404 });
    });

    it('reports not answering when the port is closed', async () => {
        const port = await listen((_req, res) => res.end());
        await new Promise<void>(resolve => server!.close(() => resolve()));
        server = undefined;
        const status = await probeReservedDevPreviewStatus(port);
        expect(status).to.deep.equal({ answering: false });
    });

    it('does not wait past the timeout for a server that accepts but never answers', async () => {
        const port = await listen(() => { /* never respond */ });
        const started = Date.now();
        const status = await probeReservedDevPreviewStatus(port, 200);
        const elapsed = Date.now() - started;
        expect(status).to.deep.equal({ answering: false });
        expect(elapsed).to.be.lessThan(1000);
    });
});
