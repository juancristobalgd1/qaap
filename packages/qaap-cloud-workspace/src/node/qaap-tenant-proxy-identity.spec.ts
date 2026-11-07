// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { isQaapTenantProxyPing, requestDockerPingHeaders } from './qaap-tenant-proxy-identity';

describe('qaap-tenant-proxy-identity', () => {

    /** A fake Docker endpoint on a real unix socket; the proxy answers `/_ping` with its identity header. */
    async function serve(identity: boolean): Promise<{ socketPath: string; close: () => Promise<void> }> {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-ping-'));
        const socketPath = path.join(dir, 'd.sock');
        const server = http.createServer((_request, response) => {
            response.writeHead(200, identity ? { 'X-Qaap-Tenant-Proxy': '1' } : {});
            response.end('OK');
        });
        await new Promise<void>(resolve => server.listen(socketPath, () => resolve()));
        return {
            socketPath,
            close: () => new Promise<void>(resolve => server.close(() => {
                fs.rmSync(dir, { recursive: true, force: true });
                resolve();
            })),
        };
    }

    it('accepts an endpoint whose /_ping carries the proxy identity header', async () => {
        const endpoint = await serve(true);
        try {
            expect(isQaapTenantProxyPing(await requestDockerPingHeaders({ socketPath: endpoint.socketPath }))).to.equal(true);
        } finally {
            await endpoint.close();
        }
    });

    it('rejects a raw daemon endpoint that does not send the proxy identity header', async () => {
        const endpoint = await serve(false);
        try {
            expect(isQaapTenantProxyPing(await requestDockerPingHeaders({ socketPath: endpoint.socketPath }))).to.equal(false);
        } finally {
            await endpoint.close();
        }
    });

    it('accepts only the value 1', () => {
        expect(isQaapTenantProxyPing({ 'x-qaap-tenant-proxy': '0' })).to.equal(false);
        expect(isQaapTenantProxyPing({ 'x-qaap-tenant-proxy': '1' })).to.equal(true);
        expect(isQaapTenantProxyPing({})).to.equal(false);
    });

    it('fails the probe when the endpoint has neither a socket path nor a host', async () => {
        let thrown: unknown;
        try {
            await requestDockerPingHeaders({});
        } catch (error) {
            thrown = error;
        }
        expect((thrown as Error | undefined)?.message).to.match(/neither a socket path nor a host/);
    });

});
