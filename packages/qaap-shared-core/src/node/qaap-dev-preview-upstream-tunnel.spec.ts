// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import * as net from 'net';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
import type { Request } from '@theia/core/shared/express';
import { QaapExecDevPreviewUpstreamTunnel, type QaapDevPreviewUpstreamTunnel } from './qaap-dev-preview-upstream-tunnel';
import { QaapExecTunnelSocket, type QaapExecTunnelLaunch } from './qaap-exec-tunnel-socket';
import { QaapDevPreviewEndpoint } from './qaap-dev-preview-endpoint';
import type { QaapGithubAuthContext, QaapGithubAuthGuard } from './qaap-github-auth-guard';
import type { QaapDevPreviewPortRegistry } from './qaap-dev-preview-port-registry';

/**
 * Runs the real bridge script with the local `node`: this process' loopback stands in for the
 * worker's, so the whole tunnel (spawn, ready byte, relay, keep-alive agent) is exercised.
 */
class LocalNodeTunnel extends QaapExecDevPreviewUpstreamTunnel {
    readonly launches: Array<readonly string[]> = [];

    handles(ownerLogin: string): boolean {
        return ownerLogin === 'alice';
    }

    protected wrapRuntimeCommand(_ownerLogin: string, command: readonly string[]): QaapExecTunnelLaunch {
        this.launches.push(command);
        const [file, ...args] = command;
        return { file: file === 'node' ? process.execPath : file, args };
    }
}

function listen(server: http.Server): Promise<number> {
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));
}

function closedPort(): Promise<number> {
    return new Promise(resolve => {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1', () => {
            const port = (probe.address() as net.AddressInfo).port;
            probe.close(() => resolve(port));
        });
    });
}

function get(agent: http.Agent, port: number, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path, agent }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

/** A fake bridge process whose stdout the test controls. */
function fakeBridge(): { child: ChildProcess; stdout: PassThrough; stdin: PassThrough; close(code: number): void } {
    const emitter = new EventEmitter() as unknown as ChildProcess & EventEmitter;
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    // eslint-disable-next-line no-null/no-null
    Object.assign(emitter, { stdout, stdin, exitCode: null, signalCode: null, kill: () => true });
    return {
        child: emitter,
        stdout,
        stdin,
        close: (code: number) => {
            Object.assign(emitter, { exitCode: code });
            stdout.end();
            emitter.emit('close', code);
        },
    };
}

describe('QaapExecDevPreviewUpstreamTunnel', function (): void {
    this.timeout(20_000);

    let server: http.Server;
    let port: number;
    let tunnel: LocalNodeTunnel;

    beforeEach(async () => {
        server = http.createServer((req, res) => {
            if (req.url === '/echo' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => res.end(`echo:${body}`));
                return;
            }
            res.setHeader('content-type', 'text/plain');
            res.end(`hello ${req.url}`);
        });
        port = await listen(server);
        tunnel = new LocalNodeTunnel();
    });

    afterEach(async () => {
        for (const agent of (tunnel as unknown as { agents: Map<string, http.Agent> }).agents.values()) {
            agent.destroy();
        }
        await new Promise(resolve => server.close(resolve));
    });

    it('resolves the host only when something listens in the runtime', async () => {
        expect(await tunnel.resolveHost('alice', port)).to.equal('127.0.0.1');
        expect(await tunnel.resolveHost('alice', await closedPort())).to.equal(undefined);
    });

    it('caches reachability until the port is invalidated', async () => {
        await tunnel.resolveHost('alice', port);
        const probes = tunnel.launches.length;
        await tunnel.resolveHost('alice', port);
        expect(tunnel.launches.length).to.equal(probes);
        tunnel.invalidate(port);
        await tunnel.resolveHost('alice', port);
        expect(tunnel.launches.length).to.equal(probes + 1);
    });

    it('relays HTTP requests and bodies through the bridge and reuses the pooled connection', async () => {
        const agent = tunnel.agentFor('alice');
        expect(tunnel.agentFor('alice')).to.equal(agent);
        const first = await get(agent, port, '/index.html');
        expect(first).to.deep.equal({ status: 200, body: 'hello /index.html' });
        const bridgesAfterFirst = tunnel.launches.filter(command => command.includes('stream')).length;
        const second = await get(agent, port, '/again');
        expect(second.body).to.equal('hello /again');
        expect(tunnel.launches.filter(command => command.includes('stream')).length).to.equal(bridgesAfterFirst);
        const posted = await new Promise<string>((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, path: '/echo', method: 'POST', agent }, res => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => resolve(body));
            });
            req.on('error', reject);
            req.end('payload');
        });
        expect(posted).to.equal('echo:payload');
    });

    it('carries WebSocket-style upgrades (HMR) through the bridge', async () => {
        server.on('upgrade', (_req, socket: net.Socket) => {
            socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
            socket.on('error', () => socket.destroy());
            socket.on('data', chunk => socket.end(`pong:${chunk}`));
        });
        const reply = await new Promise<string>((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1', port, path: '/hmr', agent: tunnel.agentFor('alice'),
                headers: { connection: 'Upgrade', upgrade: 'websocket' },
            });
            req.on('upgrade', (res, socket) => {
                expect(res.statusCode).to.equal(101);
                socket.once('data', (chunk: Buffer) => {
                    resolve(chunk.toString());
                    socket.destroy();
                });
                socket.write('ping');
            });
            req.on('error', reject);
            req.end();
        });
        expect(reply).to.equal('pong:ping');
    });

    it('surfaces a closed runtime port as ECONNREFUSED like a loopback connect', async () => {
        const agent = tunnel.agentFor('alice');
        const error = await get(agent, await closedPort(), '/').then(() => undefined, (err: NodeJS.ErrnoException) => err);
        expect(error?.code).to.equal('ECONNREFUSED');
    });
});

