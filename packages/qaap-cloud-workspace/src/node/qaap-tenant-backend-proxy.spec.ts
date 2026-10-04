// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import * as net from 'net';
import { PassThrough } from 'stream';
import { QaapTenantBackendProxyContribution } from './qaap-tenant-backend-proxy';
import { QaapFrontendStaticManifest } from './qaap-frontend-static-manifest';
import { QAAP_TENANT_BACKEND_ASSERTION_HEADER } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QAAP_AUTH_SESSION_COOKIE } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

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

    it('serves API-token management from the control plane and keeps the token out of tenants', () => {
        const proxy = createProxy() as unknown as {
            isControlPlanePath(url: string): boolean;
            forwardHeaders(headers: Record<string, string>, target: typeof TARGET, assertion: string): Record<string, string | string[]>;
        };
        expect(proxy.isControlPlanePath('/qaap/api/auth/api-tokens')).to.equal(true);
        const headers = proxy.forwardHeaders({ authorization: 'Bearer qaap_pat_secret' }, TARGET, 'tenant-assertion');
        expect(headers.authorization).to.equal(undefined);
        // Other Authorization schemes (a preview app's own auth) still pass through.
        expect(proxy.forwardHeaders({ authorization: 'Basic dXNlcjpwdw==' }, TARGET, 'a').authorization).to.equal('Basic dXNlcjpwdw==');
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
                    statusCode: 200,
                    once: () => undefined,
                    setHeader: () => undefined,
                    end: () => {
                        statuses.push(res.statusCode);
                        resolve();
                    },
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
                setHeader: () => undefined,
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

    describe('early request routing (before Express and Socket.IO)', () => {
        const SECRET = 'y'.repeat(40);
        const SESSION = { accessToken: 'gh-token', user: { provider: 'github' as const, login: 'alice', name: 'Alice' } };

        interface Seen { url?: string; headers: http.IncomingHttpHeaders }

        interface FrontOptions {
            authenticated: boolean;
            perTenant?: boolean;
            wsAllowed?: boolean;
            /** Files of the control plane's `lib/frontend`; enables the static split when set. */
            staticFiles?: string[];
            predictedBuild?: string;
            /** Receives the target of the test's tenant server. */
            ensureTenantBackend?: (target: typeof TARGET) => Promise<unknown>;
            warmCalls?: unknown[][];
            /** Counts TCP connections the proxy opens to the tenant backend. */
            tenantConnections?: { count: number };
            /** Replaces the Express stand-in (default: answers `control-plane`). */
            original?: (proxy: Record<string, unknown>, req: http.IncomingMessage, res: http.ServerResponse) => void;
        }

        async function withTenantAndFront(
            tenantHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
            options: FrontOptions,
            run: (front: { port: number; originalHits: string[] }) => Promise<void>,
        ): Promise<void> {
            const tenant = http.createServer(tenantHandler);
            tenant.on('connection', () => {
                if (options.tenantConnections) {
                    options.tenantConnections.count += 1;
                }
            });
            await new Promise<void>(resolve => tenant.listen(0, '127.0.0.1', resolve));
            const front = http.createServer();
            const originalHits: string[] = [];
            const proxy = createProxy() as unknown as Record<string, unknown> & { installRequestRouter(server: http.Server): void };
            // Stand-in for Express + engine.io, registered before the router like in production.
            front.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
                originalHits.push(req.url ?? '');
                if (options.original) {
                    options.original(proxy, req, res);
                    return;
                }
                res.end('control-plane');
            });
            if (options.staticFiles) {
                const manifest = new QaapFrontendStaticManifest() as unknown as { files: ReadonlySet<string> };
                manifest.files = new Set(options.staticFiles);
                proxy.staticManifest = manifest;
            }
            proxy.auth = {
                authenticate: () => options.authenticated
                    ? { kind: 'authenticated', userLogin: 'alice', sessionId: 's', session: SESSION }
                    : { kind: 'unauthorized' },
                userWorkspaceRoot: () => '/srv/qaap/users/alice',
                logSecurityEvent: () => undefined,
            };
            proxy.activity = { touch: () => undefined, beginOperation: () => () => undefined };
            proxy.wsRequestValidator = { allowWsUpgrade: async () => options.wsAllowed ?? true };
            proxy.docker = {
                isBackendPerTenantEnabled: () => options.perTenant ?? true,
                ensureTenantBackend: async () => {
                    const target = { ...TARGET, port: (tenant.address() as net.AddressInfo).port };
                    return options.ensureTenantBackend ? options.ensureTenantBackend(target) : target;
                },
                getTenantBackendConnectionToken: () => 'tenant-token',
                getTenantBackendAssertionSecret: () => SECRET,
                invalidateTenantBackendTarget: () => undefined,
                warmTenantBackend: (...args: unknown[]) => options.warmCalls?.push(args),
                predictTenantBackendBuild: async () => options.predictedBuild,
            };
            proxy.installRequestRouter(front);
            await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
            try {
                await run({ port: (front.address() as net.AddressInfo).port, originalHits });
            } finally {
                front.closeAllConnections();
                tenant.closeAllConnections();
                await new Promise<void>(resolve => front.close(() => resolve()));
                await new Promise<void>(resolve => tenant.close(() => resolve()));
            }
        }

        function request(
            port: number,
            path: string,
            headers: http.OutgoingHttpHeaders = {},
            method = 'GET',
        ): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
            return new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port, path, headers, method }, res => {
                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', chunk => { body += chunk; });
                    res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
                });
                req.on('error', reject);
                req.end();
            });
        }

        it('sends Socket.IO polling of a signed-in tenant to its backend with the tenant token and origin', async () => {
            const seen: Seen[] = [];
            await withTenantAndFront((req, res) => {
                seen.push({ url: req.url, headers: req.headers });
                res.end('tenant');
            }, { authenticated: true }, async ({ port, originalHits }) => {
                const response = await request(port, '/socket.io/?EIO=4&transport=polling', {
                    cookie: 'qaap-auth-session=control-plane-secret; theia-connection-token=browser-token',
                    origin: 'https://qaap.example.test',
                });
                expect(response.body).to.equal('tenant');
                expect(originalHits).to.deep.equal([]);
            });
            expect(seen).to.have.length(1);
            expect(seen[0].url).to.equal('/socket.io/?EIO=4&transport=polling');
            expect(seen[0].headers.cookie).to.equal('theia-connection-token=tenant-token');
            expect(seen[0].headers.origin).to.match(/^http:\/\/127\.0\.0\.1:\d+$/);
            expect(seen[0].headers[QAAP_TENANT_BACKEND_ASSERTION_HEADER]).to.be.a('string');
        });

        it('rejects a polling handshake the outer WebSocket validators refuse', async () => {
            await withTenantAndFront((_req, res) => res.end('tenant'), { authenticated: true, wsAllowed: false }, async ({ port }) => {
                const response = await request(port, '/socket.io/?EIO=4&transport=polling');
                expect(response.status).to.equal(403);
            });
        });

        it('routes IDE and preview paths that earlier contributions would have served locally', async () => {
            await withTenantAndFront((req, res) => res.end(`tenant:${req.url}`), { authenticated: true }, async ({ port, originalHits }) => {
                expect((await request(port, '/qaap-dev/5173/')).body).to.equal('tenant:/qaap-dev/5173/');
                expect((await request(port, '/qaap-dev/api/current?projectId=p')).body).to.equal('tenant:/qaap-dev/api/current?projectId=p');
                expect((await request(port, '/files/?uri=x')).body).to.equal('tenant:/files/?uri=x');
                expect(originalHits).to.deep.equal([]);
            });
        });

        it('re-ensures a stale tenant target and retries a signed-in agent approval read', async () => {
            const seen: Seen[] = [];
            let ensureCalls = 0;
            // The stale target must refuse connections immediately on every OS. 127.0.0.2 is only
            // loopback on Linux; on macOS it is unrouted and the connect hangs past the test timeout.
            // A port that was just bound and released on 127.0.0.1 refuses instantly everywhere.
            const released = net.createServer();
            await new Promise<void>(resolve => released.listen(0, '127.0.0.1', resolve));
            const stalePort = (released.address() as net.AddressInfo).port;
            await new Promise<void>(resolve => released.close(() => resolve()));
            await withTenantAndFront((req, res) => {
                seen.push({ url: req.url, headers: req.headers });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end('{"approvals":[]}');
            }, {
                authenticated: true,
                ensureTenantBackend: async target => {
                    ensureCalls++;
                    return ensureCalls === 1 ? { ...target, host: '127.0.0.1', port: stalePort } : target;
                },
            }, async ({ port, originalHits }) => {
                const response = await request(port, '/qaap/api/agent-approvals', {
                    cookie: `${QAAP_AUTH_SESSION_COOKIE}=valid-session`,
                });
                expect(response.status).to.equal(200);
                expect(response.body).to.equal('{"approvals":[]}');
                expect(originalHits).to.deep.equal([]);
            });

            expect(ensureCalls).to.equal(2);
            expect(seen).to.have.length(1);
            expect(seen[0].url).to.equal('/qaap/api/agent-approvals');
            expect(seen[0].headers.cookie).to.equal(undefined);
            expect(seen[0].headers[QAAP_TENANT_BACKEND_ASSERTION_HEADER]).to.be.a('string');
        });

        it('keeps control-plane paths, anonymous requests and the non-tenant mode on the original listeners', async () => {
            await withTenantAndFront((_req, res) => res.end('tenant'), { authenticated: true }, async ({ port, originalHits }) => {
                expect((await request(port, '/qaap/api/health')).body).to.equal('control-plane');
                expect(originalHits).to.deep.equal(['/qaap/api/health']);
            });
            await withTenantAndFront((_req, res) => res.end('tenant'), { authenticated: false }, async ({ port }) => {
                expect((await request(port, '/socket.io/?EIO=4&transport=polling')).body).to.equal('control-plane');
            });
            await withTenantAndFront((_req, res) => res.end('tenant'), { authenticated: true, perTenant: false }, async ({ port }) => {
                expect((await request(port, '/')).body).to.equal('control-plane');
            });
        });

        it('lets previewed apps keep their own cookies while Qaap cookies never cross', async () => {
            const seen: Seen[] = [];
            await withTenantAndFront((req, res) => {
                seen.push({ url: req.url, headers: req.headers });
                res.setHeader('Set-Cookie', ['app_session=1; Path=/', `${QAAP_AUTH_SESSION_COOKIE}=evil; Path=/`]);
                res.end('ok');
            }, { authenticated: true }, async ({ port }) => {
                const cookie = `${QAAP_AUTH_SESSION_COOKIE}=secret; app_session=abc; theia-connection-token=t`;
                const preview = await request(port, '/qaap-preview/u-alice-x/', { cookie });
                expect(preview.headers['set-cookie']).to.deep.equal(['app_session=1; Path=/']);
                const ide = await request(port, '/services/x', { cookie });
                expect(ide.headers['set-cookie']).to.equal(undefined);
            });
            expect(seen[0].headers.cookie).to.equal('app_session=abc');
            expect(seen[1].headers.cookie).to.equal(undefined);
        });

        describe('static frontend from the control plane while the tenant backend warms', () => {
            const STATIC_ENV_KEYS = ['QAAP_BUILD_SHA', 'QAAP_BACKEND_PER_TENANT', 'QAAP_TENANT_STATIC_FROM_CONTROL_PLANE'] as const;
            let envSnapshot: Record<string, string | undefined>;
            const STATIC_FILES = [
                '/index.html', '/bundle.js', '/chunk-ABC.js', '/legal/terms.html', '/secondary-window.html',
                // Same-named files under tenant-owned prefixes must never be served by the control plane.
                '/hostedPlugin/p/x.js', '/webview/index.html', '/file/a.png', '/qaap-dev/3000/main.js', '/qaap-preview/id/app.js',
                '/services', '/qaap/api/x', '/x', '/a/b.js',
            ];
            const neverEnsured = (): Promise<unknown> => new Promise(() => undefined);

            beforeEach(() => {
                envSnapshot = {};
                for (const key of STATIC_ENV_KEYS) {
                    envSnapshot[key] = process.env[key];
                }
                process.env.QAAP_BUILD_SHA = 'abc1234';
                process.env.QAAP_BACKEND_PER_TENANT = '1';
                delete process.env.QAAP_TENANT_STATIC_FROM_CONTROL_PLANE;
            });

            afterEach(() => {
                for (const key of STATIC_ENV_KEYS) {
                    if (envSnapshot[key] === undefined) {
                        delete process.env[key];
                    } else {
                        process.env[key] = envSnapshot[key];
                    }
                }
            });

            it('serves the static frontend from the control plane even when the tenant backend never becomes ready', async () => {
                const warmCalls: unknown[][] = [];
                await withTenantAndFront((_req, res) => res.end('tenant'), {
                    authenticated: true, staticFiles: STATIC_FILES, predictedBuild: 'abc1234', ensureTenantBackend: neverEnsured, warmCalls,
                }, async ({ port, originalHits }) => {
                    for (const path of ['/', '/index.html', '/bundle.js?qaap-build=x', '/chunk-ABC.js', '/legal/terms.html']) {
                        const response = await request(port, path);
                        expect(response.body, path).to.equal('control-plane');
                        expect(response.headers['x-qaap-static-origin'], path).to.equal('control-plane');
                    }
                    expect(originalHits).to.deep.equal(['/', '/index.html', '/bundle.js?qaap-build=x', '/chunk-ABC.js', '/legal/terms.html']);
                });
                expect(warmCalls).to.have.length(5);
                expect(warmCalls[0]).to.deep.equal(['alice', '/srv/qaap/users/alice']);
            });

            for (const [label, setup] of [
                ['the tenant runs another build', { predictedBuild: 'old5678' }],
                ['the tenant build is unknown (e.g. deferred recreation)', { predictedBuild: undefined }],
                ['both run an unversioned dev build', { predictedBuild: 'dev', ownBuild: 'dev' }],
                ['the kill switch is off', { predictedBuild: 'abc1234', killSwitch: true }],
            ] as const) {
                it(`proxies the static frontend to the tenant when ${label}`, async () => {
                    const options = setup as { predictedBuild?: string; ownBuild?: string; killSwitch?: boolean };
                    if (options.ownBuild) {
                        process.env.QAAP_BUILD_SHA = options.ownBuild;
                    }
                    if (options.killSwitch) {
                        process.env.QAAP_TENANT_STATIC_FROM_CONTROL_PLANE = '0';
                    }
                    const warmCalls: unknown[][] = [];
                    await withTenantAndFront((req, res) => res.end(`tenant:${req.url}`), {
                        authenticated: true, staticFiles: STATIC_FILES, predictedBuild: options.predictedBuild, warmCalls,
                    }, async ({ port, originalHits }) => {
                        const response = await request(port, '/index.html');
                        expect(response.body).to.equal('tenant:/index.html');
                        expect(response.headers['x-qaap-static-origin']).to.equal(options.killSwitch ? undefined : 'tenant');
                        expect((await request(port, '/chunk-ABC.js')).body).to.equal('tenant:/chunk-ABC.js');
                        expect(originalHits).to.deep.equal([]);
                    });
                    expect(warmCalls).to.have.length(options.killSwitch ? 0 : 2);
                });
            }

            it('always proxies tenant-owned, unsafe and non-GET requests', async () => {
                await withTenantAndFront((req, res) => res.end(`tenant:${req.method}:${req.url}`), {
                    authenticated: true, staticFiles: STATIC_FILES, predictedBuild: 'abc1234',
                }, async ({ port, originalHits }) => {
                    for (const path of [
                        '/hostedPlugin/p/x.js', '/webview/index.html', '/file/a.png', '/qaap-dev/3000/main.js', '/qaap-preview/id/app.js',
                        '/socket.io/?EIO=4', '/services', '/qaap/api/x', '/%2e%2e/x', '/a%2Fb.js', '/not-a-frontend-file.js',
                    ]) {
                        expect((await request(port, path)).body, path).to.equal(`tenant:GET:${path}`);
                    }
                    expect((await request(port, '/index.html', {}, 'POST')).body).to.equal('tenant:POST:/index.html');
                    expect(originalHits).to.deep.equal([]);
                });
            });

            it('lets a request handed back to the control plane through the Express middleware, also after the .gz rewrite', async () => {
                await withTenantAndFront((_req, res) => res.end('tenant'), {
                    authenticated: true, staticFiles: STATIC_FILES, predictedBuild: 'abc1234', ensureTenantBackend: neverEnsured,
                    original: (proxy, req, res) => {
                        let middleware: ((req: unknown, res: unknown, next: () => void) => void) | undefined;
                        (proxy as unknown as { configure(app: unknown): void }).configure({ use: (handler: typeof middleware) => { middleware = handler; } });
                        // What `serveGzipped` does before contribution middleware runs. `/bundle.js.gz` is not in the
                        // manifest above, so only the request mark (not a re-classification) lets it through.
                        req.url = `${(req.url ?? '/').split('?', 1)[0]}.gz`;
                        middleware!(req, res, () => res.end(`served:${req.url}`));
                    },
                }, async ({ port }) => {
                    expect((await request(port, '/bundle.js?v=1')).body).to.equal('served:/bundle.js.gz');
                });
            });

            it('applies the same split in the middleware-only fallback, classifying the original URL', async () => {
                const proxy = createProxy() as unknown as Record<string, unknown> & {
                    proxyAuthenticatedRequest(req: unknown, res: unknown, next: () => void): Promise<void>;
                };
                const warmCalls: unknown[][] = [];
                const manifest = new QaapFrontendStaticManifest() as unknown as { files: ReadonlySet<string> };
                manifest.files = new Set(STATIC_FILES);
                proxy.staticManifest = manifest;
                proxy.auth = {
                    authenticate: () => ({ kind: 'authenticated', userLogin: 'alice', sessionId: 's', session: SESSION }),
                    userWorkspaceRoot: () => '/srv/qaap/users/alice',
                };
                proxy.activity = { touch: () => undefined };
                proxy.docker = {
                    warmTenantBackend: (...args: unknown[]) => warmCalls.push(args),
                    predictTenantBackendBuild: async () => 'abc1234',
                    ensureTenantBackend: neverEnsured,
                };
                const headers: Record<string, unknown> = {};
                const res = { headersSent: false, setHeader: (key: string, value: unknown) => { headers[key] = value; } };
                let nextCalled = false;
                await proxy.proxyAuthenticatedRequest(
                    { method: 'GET', url: '/bundle.js.gz', originalUrl: '/bundle.js', headers: {} }, res, () => { nextCalled = true; });
                expect(nextCalled).to.equal(true);
                expect(headers['X-Qaap-Static-Origin']).to.equal('control-plane');
                expect(warmCalls).to.have.length(1);
            });

            it('opens no upstream request for a polling request abandoned during the cold start', async () => {
                const tenantHits: string[] = [];
                const tenantConnections = { count: 0 };
                let finishEnsure!: () => void;
                let ensureStarted!: () => void;
                const started = new Promise<void>(resolve => { ensureStarted = resolve; });
                await withTenantAndFront((req, res) => {
                    tenantHits.push(req.url ?? '');
                    res.end('tenant');
                }, {
                    authenticated: true,
                    staticFiles: STATIC_FILES,
                    predictedBuild: 'abc1234',
                    tenantConnections,
                    ensureTenantBackend: target => {
                        ensureStarted();
                        return new Promise(resolve => { finishEnsure = () => resolve(target); });
                    },
                }, async ({ port }) => {
                    const browser = http.request({ host: '127.0.0.1', port, path: '/socket.io/?EIO=4&transport=polling' });
                    browser.on('error', () => undefined);
                    browser.end();
                    await started;
                    browser.destroy();
                    await new Promise(resolve => setTimeout(resolve, 50));
                    finishEnsure();
                    await new Promise(resolve => setTimeout(resolve, 50));
                });
                expect(tenantHits).to.deep.equal([]);
                expect(tenantConnections.count).to.equal(0);
            });
        });

        it('can be switched off for middleware-only routing', () => {
            const previous = process.env.QAAP_TENANT_PROXY_EARLY_ROUTING;
            try {
                process.env.QAAP_TENANT_PROXY_EARLY_ROUTING = '0';
                const proxy = createProxy() as unknown as { installRequestRouter(server: http.Server): void };
                const server = http.createServer();
                const listener = (): void => undefined;
                server.on('request', listener);
                proxy.installRequestRouter(server);
                expect(server.listeners('request')).to.deep.equal([listener]);
            } finally {
                if (previous === undefined) {
                    delete process.env.QAAP_TENANT_PROXY_EARLY_ROUTING;
                } else {
                    process.env.QAAP_TENANT_PROXY_EARLY_ROUTING = previous;
                }
            }
        });
    });
});
