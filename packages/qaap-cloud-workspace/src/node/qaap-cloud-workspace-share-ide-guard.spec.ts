// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { QaapCloudWorkspaceEndpoint } from './qaap-cloud-workspace-endpoint';

// A public share of a Qaap/Theia preview that runs without its own login would hand anyone an IDE.
describe('QaapCloudWorkspaceEndpoint share guard for IDE previews', () => {
    const serve = async (routes: Record<string, { type: string; body: string }>): Promise<{ port: number; close: () => Promise<void> }> => {
        const server = http.createServer((req, res) => {
            const route = routes[req.url ?? '/'];
            if (!route) {
                res.statusCode = 404;
                res.end();
                return;
            }
            res.setHeader('content-type', route.type);
            res.end(route.body);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        return {
            port: (server.address() as AddressInfo).port,
            close: () => new Promise<void>(resolve => server.close(() => resolve())),
        };
    };
    const isIde = (port: number): Promise<boolean> =>
        (QaapCloudWorkspaceEndpoint.prototype as unknown as { isUnauthenticatedIdePreview(port: number): Promise<boolean> })
            .isUnauthenticatedIdePreview.call({}, port);

    it('refuses a Qaap backend that reports skipAuth', async () => {
        const app = await serve({ '/qaap/api/auth/config': { type: 'application/json', body: '{"skipAuth":true}' } });
        try {
            expect(await isIde(app.port)).to.equal(true);
        } finally {
            await app.close();
        }
    });

    it('refuses a page carrying the Theia splash shell', async () => {
        const app = await serve({ '/': { type: 'text/html', body: '<html class="theia-splash-branded"><body></body></html>' } });
        try {
            expect(await isIde(app.port)).to.equal(true);
        } finally {
            await app.close();
        }
    });

    it('allows an ordinary app and a Qaap that keeps its sign-in', async () => {
        const app = await serve({
            '/': { type: 'text/html', body: '<html><body><h1>Shop</h1></body></html>' },
            '/qaap/api/auth/config': { type: 'application/json', body: '{"skipAuth":false}' },
        });
        try {
            expect(await isIde(app.port)).to.equal(false);
        } finally {
            await app.close();
        }
    });
});
