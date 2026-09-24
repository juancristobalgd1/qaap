// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { fetchGithubRepositoryRequest } from './qaap-github-api';

describe('fetchGithubRepositoryRequest', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeEach(async () => {
        server = http.createServer((req, res) => {
            if (req.url === '/stall-body') {
                // Headers arrive promptly, then the body never finishes.
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.write('[{"id":');
                return;
            }
            if (req.url === '/no-content') {
                res.writeHead(204).end();
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Not Found' }));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    it('bounds the body read, not only the wait for headers', async () => {
        let error: unknown;
        try {
            await fetchGithubRepositoryRequest(`${baseUrl}/stall-body`, {}, 150);
        } catch (err) {
            error = err;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.contain('timed out');
    });

    it('returns a readable response with the upstream status', async () => {
        const response = await fetchGithubRepositoryRequest(`${baseUrl}/missing`, {}, 2_000);
        expect(response.ok).to.equal(false);
        expect(response.status).to.equal(404);
        expect(await response.json()).to.deep.equal({ message: 'Not Found' });
    });

    it('handles bodiless statuses', async () => {
        const response = await fetchGithubRepositoryRequest(`${baseUrl}/no-content`, {}, 2_000);
        expect(response.status).to.equal(204);
    });
});
