// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as express from '@theia/core/shared/express';
import { QaapAsyncRoute } from './qaap-async-route';

describe('QaapAsyncRoute', () => {
    let server: http.Server;
    let port: number;
    const originalConsoleError = console.error;

    before(async () => {
        console.error = () => undefined;
        const app = express();
        app.get('/storage-down', QaapAsyncRoute.wrap('spec', async () => {
            throw new Error('SQLITE_IOERR');
        }));
        app.get('/fails-mid-stream', QaapAsyncRoute.wrap('spec', async (_req, res) => {
            res.status(200).write('partial');
            throw new Error('EIO');
        }));
        app.get('/ok', QaapAsyncRoute.wrap('spec', async (_req, res) => {
            res.json({ ok: true });
        }));
        server = http.createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
    });

    after(async () => {
        console.error = originalConsoleError;
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    function get(path: string): Promise<{ status?: number; body: string }> {
        return new Promise((resolve, reject) => {
            const req = http.get({ host: '127.0.0.1', port, path, timeout: 1_000 }, res => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body }));
            });
            req.on('timeout', () => req.destroy(new Error('request hung')));
            req.on('error', reject);
        });
    }

    it('answers 500 instead of hanging when the handler rejects', async () => {
        expect(await get('/storage-down')).to.deep.equal({ status: 500, body: '{"error":"internal_error"}' });
    });

    it('ends a response that already started', async () => {
        expect(await get('/fails-mid-stream')).to.deep.equal({ status: 200, body: 'partial' });
    });

    it('leaves successful handlers untouched', async () => {
        expect(await get('/ok')).to.deep.equal({ status: 200, body: '{"ok":true}' });
    });
});
