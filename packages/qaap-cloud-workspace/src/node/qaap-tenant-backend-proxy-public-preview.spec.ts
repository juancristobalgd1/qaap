// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import * as net from 'net';
import { QAAP_TENANT_BACKEND_ASSERTION_HEADER } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QAAP_AUTH_SESSION_COOKIE } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QAAP_PREVIEW_ACCESS_COOKIE_NAME } from '@theia/qaap-shared-core/lib/node/qaap-dev-preview-forward-headers';
import { QAAP_PREVIEW_ROUTE_HEADER } from '@theia/qaap-shared-core/lib/common/qaap-preview-route';
import { buildQaapPreviewId } from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import type { QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapTenantBackendProxyContribution } from './qaap-tenant-backend-proxy';
import { QaapTenantPreviewRouteTable } from './qaap-tenant-preview-route-table';

class MemoryRouteTable extends QaapTenantPreviewRouteTable {
    protected readonly persisted = new Map<string, unknown>();

    protected override getSqliteStore(): QaapSqliteStore {
        return {
            get: (key: string) => this.persisted.get(key),
            set: (key: string, value: unknown) => { this.persisted.set(key, value); },
            delete: (key: string) => this.persisted.delete(key),
        } as unknown as QaapSqliteStore;
    }
}

interface Seen { tenant: string; url?: string; headers: http.IncomingHttpHeaders }

const SHARE = 'AbCdEfGh_123-xy';
const BASE_DOMAIN = 'preview.example.test';
const ALICE_PREVIEW = buildQaapPreviewId({
    userId: 'alice', workspaceId: 'file:///w', projectId: 'file:///w', conversationId: 'c', processId: '1b2c3d4e-0000-0000-0000-000000000000',
});