describe('QaapExecTunnelSocket', () => {
    it('strips the ready byte, emits connect and relays the rest', async () => {
        const bridge = fakeBridge();
        const socket = new QaapExecTunnelSocket({ file: 'bridge', args: [] }, 5173, () => bridge.child, 5_000);
        const connected = new Promise<void>(resolve => socket.once('connect', () => resolve()));
        const received: Buffer[] = [];
        socket.on('data', (chunk: Buffer) => received.push(chunk));
        expect(socket.connecting).to.equal(true);
        bridge.stdout.write(Buffer.from([0x01, 0x41, 0x42]));
        await connected;
        expect(socket.connecting).to.equal(false);
        await new Promise(resolve => setImmediate(resolve));
        expect(Buffer.concat(received).toString()).to.equal('AB');
        socket.destroy();
    });

    it('fails with EPROTO when the bridge speaks before the handshake byte', async () => {
        const bridge = fakeBridge();
        const socket = new QaapExecTunnelSocket({ file: 'bridge', args: [] }, 5173, () => bridge.child, 5_000);
        const error = new Promise<NodeJS.ErrnoException>(resolve => socket.once('error', resolve));
        bridge.stdout.write('HTTP/1.1 200 OK');
        expect((await error).code).to.equal('EPROTO');
    });

    it('reports ECONNREFUSED when the bridge exits before connecting', async () => {
        const bridge = fakeBridge();
        const socket = new QaapExecTunnelSocket({ file: 'bridge', args: [] }, 5173, () => bridge.child, 5_000);
        const error = new Promise<NodeJS.ErrnoException>(resolve => socket.once('error', resolve));
        bridge.close(3);
        expect((await error).code).to.equal('ECONNREFUSED');
    });

    it('times out a bridge that never completes the handshake', async () => {
        const bridge = fakeBridge();
        const socket = new QaapExecTunnelSocket({ file: 'bridge', args: [] }, 5173, () => bridge.child, 20);
        const error = await new Promise<NodeJS.ErrnoException>(resolve => socket.once('error', resolve));
        expect(error.code).to.equal('ETIMEDOUT');
    });
});

