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

        it('bounds a handshake a live tenant backend never answers without evicting the target', async () => {
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
                // TCP connected, so the backend is alive (just slow): keep the cached target.
                expect(invalidations).to.deep.equal([]);
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

    it('evicts only for unreachable backends, not for a slow live one', () => {
        const proxy = createProxy() as unknown as {
            shouldEvictTenantBackendTarget(error: unknown, timedOut: boolean, connected: boolean): boolean;
        };
        const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        const timedOut = new Error('Tenant backend did not respond in time.');
        expect(proxy.shouldEvictTenantBackendTarget(refused, false, false)).to.equal(true);
        expect(proxy.shouldEvictTenantBackendTarget(timedOut, true, false)).to.equal(true);
        expect(proxy.shouldEvictTenantBackendTarget(timedOut, true, true)).to.equal(false);
        expect(proxy.shouldEvictTenantBackendTarget(new Error('socket hang up'), false, true)).to.equal(false);
    });

    it('does not evict a live tenant backend when the HTTP response wait times out, and closes the upstream request', async () => {
        let tenantSawClose!: () => void;
        const tenantClosed = new Promise<void>(resolve => { tenantSawClose = resolve; });
        // Never answers; records when the proxy gives up so the tenant can cancel its work.
        const server = http.createServer((_req, tenantRes) => tenantRes.once('close', () => tenantSawClose()));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const invalidations: unknown[] = [];
            const proxy = createProxy() as unknown as Record<string, unknown> & {
                forwardHttp(req: unknown, res: unknown, target: unknown, assertion: string, tenantLogin: string, timeoutMs: number): void;
            };
            proxy.docker = { invalidateTenantBackendTarget: (...args: unknown[]) => invalidations.push(args) };
            const statuses: number[] = [];
            const done = new Promise<void>(resolve => {
                const res = {
                    headersSent: false,
                    writableFinished: false,
                    once: () => undefined,
                    status: (code: number) => {
                        statuses.push(code);
                        return { json: () => resolve() };
                    },
                    end: () => resolve(),
                };
                const req = new PassThrough() as unknown as Record<string, unknown>;
                Object.assign(req, { method: 'GET', url: '/slow', headers: {} });
                proxy.forwardHttp(req, res, { ...TARGET, port: (server.address() as net.AddressInfo).port }, 'assertion', 'alice', 100);
                (req as unknown as PassThrough).end();
            });
            await done;
            await tenantClosed;
            expect(statuses).to.deep.equal([504]);
            expect(invalidations).to.deep.equal([]);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it('closes the upstream request when the browser goes away before the response', async () => {
        let tenantSawClose!: () => void;
        const tenantClosed = new Promise<void>(resolve => { tenantSawClose = resolve; });
        let tenantGotRequest!: () => void;
        const tenantReceived = new Promise<void>(resolve => { tenantGotRequest = resolve; });
        const server = http.createServer((_req, tenantRes) => {
            tenantRes.once('close', () => tenantSawClose());
            tenantGotRequest();
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const proxy = createProxy() as unknown as Record<string, unknown> & {
                forwardHttp(req: unknown, res: unknown, target: unknown, assertion: string, tenantLogin: string, timeoutMs: number): void;
            };
            const invalidations: unknown[] = [];
            proxy.docker = { invalidateTenantBackendTarget: (...args: unknown[]) => invalidations.push(args) };
            let browserClose: (() => void) | undefined;
            const res = {
                headersSent: false,
                writableFinished: false,
                once: (event: string, listener: () => void) => {
                    if (event === 'close') {
                        browserClose = listener;
                    }
                },
                status: () => ({ json: () => undefined }),
                end: () => undefined,
            };
            const req = new PassThrough() as unknown as Record<string, unknown>;
            Object.assign(req, { method: 'GET', url: '/slow', headers: {} });
            proxy.forwardHttp(req, res, { ...TARGET, port: (server.address() as net.AddressInfo).port }, 'assertion', 'alice', 60_000);
            (req as unknown as PassThrough).end();
            await tenantReceived;
            browserClose?.();
            await tenantClosed;
            expect(invalidations).to.deep.equal([]);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
