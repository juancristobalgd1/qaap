// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as express from '@theia/core/shared/express';
import { qaapServeBrotli } from './qaap-brotli-static-contribution';

describe('qaapServeBrotli', () => {

    let frontendDir: string;

    before(() => {
        frontendDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-brotli-'));
        fs.writeFileSync(path.join(frontendDir, 'chunk-ABC123.js.br'), 'br');
        fs.writeFileSync(path.join(frontendDir, 'bundle.css.br'), 'br');
    });

    after(() => {
        fs.rmSync(frontendDir, { recursive: true, force: true });
    });

    function request(url: string, acceptsBrotli = true, method = 'GET', reqHeaders: Record<string, string> = {}):
        { req: express.Request; res: express.Response; headers: Record<string, string> } {
        const headers: Record<string, string> = {};
        const req = { url, method, headers: reqHeaders, acceptsEncodings: (encoding: string) => acceptsBrotli ? encoding : false } as unknown as express.Request;
        const res = {
            set: (name: string, value: string) => { headers[name] = value; },
            append: (name: string, value: string) => { headers[name] = headers[name] ? `${headers[name]}, ${value}` : value; },
        } as unknown as express.Response;
        return { req, res, headers };
    }

    it('rewrites a JS chunk with a .br companion and keeps the query', async () => {
        const { req, res, headers } = request('/chunk-ABC123.js?v=1');
        await qaapServeBrotli(req, res, frontendDir);
        expect(req.url).to.equal('/chunk-ABC123.js.br?v=1');
        expect(headers).to.deep.equal({ 'Content-Encoding': 'br', 'Content-Type': 'text/javascript', 'Vary': 'Accept-Encoding' });
    });

    it('serves CSS with its content type', async () => {
        const { req, res, headers } = request('/bundle.css?qaap-build=x');
        await qaapServeBrotli(req, res, frontendDir);
        expect(req.url).to.equal('/bundle.css.br?qaap-build=x');
        expect(headers['Content-Type']).to.equal('text/css');
    });

    it('leaves the request alone without a companion, without br support, or outside the frontend directory', async () => {
        for (const [url, accepts, method, vary] of [
            ['/chunk-NOPE.js', true, 'GET', true],
            ['/chunk-ABC123.js', false, 'GET', true],
            ['/chunk-ABC123.js', true, 'POST', false],
            ['/index.html', true, 'GET', false],
            ['/..%2F..%2Fetc%2Fpasswd.js', true, 'GET', true],
        ] as const) {
            const { req, res, headers } = request(url, accepts, method);
            await qaapServeBrotli(req, res, frontendDir);
            expect(req.url, url).to.equal(url);
            expect(headers, url).to.deep.equal(vary ? { Vary: 'Accept-Encoding' } : {});
        }
    });

    it('appends to an existing Vary header instead of clobbering it', async () => {
        const { req, res, headers } = request('/chunk-ABC123.js', false);
        headers['Vary'] = 'Origin';
        await qaapServeBrotli(req, res, frontendDir);
        expect(headers['Vary']).to.equal('Origin, Accept-Encoding');
    });

    it('does not touch requests addressed to an isolated preview host', async () => {
        const label = 'a'.repeat(32);
        const { req, res, headers } = request('/chunk-ABC123.js', true, 'GET', { host: `${label}.preview.example.com` });
        await qaapServeBrotli(req, res, frontendDir, 'preview.example.com');
        expect(req.url).to.equal('/chunk-ABC123.js');
        expect(headers).to.deep.equal({});
        // The same file on the main origin is still served compressed.
        const main = request('/chunk-ABC123.js', true, 'GET', { host: 'app.example.com' });
        await qaapServeBrotli(main.req, main.res, frontendDir, 'preview.example.com');
        expect(main.req.url).to.equal('/chunk-ABC123.js.br');
    });
});