describe('QaapDevPreviewEndpoint upstream routing', () => {

    class RoutingEndpoint extends QaapDevPreviewEndpoint {
        configureFakes(owner: string | undefined, tunnel: QaapDevPreviewUpstreamTunnel | undefined, ctx?: QaapGithubAuthContext): this {
            const mutable = this as unknown as {
                upstreamTunnel?: QaapDevPreviewUpstreamTunnel;
                portRegistry: QaapDevPreviewPortRegistry;
                auth: QaapGithubAuthGuard;
            };
            mutable.upstreamTunnel = tunnel;
            mutable.portRegistry = {
                ownerOf: () => owner,
                staleOwnerOf: () => undefined,
                getByPort: () => undefined,
                touch: () => undefined,
            } as unknown as QaapDevPreviewPortRegistry;
            mutable.auth = {
                authenticate: () => ctx ?? { kind: 'unauthorized' },
                resolveUserLogin: (c: QaapGithubAuthContext) => (c.kind === 'authenticated' ? c.userLogin : undefined),
            } as unknown as QaapGithubAuthGuard;
            return this;
        }

        exposeMayProxyPort(port: number): boolean {
            return this.mayProxyPort({ headers: {} } as Request, port);
        }
    }

    const fakeAgent = new http.Agent();
    const fakeTunnel: QaapDevPreviewUpstreamTunnel = {
        handles: owner => owner === 'alice',
        resolveHost: async () => '127.0.0.1',
        agentFor: () => fakeAgent,
        invalidate: () => undefined,
        terminateListeners: () => undefined,
    };

    it('uses the default loopback connection without a tunnel', () => {
        const endpoint = new RoutingEndpoint().configureFakes('alice', undefined);
        expect(endpoint.upstreamAgentFor(5173)).to.equal(undefined);
    });

    it('routes a port owned by a tunnelled tenant through its agent', () => {
        const endpoint = new RoutingEndpoint().configureFakes('alice', fakeTunnel);
        expect(endpoint.upstreamAgentFor(5173)).to.equal(fakeAgent);
    });

    it('keeps unowned ports and tenants the tunnel does not handle on loopback', () => {
        expect(new RoutingEndpoint().configureFakes(undefined, fakeTunnel).upstreamAgentFor(5173)).to.equal(undefined);
        expect(new RoutingEndpoint().configureFakes('bob', fakeTunnel).upstreamAgentFor(5173)).to.equal(undefined);
        // An explicit owner hint covers a port that is not claimed yet (claim-time probes).
        expect(new RoutingEndpoint().configureFakes(undefined, fakeTunnel).upstreamAgentFor(5173, 'alice')).to.equal(fakeAgent);
    });

    it('never treats a tunnelled record as dead by its (foreign-namespace) pid', () => {
        const endpoint = new RoutingEndpoint().configureFakes('alice', fakeTunnel);
        expect(endpoint.isPreviewProcessDead({ osProcessId: 2 ** 22 + 12345, port: 5173, ownerLogin: 'alice' })).to.equal(false);
    });

    describe('single-tenant runtimes', () => {
        const tenantEnv = { QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'Alice' };

        it('own unclaimed listeners only in a tenant backend, for its own login', () => {
            const endpoint = new RoutingEndpoint();
            expect(endpoint.ownsUnclaimedPorts('alice', tenantEnv)).to.equal(true);
            expect(endpoint.ownsUnclaimedPorts('bob', tenantEnv)).to.equal(false);
            expect(endpoint.ownsUnclaimedPorts(undefined, tenantEnv)).to.equal(false);
            expect(endpoint.ownsUnclaimedPorts('alice', { QAAP_TENANT_LOGIN: 'alice' })).to.equal(false);
        });

        it('lets the tenant preview a dev server its agent started without a claim', () => {
            const previousMode = process.env.QAAP_TENANT_BACKEND_MODE;
            const previousLogin = process.env.QAAP_TENANT_LOGIN;
            try {
                const ctx: QaapGithubAuthContext = { kind: 'authenticated', userLogin: 'alice', sessionId: 's', session: {} as never };
                const endpoint = new RoutingEndpoint().configureFakes(undefined, undefined, ctx);
                delete process.env.QAAP_TENANT_BACKEND_MODE;
                expect(endpoint.exposeMayProxyPort(5173)).to.equal(false);
                process.env.QAAP_TENANT_BACKEND_MODE = '1';
                process.env.QAAP_TENANT_LOGIN = 'alice';
                expect(endpoint.exposeMayProxyPort(5173)).to.equal(true);
                // Claimed by someone else stays forbidden even here.
                expect(new RoutingEndpoint().configureFakes('mallory', undefined, ctx).exposeMayProxyPort(5173)).to.equal(false);
            } finally {
                restoreEnv('QAAP_TENANT_BACKEND_MODE', previousMode);
                restoreEnv('QAAP_TENANT_LOGIN', previousLogin);
            }
        });
    });
});

function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}
