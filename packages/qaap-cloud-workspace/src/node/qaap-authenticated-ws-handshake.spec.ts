// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { WebsocketEndpoint } from '@theia/core/lib/node/messaging/websocket-endpoint';
import { WsRequestValidator, WsRequestValidatorContribution } from '@theia/core/lib/node/ws-request-validators';
import { BROWSER_TOKEN_COOKIE_NAME, BrowserConnectionTokenBackendContribution } from '@theia/core/lib/node/hosting/browser-connection-token';
import { QAAP_AUTH_SESSION_COOKIE } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAuthenticatedWsRequestValidator } from './qaap-authenticated-ws-request-validator';

/**
 * Integration: Theia's real Socket.IO endpoint and validator chain, the real auth guard and a real
 * `socket.io-client` over loopback on an ephemeral port. Only the session store is in memory.
 */
describe('Theia Socket.IO handshake with QaapAuthenticatedWsRequestValidator', function (): void {
    this.timeout(10_000);

    const CONNECTION_TOKEN = 'connection-token-handed-to-anyone-who-loads-slash';
    const SESSION_ID = 'alice-session';
    const ENV_KEYS = ['NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_SKIP_AUTH', 'QAAP_TENANT_BACKEND_MODE'] as const;
    const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map(key => [key, process.env[key]]));

    let server: http.Server;
    let port: number;
    const clients: ClientSocket[] = [];

    before(async () => {
        const guard = new QaapGithubAuthGuard();
        (guard as unknown as { sessions: unknown }).sessions = {
            getSession: (id: string | undefined) => id === SESSION_ID
                ? { accessToken: 'gh-token', user: { provider: 'github', login: 'alice', name: 'Alice' } }
                : undefined,
        };
        guard.logSecurityEvent = () => undefined;
        const qaapValidator = new QaapAuthenticatedWsRequestValidator();
        (qaapValidator as unknown as { auth: QaapGithubAuthGuard }).auth = guard;
        const tokenValidator = new BrowserConnectionTokenBackendContribution();
        (tokenValidator as unknown as { browserConnectionToken: { value: string } }).browserConnectionToken = { value: CONNECTION_TOKEN };
        const validator = new WsRequestValidator();
        const contributions: WsRequestValidatorContribution[] = [tokenValidator, qaapValidator];
        (validator as unknown as { requestValidators: unknown }).requestValidators = { getContributions: () => contributions };

        const endpoint = new WebsocketEndpoint();
        Object.assign(endpoint, {
            wsRequestValidator: validator,
            messagingListener: { onDidWebSocketUpgrade: () => undefined },
            logger: { error: () => undefined },
        });
        endpoint.registerConnectionHandler('/services', (_params, socket) => socket.emit('rpc-ready', 'services'));

        server = http.createServer((_req, res) => res.end());
        endpoint.onStart(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
    });

    beforeEach(() => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_SKIP_AUTH;
        delete process.env.QAAP_TENANT_BACKEND_MODE;
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
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    function connect(cookie: string, transports: Array<'polling' | 'websocket'>): Promise<'connected' | 'refused'> {
        const client = io(`http://127.0.0.1:${port}/services`, {
            transports,
            reconnection: false,
            extraHeaders: { cookie },
        });
        clients.push(client);
        return new Promise(resolve => {
            client.once('rpc-ready', () => resolve('connected'));
            client.once('connect_error', () => resolve('refused'));
            client.once('disconnect', () => resolve('refused'));
        });
    }

    const tokenOnly = `${BROWSER_TOKEN_COOKIE_NAME}=${CONNECTION_TOKEN}`;
    const signedIn = `${tokenOnly}; ${QAAP_AUTH_SESSION_COOKIE}=${SESSION_ID}`;

    it('refuses an anonymous polling handshake that carries the public connection token', async () => {
        expect(await connect(tokenOnly, ['polling'])).to.equal('refused');
    });

    it('refuses an anonymous direct WebSocket upgrade', async () => {
        expect(await connect(tokenOnly, ['websocket'])).to.equal('refused');
    });

    it('refuses a forged or expired session cookie', async () => {
        expect(await connect(`${tokenOnly}; ${QAAP_AUTH_SESSION_COOKIE}=forged`, ['websocket'])).to.equal('refused');
    });

    it('reaches the RPC namespace with a valid session, over polling and WebSocket', async () => {
        expect(await connect(signedIn, ['polling', 'websocket'])).to.equal('connected');
        expect(await connect(signedIn, ['websocket'])).to.equal('connected');
    });

    it('keeps local mode open to the single local user', async () => {
        delete process.env.QAAP_CLOUD_MODE;
        expect(await connect(tokenOnly, ['websocket'])).to.equal('connected');
    });
});