describe('QaapTenantBackendProxyContribution public preview routing', () => {
    let backends: Map<string, http.Server>;
    let seen: Seen[];
    let front: http.Server;
    let frontPort: number;
    let originalHits: string[];
    let routes: MemoryRouteTable;
    let signedIn: string | undefined;
    const savedEnv: Record<string, string | undefined> = {};

    function setEnv(key: string, value: string | undefined): void {
        if (!(key in savedEnv)) {
            savedEnv[key] = process.env[key];
        }
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    async function startBackend(tenant: string, handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
        const server = http.createServer((req, res) => {
            seen.push({ tenant, url: req.url, headers: req.headers });
            if (handler) {
                handler(req, res);
                return;
            }
            res.end(`${tenant}:${req.url}`);
        });
        server.on('upgrade', (req, socket: net.Socket) => {
            seen.push({ tenant, url: req.url, headers: req.headers });
            socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
            socket.on('error', () => socket.destroy());
            socket.on('data', chunk => socket.end(`${tenant}:${chunk}`));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        backends.set(tenant, server);
    }

    beforeEach(async () => {
        backends = new Map();
        seen = [];
        originalHits = [];
        signedIn = undefined;
        routes = new MemoryRouteTable();
        setEnv('QAAP_OAUTH_PUBLIC_URL', 'https://qaap.example.test');
        setEnv('QAAP_PREVIEW_BASE_DOMAIN', BASE_DOMAIN);
        setEnv('QAAP_TENANT_PREVIEW_ROUTING', undefined);
        await startBackend('alice');
        await startBackend('mallory');
        front = http.createServer();
        front.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
            originalHits.push(req.url ?? '');
            res.end('control-plane');
        });
        front.on('upgrade', (_req, socket: net.Socket) => {
            originalHits.push('upgrade');
            socket.destroy();
        });
        const proxy = new QaapTenantBackendProxyContribution() as unknown as Record<string, unknown> & {
            installRequestRouter(server: http.Server): void;
            installUpgradeRouter(server: http.Server): void;
        };
        proxy.previewRoutes = routes;
        proxy.auth = {
            authenticate: () => signedIn
                ? { kind: 'authenticated', userLogin: signedIn, sessionId: 's', session: { accessToken: 't', user: { provider: 'github', login: signedIn, name: signedIn } } }
                : { kind: 'unauthorized' },
            userWorkspaceRoot: () => '/srv/root',
            logSecurityEvent: () => undefined,
        };
        proxy.activity = { touch: () => undefined, beginOperation: () => () => undefined };
        proxy.wsRequestValidator = { allowWsUpgrade: async () => true };
        proxy.docker = {
            isBackendPerTenantEnabled: () => true,
            tenantRootForLogin: (login: string) => `/srv/${login}`,
            ensureTenantBackend: async (login: string) => {
                const server = backends.get(login.toLowerCase());
                return { containerId: login, containerName: login, host: '127.0.0.1', port: (server!.address() as net.AddressInfo).port, tenantLogin: login };
            },
            getTenantBackendConnectionToken: () => 'tenant-token',
            getTenantBackendAssertionSecret: () => 'z'.repeat(40),
            invalidateTenantBackendTarget: () => undefined,
        };
        proxy.installRequestRouter(front);
        proxy.installUpgradeRouter(front);
        await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
        frontPort = (front.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
            delete savedEnv[key];
        }
        front.closeAllConnections();
        await new Promise<void>(resolve => front.close(() => resolve()));
        for (const server of backends.values()) {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    function request(path: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
        return new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port: frontPort, path, headers }, res => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
            });
            req.on('error', reject);
            req.end();
        });
    }

    it('learns routes only from the tenant backend answering that tenant, and strips the header', async () => {
        backends.get('alice')!.removeAllListeners('request');
        backends.get('alice')!.on('request', (_req, res: http.ServerResponse) => {
            res.setHeader(QAAP_PREVIEW_ROUTE_HEADER, `share:${SHARE}, preview:${ALICE_PREVIEW}`);
            res.end('{}');
        });
        signedIn = 'alice';
        const created = await request('/qaap/api/cloud/preview-shares');
        expect(created.headers[QAAP_PREVIEW_ROUTE_HEADER]).to.equal(undefined);
        expect(routes.resolve('share', SHARE)).to.equal('alice');
        expect(routes.resolve('preview', ALICE_PREVIEW)).to.equal('alice');
    });

    it('never lets a backend register a preview id that names another tenant', async () => {
        backends.get('mallory')!.removeAllListeners('request');
        backends.get('mallory')!.on('request', (_req, res: http.ServerResponse) => {
            res.setHeader(QAAP_PREVIEW_ROUTE_HEADER, `preview:${ALICE_PREVIEW}`);
            res.end('{}');
        });
        signedIn = 'mallory';
        await request('/qaap-dev/api/current');
        expect(routes.resolve('preview', ALICE_PREVIEW)).to.equal(undefined);
    });

    it('serves a share link from its owner backend for anonymous and other signed-in visitors, without their identity', async () => {
        routes.record({ kind: 'share', id: SHARE }, 'alice');
        const anonymous = await request(`/qaap-dev/public/${SHARE}/app.js?x=1`, {
            cookie: `${QAAP_AUTH_SESSION_COOKIE}=secret; app=1; ${QAAP_PREVIEW_ACCESS_COOKIE_NAME}=cap`,
            [QAAP_TENANT_BACKEND_ASSERTION_HEADER]: 'forged',
        });
        expect(anonymous.body).to.equal(`alice:/qaap-dev/public/${SHARE}/app.js?x=1`);
        signedIn = 'mallory';
        const otherUser = await request(`/qaap-dev/public/${SHARE}/`);
        expect(otherUser.body).to.equal(`alice:/qaap-dev/public/${SHARE}/`);
        expect(seen.map(entry => entry.tenant)).to.deep.equal(['alice', 'alice']);
        for (const entry of seen) {
            expect(entry.headers[QAAP_TENANT_BACKEND_ASSERTION_HEADER]).to.equal(undefined);
        }
        expect(seen[0].headers.cookie).to.equal('app=1');
        expect(originalHits).to.deep.equal([]);
    });

    it('leaves unknown share tokens to the control plane (legacy shares / 404)', async () => {
        const response = await request(`/qaap-dev/public/${SHARE}/`);
        expect(response.body).to.equal('control-plane');
        expect(seen).to.deep.equal([]);
    });

    it('routes an isolated preview host to its owner with the capability cookie and public host', async () => {
        routes.record({ kind: 'preview', id: ALICE_PREVIEW }, 'alice');
        backends.get('alice')!.removeAllListeners('request');
        backends.get('alice')!.on('request', (req, res: http.ServerResponse) => {
            seen.push({ tenant: 'alice', url: req.url, headers: req.headers });
            res.setHeader('Set-Cookie', [
                `${QAAP_PREVIEW_ACCESS_COOKIE_NAME}=cap; Path=/; HttpOnly`,
                `${QAAP_AUTH_SESSION_COOKIE}=evil; Path=/`,
                'theia-connection-token=t; Path=/',
                'app=2; Path=/',
            ]);
            res.end('preview');
        });
        signedIn = 'mallory';
        const host = `${ALICE_PREVIEW}.${BASE_DOMAIN}`;
        const response = await request('/index.html', {
            host,
            cookie: `${QAAP_PREVIEW_ACCESS_COOKIE_NAME}=cap; ${QAAP_AUTH_SESSION_COOKIE}=secret; app=1`,
        });
        expect(response.body).to.equal('preview');
        expect(response.headers['set-cookie']).to.deep.equal([`${QAAP_PREVIEW_ACCESS_COOKIE_NAME}=cap; Path=/; HttpOnly`, 'app=2; Path=/']);
        expect(seen[0].headers['x-forwarded-host']).to.equal(host);
        expect(seen[0].headers.cookie).to.equal(`${QAAP_PREVIEW_ACCESS_COOKIE_NAME}=cap; app=1`);
        expect(seen[0].headers[QAAP_TENANT_BACKEND_ASSERTION_HEADER]).to.equal(undefined);
    });

    it('carries preview-host WebSockets (HMR) to the owner backend', async () => {
        routes.record({ kind: 'preview', id: ALICE_PREVIEW }, 'alice');
        const reply = await new Promise<string>((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1', port: frontPort, path: '/hmr',
                headers: { host: `${ALICE_PREVIEW}.${BASE_DOMAIN}`, connection: 'Upgrade', upgrade: 'websocket' },
            });
            req.on('upgrade', (_res, socket) => {
                socket.once('data', (chunk: Buffer) => {
                    resolve(chunk.toString());
                    socket.destroy();
                });
                socket.write('ping');
            });
            req.on('error', reject);
            req.end();
        });
        expect(reply).to.equal('alice:ping');
    });

    it('is disabled by QAAP_TENANT_PREVIEW_ROUTING=0', async () => {
        routes.record({ kind: 'share', id: SHARE }, 'alice');
        setEnv('QAAP_TENANT_PREVIEW_ROUTING', '0');
        const response = await request(`/qaap-dev/public/${SHARE}/`);
        expect(response.body).to.equal('control-plane');
    });
});
