// Run: node --test deploy/tenants-runsc/docker-tenants-socket-proxy.test.mjs
// Uses a fake upstream daemon on a temporary unix socket; no Docker needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createProxy, loadConfig, registryOf } from './docker-tenants-socket-proxy.mjs';

const DATA_ROOT = '/opt/qaap-runtime';
const TENANT_LABELS = { 'com.qaap.tenant-container': 'true', 'com.qaap.tenant-login': 'alice' };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tenants-proxy-test-'));
const upstreamPath = path.join(tmp, 'upstream.sock');
const proxyPath = path.join(tmp, 'proxy.sock');
const upstreamRequests = [];
let upstream;
let proxy;
// Raw sockets, including upgraded (hijacked) ones that closeAllConnections() does not reach.
const openSockets = new Set();

/** Fake daemon: records every request that reaches it and answers 201 (or 101 for upgrades). */
function startUpstream() {
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            upstreamRequests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') });
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end('{"Id":"fake"}');
        });
    });
    server.on('connection', socket => openSockets.add(socket));
    server.on('upgrade', (req, socket) => {
        upstreamRequests.push({ method: req.method, url: req.url, upgrade: true });
        socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
        socket.on('data', data => socket.write(`echo:${data.toString()}`));
        socket.on('error', () => {});
    });
    return new Promise(resolve => server.listen(upstreamPath, () => resolve(server)));
}

/** Sends one request through the proxy socket and returns status and body. */
function request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request({
            socketPath: proxyPath,
            method,
            path: urlPath,
            headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        if (payload !== undefined) {
            req.write(payload);
        }
        req.end();
    });
}

function createSpec(overrides = {}) {
    return {
        Image: 'ghcr.io/example/qaap-theia:tag',
        Labels: TENANT_LABELS,
        HostConfig: {
            Binds: [`${DATA_ROOT}/repos/alice:/workspace/repos:rw`],
            PidsLimit: 512,
            SecurityOpt: ['no-new-privileges:true'],
            CapAdd: ['SETUID', 'SETGID']
        },
        ...overrides
    };
}

/** Builds a create spec with HostConfig fields merged over the safe baseline. */
function withHostConfig(hostConfig) {
    const spec = createSpec();
    spec.HostConfig = { ...spec.HostConfig, ...hostConfig };
    return spec;
}

before(async () => {
    upstream = await startUpstream();
    const cfg = {
        ...loadConfig({
            QAAP_TENANT_DATA_ROOT: DATA_ROOT,
            QAAP_TENANT_ALLOWED_VOLUMES: 'qaap_npm-cache',
            QAAP_TENANT_ALLOWED_REGISTRIES: 'ghcr.io'
        }),
        listenPath: proxyPath,
        upstreamPath
    };
    proxy = createProxy(cfg, { log: () => {} });
    proxy.on('connection', socket => openSockets.add(socket));
    await new Promise(resolve => proxy.listen(proxyPath, resolve));
});

