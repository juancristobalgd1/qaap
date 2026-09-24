// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import * as net from 'net';
import { PassThrough } from 'stream';
import { QaapTenantBackendProxyContribution } from './qaap-tenant-backend-proxy';

const TARGET = {
    containerId: 'container-id',
    containerName: 'qaap-backend-alice',
    host: '127.0.0.1',
    port: 4873,
    tenantLogin: 'alice',
};

describe('QaapTenantBackendProxyContribution', () => {
    function createProxy(): QaapTenantBackendProxyContribution {
        return new QaapTenantBackendProxyContribution();
    }

    it('keeps OAuth, health and auth-session paths on the control-plane', () => {
        const proxy = createProxy() as unknown as { isControlPlanePath(url: string): boolean };
        expect(proxy.isControlPlanePath('/qaap/api/health')).to.equal(true);
        expect(proxy.isControlPlanePath('/qaap/api/auth/session')).to.equal(true);
        expect(proxy.isControlPlanePath('/qaap/api/auth/github/start?next=/')).to.equal(true);
        expect(proxy.isControlPlanePath('/qaap/api/cloud/runtime/status')).to.equal(true);
        expect(proxy.isControlPlanePath('/qaap/api/cloud/runtime/wake')).to.equal(true);
        expect(proxy.isControlPlanePath('/services')).to.equal(false);
    });

    it('does not forward the control-plane cookie to a tenant backend', () => {
        const proxy = createProxy() as unknown as {
            forwardHeaders(headers: Record<string, string>, target: typeof TARGET, assertion: string): Record<string, string | string[]>;
        };
        const headers = proxy.forwardHeaders({
            host: 'qaap.example.test',
            cookie: 'qaap-auth-session=control-plane-secret',
            connection: 'keep-alive',
            'x-request-id': 'request-1',
        }, TARGET, 'tenant-assertion');
        expect(headers.cookie).to.equal(undefined);
        expect(headers.connection).to.equal(undefined);
        expect(headers.host).to.equal('127.0.0.1:4873');
        expect(headers['x-request-id']).to.equal('request-1');
    });

    it('restores the required upgrade headers only for the tenant WebSocket hop', () => {
        const proxy = createProxy() as unknown as {
            forwardWebSocketHeaders(headers: Record<string, string>, target: typeof TARGET, assertion: string, tenantConnectionToken: string): Record<string, string | string[]>;
        };
        const headers = proxy.forwardWebSocketHeaders({
            host: 'qaap.example.test',
            connection: 'keep-alive, Upgrade',
            upgrade: 'websocket',
            cookie: 'qaap-auth-session=control-plane-secret',
            'sec-websocket-key': 'key',
        }, TARGET, 'tenant-assertion', 'tenant-private-token');
        expect(headers.connection).to.equal('Upgrade');
        expect(headers.upgrade).to.equal('websocket');
        expect(headers.cookie).to.equal('theia-connection-token=tenant-private-token');
        expect(headers.origin).to.equal('http://127.0.0.1:4873');
        expect(headers['sec-websocket-key']).to.equal('key');
    });

    describe('WebSocket upgrade to the tenant backend', () => {
        const SECRET = 'x'.repeat(40);
        const SESSION = { accessToken: 'gh-token', user: { provider: 'github' as const, login: 'alice', name: 'Alice' } };

        function createWebSocketProxy(port: number, invalidations: unknown[]): QaapTenantBackendProxyContribution & {
            proxyWebSocket(...args: unknown[]): Promise<void>;
            getTenantWebSocketConnectTimeoutMs(): number;
        } {
            const target = { ...TARGET, port };
            const proxy = createProxy() as unknown as Record<string, unknown>;
            proxy.auth = { userWorkspaceRoot: () => '/srv/qaap/users/alice' };
            proxy.activity = { beginOperation: () => () => undefined };
            proxy.docker = {
                ensureTenantBackend: async () => target,
                getTenantBackendConnectionToken: () => 'tenant-token',
                getTenantBackendAssertionSecret: () => SECRET,
                invalidateTenantBackendTarget: (login: string, cached: unknown) => invalidations.push([login, cached === target]),
            };
            proxy.getTenantWebSocketConnectTimeoutMs = () => 100;
            return proxy as unknown as QaapTenantBackendProxyContribution & {
                proxyWebSocket(...args: unknown[]): Promise<void>;
                getTenantWebSocketConnectTimeoutMs(): number;
            };
        }

        function upgradeRequest(): http.IncomingMessage {
            return { url: '/services', headers: { host: 'qaap.example.test', upgrade: 'websocket' } } as unknown as http.IncomingMessage;
        }

        function waitForClose(socket: PassThrough): Promise<void> {
            return new Promise(resolve => socket.once('close', () => resolve()));
        }

        it('evicts the cached target when the tenant backend refuses the connection', async () => {
            const probe = net.createServer();
            await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
            const port = (probe.address() as net.AddressInfo).port;
            await new Promise<void>(resolve => probe.close(() => resolve()));
            const invalidations: unknown[] = [];
            const proxy = createWebSocketProxy(port, invalidations);
            const socket = new PassThrough();
            const closed = waitForClose(socket);
            await proxy.proxyWebSocket(upgradeRequest(), socket, Buffer.alloc(0), 'alice', SESSION, [], {});
            await closed;
            expect(invalidations).to.deep.equal([['alice', true]]);
        });

        it('bounds a handshake the tenant backend never answers and evicts the target', async () => {
            const sockets: net.Socket[] = [];
            const silent = net.createServer(connection => { sockets.push(connection); });
            await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve));
            try {
                const invalidations: unknown[] = [];
                const proxy = createWebSocketProxy((silent.address() as net.AddressInfo).port, invalidations);
                const socket = new PassThrough();
                const closed = waitForClose(socket);
                await proxy.proxyWebSocket(upgradeRequest(), socket, Buffer.alloc(0), 'alice', SESSION, [], {});
                await closed;
                expect(invalidations).to.deep.equal([['alice', true]]);
            } finally {
                sockets.forEach(connection => connection.destroy());
                await new Promise<void>(resolve => silent.close(() => resolve()));
            }
        });

        it('does not evict the target when the backend answers the upgrade with an HTTP response', async () => {
            const server = http.createServer((_req, res) => res.writeHead(403).end());
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            try {
                const invalidations: unknown[] = [];
                const proxy = createWebSocketProxy((server.address() as net.AddressInfo).port, invalidations);
                const socket = new PassThrough();
                const closed = waitForClose(socket);
                await proxy.proxyWebSocket(upgradeRequest(), socket, Buffer.alloc(0), 'alice', SESSION, [], {});
                await closed;
                expect(invalidations).to.deep.equal([]);
            } finally {
                server.closeAllConnections();
                await new Promise<void>(resolve => server.close(() => resolve()));
            }
        });
    });

    it('never shrinks the response wait below the floor once ensure used the budget', () => {
        const proxy = createProxy() as unknown as { remainingTenantProxyBudgetMs(deadline: number): number };
        expect(proxy.remainingTenantProxyBudgetMs(Date.now() - 1_000)).to.equal(5_000);
        expect(proxy.remainingTenantProxyBudgetMs(Date.now() + 60_000)).to.be.within(59_000, 60_000);
    });
});
