// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { Server as SocketIoServer } from 'socket.io';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { WebsocketEndpoint } from '@theia/core/lib/node/messaging/websocket-endpoint';
import { WsRequestValidator, WsRequestValidatorContribution } from '@theia/core/lib/node/ws-request-validators';
import { BROWSER_TOKEN_COOKIE_NAME, BrowserConnectionTokenBackendContribution } from '@theia/core/lib/node/hosting/browser-connection-token';
import { QAAP_AUTH_SESSION_COOKIE } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAuthenticatedWsRequestValidator } from './qaap-authenticated-ws-request-validator';
import { QaapControlPlaneRpcGuard } from './qaap-control-plane-rpc-guard';
import { QaapTenantBackendProxyContribution } from './qaap-tenant-backend-proxy';

/**
 * Integration: a real `socket.io-client` against a control plane made of Theia's real Socket.IO
 * endpoint and validator chain plus the real tenant proxy routers, with a stand-in tenant backend
 * (plain Socket.IO server) on its own ephemeral port. Answers say which side served the namespace.
 */
describe('Hosted control plane never serves Theia RPC itself', function (): void {
    this.timeout(15_000);

    const CONNECTION_TOKEN = 'control-plane-connection-token';
    const SESSION_ID = 'alice-session';
    const ENV_KEYS = [
        'NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_SKIP_AUTH', 'QAAP_TENANT_BACKEND_MODE', 'QAAP_BACKEND_PER_TENANT', 'QAAP_TENANT_PROXY_EARLY_ROUTING',
    ] as const;
    const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map(key => [key, process.env[key]]));
    const servers: http.Server[] = [];
    const clients: ClientSocket[] = [];
    let tenantPort: number;
    let withProxyPort: number;
    let withoutProxyPort: number;

    function createValidatorChain(): WsRequestValidator {
        const guard = new QaapGithubAuthGuard();
        (guard as unknown as { sessions: unknown }).sessions = {
            getSession: (id: string | undefined) => id === SESSION_ID
                ? { accessToken: 'gh-token', user: { provider: 'github', login: 'alice', name: 'Alice' } }
                : undefined,
        };
        guard.logSecurityEvent = () => undefined;
        const tokenValidator = new BrowserConnectionTokenBackendContribution();
        (tokenValidator as unknown as { browserConnectionToken: { value: string } }).browserConnectionToken = { value: CONNECTION_TOKEN };
        const authenticated = new QaapAuthenticatedWsRequestValidator();
        (authenticated as unknown as { auth: QaapGithubAuthGuard }).auth = guard;
        const controlPlane = new QaapControlPlaneRpcGuard();
        (controlPlane as unknown as { auth: QaapGithubAuthGuard }).auth = guard;
        const validator = new WsRequestValidator();
        const contributions: WsRequestValidatorContribution[] = [tokenValidator, authenticated, controlPlane];
        (validator as unknown as { requestValidators: unknown }).requestValidators = { getContributions: () => contributions };
        (validator as unknown as { auth: QaapGithubAuthGuard }).auth = guard;
        return validator;
    }

    async function listen(server: http.Server): Promise<number> {
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        return (server.address() as AddressInfo).port;
    }

    async function startControlPlane(withProxy: boolean): Promise<number> {
        const validator = createValidatorChain();
        const server = http.createServer((_req, res) => res.end('control-plane'));
        const endpoint = new WebsocketEndpoint();
        Object.assign(endpoint, {
            wsRequestValidator: validator,
            messagingListener: { onDidWebSocketUpgrade: () => undefined },
            logger: { error: () => undefined },
        });
        endpoint.registerConnectionHandler('/services', (_params, socket) => socket.emit('rpc-ready', 'control-plane'));
        endpoint.onStart(server);
        if (withProxy) {
            const proxy = new QaapTenantBackendProxyContribution() as unknown as Record<string, unknown> & {
                installRequestRouter(server: http.Server): void;
                installUpgradeRouter(server: http.Server): void;
            };
            proxy.auth = (validator as unknown as { auth: QaapGithubAuthGuard }).auth;
            proxy.wsRequestValidator = validator;
            proxy.activity = { touch: () => undefined, beginOperation: () => () => undefined };
            proxy.previewRoutes = { resolve: () => undefined, record: () => undefined };
            proxy.docker = {
                isBackendPerTenantEnabled: () => /^(1|true)$/i.test(process.env.QAAP_BACKEND_PER_TENANT ?? ''),
                ensureTenantBackend: async (login: string) => ({ containerId: login, containerName: login, host: '127.0.0.1', port: tenantPort, tenantLogin: login }),
                getTenantBackendConnectionToken: () => 'tenant-token',
                getTenantBackendAssertionSecret: () => 'z'.repeat(40),
                invalidateTenantBackendTarget: () => undefined,
            };
            proxy.installUpgradeRouter(server);
            proxy.installRequestRouter(server);
        }
        return listen(server);
    }

    before(async () => {
        const tenant = http.createServer((_req, res) => res.end('tenant'));
        new SocketIoServer(tenant).of('/services').on('connection', socket => socket.emit('rpc-ready', 'tenant'));
        tenantPort = await listen(tenant);
        withProxyPort = await startControlPlane(true);
        withoutProxyPort = await startControlPlane(false);
    });

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            delete process.env[key];
        }
        process.env.QAAP_CLOUD_MODE = 'docker';
    });

    afterEach(() => {
        for (const client of clients.splice(0)) {
            client.close();
        }
    });

    after(async () => {
        for (const [key, value] of savedEnv) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        await Promise.all(servers.map(server => new Promise<void>(resolve => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        })));
    });

    function connect(port: number, transports: Array<'polling' | 'websocket'>): Promise<string> {
        const client = io(`http://127.0.0.1:${port}/services`, {
            transports,
            reconnection: false,
            extraHeaders: { cookie: `${BROWSER_TOKEN_COOKIE_NAME}=${CONNECTION_TOKEN}; ${QAAP_AUTH_SESSION_COOKIE}=${SESSION_ID}` },
        });
        clients.push(client);
        return new Promise(resolve => {
            client.once('rpc-ready', (side: string) => resolve(side));
            client.once('connect_error', () => resolve('refused'));
            client.once('disconnect', () => resolve('refused'));
        });
    }

    it('serves a signed-in user from the tenant backend, over polling and WebSocket', async () => {
        process.env.QAAP_BACKEND_PER_TENANT = '1';
        expect(await connect(withProxyPort, ['polling', 'websocket'])).to.equal('tenant');
        expect(await connect(withProxyPort, ['websocket'])).to.equal('tenant');
    });

    it('refuses a signed-in handshake that reaches the control plane Socket.IO server', async () => {
        process.env.QAAP_BACKEND_PER_TENANT = '1';
        expect(await connect(withoutProxyPort, ['polling'])).to.equal('refused');
        expect(await connect(withoutProxyPort, ['websocket'])).to.equal('refused');
    });

    it('refuses Theia RPC for a signed-in user when the per-tenant backend is off', async () => {
        expect(await connect(withProxyPort, ['polling'])).to.equal('refused');
        expect(await connect(withProxyPort, ['websocket'])).to.equal('refused');
    });

    it('keeps the QAAP_TENANT_PROXY_EARLY_ROUTING=0 fallback serving signed-in users', async () => {
        process.env.QAAP_BACKEND_PER_TENANT = '1';
        process.env.QAAP_TENANT_PROXY_EARLY_ROUTING = '0';
        expect(await connect(withoutProxyPort, ['polling'])).to.equal('control-plane');
    });

    it('leaves local mode unchanged', async () => {
        process.env.QAAP_CLOUD_MODE = 'local';
        expect(await connect(withoutProxyPort, ['polling'])).to.equal('control-plane');
    });
});