after(async () => {
    for (const socket of openSockets) {
        socket.destroy();
    }
    proxy.closeAllConnections();
    upstream.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('container create', () => {
    it('forwards a safe tenant container and the upstream answer', async () => {
        upstreamRequests.length = 0;
        const response = await request('POST', '/v1.47/containers/create', createSpec());
        assert.equal(response.status, 201);
        assert.equal(upstreamRequests.length, 1);
        assert.equal(upstreamRequests[0].url, '/v1.47/containers/create');
        assert.deepEqual(JSON.parse(upstreamRequests[0].body), createSpec());
    });

    it('rejects privileged containers without reaching the daemon', async () => {
        upstreamRequests.length = 0;
        const response = await request('POST', '/containers/create', withHostConfig({ Privileged: true }));
        assert.equal(response.status, 403);
        assert.match(response.body, /privileged/);
        assert.equal(upstreamRequests.length, 0);
    });

    it('rejects a runc runtime', async () => {
        upstreamRequests.length = 0;
        const response = await request('POST', '/containers/create', withHostConfig({ Runtime: 'runc' }));
        assert.equal(response.status, 403);
        assert.match(response.body, /runtime runc/);
        assert.equal(upstreamRequests.length, 0);
    });

    it('accepts the runsc runtime', async () => {
        const response = await request('POST', '/containers/create', withHostConfig({ Runtime: 'runsc' }));
        assert.equal(response.status, 201);
    });

    it('rejects a bind mount outside the data root', async () => {
        const response = await request('POST', '/containers/create', withHostConfig({ Binds: ['/etc:/host-etc:ro'] }));
        assert.equal(response.status, 403);
        assert.match(response.body, /outside/);
    });

    it('rejects a traversal bind that escapes the data root after normalisation', async () => {
        const response = await request('POST', '/containers/create', withHostConfig({ Binds: [`${DATA_ROOT}/../../etc:/x`] }));
        assert.equal(response.status, 403);
    });

    it('rejects a bind whose prefix only looks like the data root', async () => {
        const response = await request('POST', '/containers/create', withHostConfig({ Binds: [`${DATA_ROOT}-evil:/x`] }));
        assert.equal(response.status, 403);
    });

    it('rejects a Mounts entry of type bind outside the data root', async () => {
        const response = await request('POST', '/containers/create', withHostConfig({
            Binds: undefined,
            Mounts: [{ Type: 'bind', Source: '/var/run', Target: '/x' }]
        }));
        assert.equal(response.status, 403);
    });

    it('rejects an unlisted named volume and accepts a listed one', async () => {
        const denied = await request('POST', '/containers/create', withHostConfig({ Binds: ['qaap_other:/x'] }));
        assert.equal(denied.status, 403);
        const allowed = await request('POST', '/containers/create', withHostConfig({ Binds: ['qaap_npm-cache:/x'] }));
        assert.equal(allowed.status, 201);
    });

    it('rejects host namespaces, host networking, devices, unconfined seccomp and extra capabilities', async () => {
        const cases = [
            { PidMode: 'host' },
            { IpcMode: 'host' },
            { UTSMode: 'host' },
            { UsernsMode: 'host' },
            { NetworkMode: 'host' },
            { NetworkMode: 'container:other' },
            { Devices: [{ PathOnHost: '/dev/fuse' }] },
            { SecurityOpt: ['seccomp=unconfined'] },
            { CapAdd: ['SYS_ADMIN'] },
            { CapAdd: ['ALL'] }
        ];
        for (const hostConfig of cases) {
            const response = await request('POST', '/containers/create', withHostConfig(hostConfig));
            assert.equal(response.status, 403, JSON.stringify(hostConfig));
        }
    });

    it('rejects a container without a tenant label', async () => {
        const spec = createSpec({ Labels: { 'com.example': 'x' } });
        const response = await request('POST', '/containers/create', spec);
        assert.equal(response.status, 403);
        assert.match(response.body, /label/);
    });

    it('rejects a body that is not a JSON object', async () => {
        const response = await request('POST', '/containers/create', ['not', 'an', 'object']);
        assert.equal(response.status, 400);
    });
});

describe('endpoint allowlist', () => {
    it('answers the ping endpoint through the version prefix', async () => {
        upstreamRequests.length = 0;
        const response = await request('GET', '/v1.47/_ping');
        assert.notEqual(response.status, 403);
        assert.equal(upstreamRequests[0].url, '/v1.47/_ping');
    });

    it('rejects an endpoint that is not listed', async () => {
        upstreamRequests.length = 0;
        for (const [method, endpoint] of [
            ['GET', '/images/json'],
            ['GET', '/system/df'],
            ['POST', '/containers/abc/update'],
            ['POST', '/swarm/init'],
            ['GET', '/events']
        ]) {
            const response = await request(method, endpoint);
            assert.equal(response.status, 403, `${method} ${endpoint}`);
        }
        assert.equal(upstreamRequests.length, 0);
    });

    it('rejects a path that decodes to a dot segment', async () => {
        const response = await request('DELETE', '/containers/..%2Fnetworks');
        assert.equal(response.status, 400);
    });

    it('rejects an image pull from a registry that is not allowed', async () => {
        const denied = await request('POST', `/images/create?fromImage=${encodeURIComponent('docker.io/library/busybox')}&tag=latest`);
        assert.equal(denied.status, 403);
        const denied2 = await request('POST', '/images/create?fromSrc=-&repo=x');
        assert.equal(denied2.status, 403);
    });

    it('rejects a network driver other than bridge', async () => {
        const response = await request('POST', '/networks/create', { Name: 'x', Driver: 'macvlan' });
        assert.equal(response.status, 403);
    });

    it('rejects a privileged exec', async () => {
        const response = await request('POST', '/containers/abc/exec', { Cmd: ['sh'], Privileged: true });
        assert.equal(response.status, 403);
    });

    it('rejects a request body above the size limit', async () => {
        // The proxy answers 413 and closes before the client finishes writing, so the client
        // may see EPIPE. The response is what matters, so the error is ignored once it arrived.
        const payload = JSON.stringify({ Image: 'x', Labels: TENANT_LABELS, Pad: 'x'.repeat(1024 * 1024 + 10) });
        const received = await new Promise(resolve => {
            const socket = net.connect({ path: proxyPath });
            let text = '';
            socket.on('data', data => {
                text += data.toString();
                if (text.includes('\r\n')) {
                    socket.destroy();
                    resolve(text);
                }
            });
            socket.on('error', () => {});
            socket.on('close', () => resolve(text));
            socket.write(`POST /containers/create HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\n`
                + `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n`);
            socket.write(payload);
        });
        assert.match(received, /^HTTP\/1\.1 413/);
    });
});

describe('connection upgrade (attach / exec start)', () => {
    it('streams bytes both ways after the upstream answers 101', async () => {
        upstreamRequests.length = 0;
        const result = await new Promise((resolve, reject) => {
            const socket = net.connect({ path: proxyPath });
            let received = '';
            socket.on('data', data => {
                received += data.toString();
                if (received.includes('echo:hello')) {
                    socket.end();
                    resolve(received);
                }
            });
            socket.on('error', reject);
            socket.write('POST /v1.47/containers/abc/attach?stream=1 HTTP/1.1\r\nHost: docker\r\n'
                + 'Connection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 0\r\n\r\n');
            socket.once('data', () => socket.write('hello'));
        });
        assert.match(result, /101 UPGRADED/);
        assert.equal(upstreamRequests[0].upgrade, true);
    });

    it('rejects an upgrade on an endpoint that is not an attach or exec start', async () => {
        const result = await new Promise((resolve, reject) => {
            const socket = net.connect({ path: proxyPath });
            let received = '';
            socket.on('data', data => { received += data.toString(); });
            socket.on('end', () => resolve(received));
            socket.on('error', reject);
            socket.write('POST /containers/create HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 0\r\n\r\n');
        });
        assert.match(result, /^HTTP\/1\.1 403/);
    });
});

describe('registryOf', () => {
    it('reads the registry host, defaulting to docker.io', () => {
        assert.equal(registryOf('ghcr.io/example/app:1'), 'ghcr.io');
        assert.equal(registryOf('localhost:5000/app'), 'localhost:5000');
        assert.equal(registryOf('busybox'), 'docker.io');
        assert.equal(registryOf('library/busybox'), 'docker.io');
    });
});
