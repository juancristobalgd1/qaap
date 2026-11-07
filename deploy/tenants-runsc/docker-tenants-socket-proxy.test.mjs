// Run: node --test deploy/tenants-runsc/docker-tenants-socket-proxy.test.mjs
// Uses a fake upstream daemon on a temporary unix socket and a temporary data root; no Docker needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createProxy, loadConfig, parseStrictJson, registryOf } from './docker-tenants-socket-proxy.mjs';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tenants-proxy-test-')));
const DATA_ROOT = path.join(tmp, 'opt-qaap-runtime');
const OUTSIDE = path.join(tmp, 'outside');
const upstreamPath = path.join(tmp, 'upstream.sock');
const proxyPath = path.join(tmp, 'proxy.sock');

const OWNED_CONTAINERS = new Set(['qaap-ws-abc', 'qaap-backend-abc']);
const FOREIGN_CONTAINERS = new Set(['foreign', 'caddy']);
const EXECS = { 'exec-owned': 'qaap-ws-abc', 'exec-foreign': 'foreign', 'exec-stopped': 'qaap-ws-abc' };
const MANAGED = { 'com.qaap.managed': 'true' };

/** Every request that reached the fake daemon. */
let upstreamRequests = [];
/** Bytes the fake daemon received on a connection after answering a non-101 to an upgrade. */
let smuggled = [];
let upstream;
let proxy;
const openSockets = new Set();

function mkdirs(...relative) {
    for (const entry of relative) {
        fs.mkdirSync(path.join(DATA_ROOT, entry), { recursive: true });
    }
}

function setUpDataRoot() {
    for (const tenant of ['alice', 'bob']) {
        mkdirs(`workspace/repos/users/${tenant}`, `worktrees/${tenant}`, `parallel/${tenant}`, `auth/users/${tenant}/theia-home`);
    }
    fs.mkdirSync(path.join(OUTSIDE, 'theia-home'), { recursive: true });
    // The tenant directory itself is a symlink to the host root.
    fs.symlinkSync('/', path.join(DATA_ROOT, 'workspace/repos/users/mallory'));
    // An intermediate component is a symlink: auth/users/trudy -> outside, so .../trudy/theia-home escapes.
    fs.symlinkSync(OUTSIDE, path.join(DATA_ROOT, 'auth/users/trudy'));
    // The last component is a symlink planted inside a tenant-writable directory.
    fs.symlinkSync('/etc', path.join(DATA_ROOT, 'auth/users/alice/evil'));
    fs.rmSync(path.join(DATA_ROOT, 'auth/users/bob/theia-home'), { recursive: true });
    fs.symlinkSync('/etc', path.join(DATA_ROOT, 'auth/users/bob/theia-home'));
}

function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

/** Fake daemon: answers inspects for the fixtures above, records and answers 201 for everything else. */
function startUpstream() {
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            upstreamRequests.push({ method: req.method, url: req.url, body, headers: req.headers });
            const container = /^\/(?:v[\d.]+\/)?containers\/([^/]+)\/json$/.exec(req.url ?? '');
            if (req.method === 'GET' && container) {
                const id = container[1];
                if (OWNED_CONTAINERS.has(id) || FOREIGN_CONTAINERS.has(id)) {
                    json(res, 200, {
                        Id: `${id}-id`,
                        Name: `/${id}`,
                        Config: { Labels: OWNED_CONTAINERS.has(id) ? MANAGED : {}, Env: ['QAAP_BUILD_SHA=abc', 'SECRET=s'] },
                        HostConfig: { Runtime: 'runsc', NetworkMode: 'qaap-net-v3-abc' },
                        GraphDriver: { Data: { UpperDir: '/var/lib/docker-tenants/overlay2/x/diff' } },
                        LogPath: '/var/lib/docker-tenants/containers/x/x-json.log',
                        ResolvConfPath: '/var/lib/docker-tenants/containers/x/resolv.conf'
                    });
                } else {
                    json(res, 404, { message: `No such container: ${id}` });
                }
                return;
            }
            const exec = /^\/exec\/([^/]+)\/json$/.exec(req.url ?? '');
            if (req.method === 'GET' && exec) {
                return EXECS[exec[1]] ? json(res, 200, { ContainerID: EXECS[exec[1]] }) : json(res, 404, { message: 'No such exec instance' });
            }
            const network = /^\/networks\/([^/]+)$/.exec(req.url ?? '');
            if (req.method === 'GET' && network) {
                if (network[1].startsWith('qaap-')) {
                    return json(res, 200, { Name: network[1], Labels: MANAGED });
                }
                return network[1] === 'foreign-net' ? json(res, 200, { Name: 'foreign-net', Labels: {} }) : json(res, 404, { message: 'network not found' });
            }
            json(res, 201, { Id: 'fake' });
        });
    });
    server.on('connection', socket => openSockets.add(socket));
    server.on('upgrade', (req, socket, head) => {
        socket.on('error', () => {});
        upstreamRequests.push({ method: req.method, url: req.url, upgrade: true, head: head.toString('utf8'), headers: req.headers });
        if (req.url.includes('/exec/exec-stopped/start')) {
            const body = '{"message":"container is not running"}';
            socket.write(`HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
            // A keep-alive daemon would parse anything that arrives next as a new request.
            socket.on('data', data => smuggled.push(data.toString('utf8')));
            return;
        }
        socket.write('HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
        socket.on('data', data => socket.write(`echo:${data.toString()}`));
    });
    return new Promise(resolve => server.listen(upstreamPath, () => resolve(server)));
}

/** One request through the proxy; returns status, headers and body. */
function request(method, urlPath, body, options = {}) {
    return new Promise((resolve, reject) => {
        const payload = options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
        const req = http.request({
            socketPath: proxyPath,
            method,
            path: urlPath,
            agent: false,
            headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        if (payload !== undefined) {
            req.write(payload);
        }
        req.end();
    });
}

/** Writes raw bytes to the proxy and collects the answer until the proxy closes or `waitMs` passes. */
function rawExchange(chunks, { waitMs = 600, onData } = {}) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(proxyPath);
        openSockets.add(socket);
        let received = '';
        let closed = false;
        socket.on('data', data => {
            received += data.toString('utf8');
            onData?.(socket, received);
        });
        socket.on('error', () => {});
        socket.on('close', () => {
            closed = true;
        });
        socket.on('connect', async () => {
            for (const chunk of chunks) {
                if (typeof chunk === 'number') {
                    await new Promise(r => setTimeout(r, chunk));
                } else if (!socket.destroyed) {
                    socket.write(chunk);
                }
            }
            setTimeout(() => {
                const wasClosed = closed;
                socket.destroy();
                resolve({ received, closed: wasClosed });
            }, waitMs);
        });
        socket.on('timeout', reject);
    });
}

function lastForwarded(method, pattern) {
    return [...upstreamRequests].reverse().find(entry => entry.method === method && pattern.test(entry.url));
}

const D = DATA_ROOT;
const LOG_CONFIG = { Type: 'json-file', Config: { 'max-size': '50m', 'max-file': '5' } };

/** Worker body as built by QaapDockerOrchestrator (hosted user 0:0, egress env, three tenant roots). */
function workerBody() {
    return {
        Image: 'ghcr.io/example/qaap-theia:tag',
        Tty: true,
        OpenStdin: true,
        WorkingDir: '/workspace',
        Cmd: ['/bin/bash'],
        Healthcheck: { Test: ['NONE'] },
        User: '0:0',
        Env: ['HOME=/home/qaap-tenant', 'USER=qaap-tenant', 'LOGNAME=qaap-tenant', 'HTTPS_PROXY=http://qaap-egress-proxy:3128'],
        Labels: { ...MANAGED, 'com.qaap.tenant-container': 'true', 'com.qaap.tenant-name': 'qaap-tenant-abc', 'com.qaap.tenant-login': 'alice' },
        HostConfig: {
            LogConfig: LOG_CONFIG,
            Init: true,
            Binds: [
                `${D}/workspace/repos/users/alice:/workspace:rw`,
                `${D}/worktrees/alice:/worktrees:rw`,
                `${D}/parallel/alice:/parallel:rw`
            ],
            Memory: 4294967296,
            NanoCpus: 2000000000,
            PidsLimit: 512,
            SecurityOpt: ['no-new-privileges:true'],
            CapDrop: ['ALL'],
            ReadonlyRootfs: true,
            Tmpfs: { '/tmp': 'rw,exec,nosuid,nodev,size=2g,mode=1777' },
            NetworkMode: 'qaap-net-v3-abc',
            AutoRemove: false,
            Runtime: 'runsc'
        }
    };
}

function backendBody() {
    return {
        Image: 'ghcr.io/example/qaap-theia:tag',
        User: '0:0',
        WorkingDir: '/app/examples/browser',
        Cmd: ['node', 'src-gen/backend/main.js', '--hostname=0.0.0.0', '--port=4873', '--no-cluster'],
        Env: ['QAAP_TENANT_BACKEND_MODE=1', 'QAAP_TENANT_BACKEND_SECRET=deadbeef', 'HOST=0.0.0.0', 'PORT=4873'],
        ExposedPorts: { '4873/tcp': {} },
        Labels: { ...MANAGED, 'com.qaap.tenant-backend': 'true', 'com.qaap.tenant-name': 'qaap-backend-abc', 'com.qaap.tenant-login': 'alice' },
        HostConfig: {
            LogConfig: LOG_CONFIG,
            Init: true,
            Binds: [
                `${D}/workspace/repos/users/alice:/workspace/repos/users/alice:rw`,
                `${D}/worktrees/alice:/tmp/qaap-worktrees/alice:rw`,
                `${D}/parallel/alice:/tmp/qaap-parallel/alice:rw`,
                `${D}/auth/users/alice:/home/theia/.qaap:rw`,
                `${D}/auth/users/alice/theia-home:/home/theia/.theia:rw`
            ],
            Memory: 4294967296,
            NanoCpus: 2000000000,
            PidsLimit: 512,
            SecurityOpt: ['no-new-privileges:true'],
            CapDrop: ['ALL'],
            CapAdd: ['SETUID', 'SETGID'],
            ReadonlyRootfs: true,
            Tmpfs: { '/tmp': 'rw,exec,nosuid,nodev,size=2g,mode=1777', '/app/logs': 'rw,exec,nosuid,nodev,size=64m' },
            NetworkMode: 'qaap-net-v3-abc',
            RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
            AutoRemove: false,
            Runtime: 'runsc'
        }
    };
}

function relayBody() {
    return {
        Image: 'ghcr.io/example/qaap-theia:tag',
        User: '0:0',
        WorkingDir: '/app',
        Cmd: ['node', '-e', 'relay'],
        Healthcheck: { Test: ['NONE'] },
        ExposedPorts: { '4873/tcp': {} },
        Labels: { ...MANAGED, 'com.qaap.tenant-backend-ingress-relay': 'true', 'com.qaap.tenant-name': 'qaap-ingress-abc',
            'com.qaap.tenant-login': 'alice', 'com.qaap.tenant-backend-name': 'qaap-backend-abc' },
        HostConfig: {
            LogConfig: LOG_CONFIG,
            Init: true,
            PortBindings: { '4873/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] },
            Memory: 134217728,
            NanoCpus: 250000000,
            PidsLimit: 64,
            SecurityOpt: ['no-new-privileges:true'],
            CapDrop: ['ALL'],
            ReadonlyRootfs: true,
            Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=16m' },
            NetworkMode: 'qaap-ingress-v1-abc',
            AutoRemove: false,
            Runtime: 'runsc'
        }
    };
}

function egressBody() {
    return {
        Image: 'ghcr.io/example/qaap-egress:tag',
        User: 'proxy',
        Cmd: ['squid', '-N', '-f', '/etc/squid/squid.conf'],
        Labels: { ...MANAGED, 'com.qaap.tenant-egress-proxy': 'true', 'com.qaap.tenant-login': 'alice' },
        HostConfig: {
            LogConfig: LOG_CONFIG,
            NetworkMode: 'qaap-tenant-egress-uplink',
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges:true'],
            ReadonlyRootfs: true,
            Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=16m' },
            AutoRemove: false,
            Runtime: 'runsc'
        }
    };
}

function sandboxBody() {
    return {
        name: 'qaap-task-0123456789ab',
        Image: 'ghcr.io/example/qaap-theia:tag',
        User: '1001:1001',
        WorkingDir: '/workspace/repos/users/alice/repo',
        Entrypoint: ['/opt/qaap-agent/1/bin/node', '/opt/qaap-agent/1/lib/qaap-task-sandbox-exec-server.js'],
        Cmd: [],
        Env: ['HOME=/tmp/qaap-home', 'PATH=/opt/qaap-agent/1/bin:/usr/bin', 'QAAP_SANDBOX_EXEC_PORT=7070', 'QAAP_SANDBOX_HOME_LINKS=[]'],
        Labels: { ...MANAGED, 'com.qaap.task-sandbox': 'true', 'com.qaap.task-sandbox.broker': 'true',
            'com.qaap.task-sandbox.worktree': '/workspace/repos/users/alice/repo', 'com.qaap.tenant-login': 'alice' },
        Healthcheck: { Test: ['NONE'] },
        OpenStdin: true,
        StdinOnce: true,
        AttachStdin: true,
        HostConfig: {
            LogConfig: LOG_CONFIG,
            Init: true,
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges:true'],
            PidsLimit: 1024,
            Memory: 4294967296,
            NanoCpus: 2000000000,
            ReadonlyRootfs: true,
            Tmpfs: {
                '/tmp': 'rw,exec,nosuid,nodev,size=2g,mode=1777',
                '/tmp/qaap-home': 'rw,exec,nosuid,nodev,size=1g,mode=0700,uid=1001,gid=1001'
            },
            Binds: [
                `${D}/workspace/repos/users/alice:/workspace/repos/users/alice:rw`,
                `${D}/worktrees/alice:/tmp/qaap-worktrees/alice:rw`,
                `${D}/parallel/alice:/tmp/qaap-parallel/alice:rw`,
                `${D}/auth/users/Alice:/home/theia/.qaap:rw`.replace('/Alice:', '/alice:'),
                'qaap-agent-toolchain-0123456789ab:/opt/qaap-agent:ro'
            ],
            NetworkMode: 'qaap-net-v3-abc',
            AutoRemove: false,
            Runtime: 'runsc'
        }
    };
}

function toolchainBody() {
    return {
        Image: 'ghcr.io/example/qaap-theia:tag',
        User: '0:0',
        Entrypoint: ['/bin/sh', '-c', 'set -e; mkdir -p /out/.staging'],
        Cmd: [],
        Env: ['QAAP_EXEC_SERVER_JS=line1\nline2'],
        Labels: { ...MANAGED },
        HostConfig: {
            LogConfig: LOG_CONFIG,
            Binds: ['qaap-agent-toolchain-0123456789ab:/out'],
            NetworkMode: 'none',
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges:true'],
            ReadonlyRootfs: true,
            AutoRemove: false,
            Runtime: 'runsc'
        }
    };
}

/** POST /containers/create; `name` goes in the query like dockerode does. */
async function create(body, query = '') {
    const { name, ...rest } = body;
    const target = `/v1.47/containers/create${name ? `?name=${name}` : query}`;
    return request('POST', target, rest);
}

function withHost(fields) {
    const body = workerBody();
    body.HostConfig = { ...body.HostConfig, ...fields };
    return body;
}

before(async () => {
    setUpDataRoot();
    upstream = await startUpstream();
    const cfg = {
        ...loadConfig({
            QAAP_TENANT_PROXY_UPSTREAM: upstreamPath,
            QAAP_TENANT_DATA_ROOT: DATA_ROOT,
            QAAP_TENANT_PUBLISH_HOST_IPS: '127.0.0.1'
        }),
        ownershipCacheMs: 0
    };
    proxy = createProxy(cfg, { log: () => {} });
    proxy.on('connection', socket => openSockets.add(socket));
    await new Promise(resolve => proxy.listen(proxyPath, resolve));
});

beforeEach(() => {
    upstreamRequests = [];
    smuggled = [];
});

after(async () => {
    for (const socket of openSockets) {
        socket.destroy();
    }
    await new Promise(resolve => proxy.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('strict JSON parser', () => {
    it('rejects exact duplicate keys at any depth', () => {
        assert.throws(() => parseStrictJson('{"Image":"a","Image":"b"}'), /duplicate/);
        assert.throws(() => parseStrictJson('{"HostConfig":{"Runtime":"runsc","Runtime":"runc"}}'), /duplicate/);
    });
    it('rejects keys that differ only in case, including Go folding of U+017F and U+212A', () => {
        assert.throws(() => parseStrictJson('{"HostConfig":{},"hostConfig":{}}'), /duplicate or case-variant/);
        assert.throws(() => parseStrictJson('{"HostConfig":{"Binds":[],"Bind\u017f":[]}}'), /case-variant/);
        assert.throws(() => parseStrictJson('{"Kind":1,"Kind":2}'), /case-variant/);
    });
    it('treats __proto__ as an ordinary key and rejects trailing data', () => {
        const parsed = parseStrictJson('{"__proto__":{"Privileged":true}}');
        assert.equal(Object.getPrototypeOf(parsed), null);
        assert.equal(({}).Privileged, undefined);
        assert.throws(() => parseStrictJson('{} {"x":1}'), /trailing data/);
        assert.throws(() => parseStrictJson('{"a":1,}'), /not valid JSON/);
    });
});

describe('identity header', () => {
    it('answers /_ping with X-Qaap-Tenant-Proxy: 1, and on denials too', async () => {
        const ping = await request('GET', '/_ping');
        assert.equal(ping.status, 201);
        assert.equal(ping.headers['x-qaap-tenant-proxy'], '1');
        const denied = await request('POST', '/build');
        assert.equal(denied.status, 403);
        assert.equal(denied.headers['x-qaap-tenant-proxy'], '1');
    });
    it('sends every forwarded request with Connection: close and drops hop-by-hop headers', async () => {
        await request('GET', '/version');
        assert.equal(lastForwarded('GET', /\/version$/).headers.connection, 'close');
    });
});

describe('containers/create: bodies the orchestrator and broker send today', () => {
    for (const [label, build] of [
        ['tenant worker', workerBody], ['tenant backend', backendBody], ['ingress relay', relayBody],
        ['egress proxy', egressBody], ['task sandbox', sandboxBody], ['toolchain populate', toolchainBody]
    ]) {
        it(`forwards the ${label} as a canonical body with Runtime runsc`, async () => {
            const body = build();
            const res = await create(body);
            assert.equal(res.status, 201, res.body);
            const forwarded = JSON.parse(lastForwarded('POST', /containers\/create/).body);
            assert.equal(forwarded.HostConfig.Runtime, 'runsc');
            assert.deepEqual(forwarded.HostConfig.CapDrop, ['ALL']);
            assert.deepEqual(forwarded.HostConfig.SecurityOpt, ['no-new-privileges:true']);
            assert.deepEqual(forwarded.HostConfig.Binds ?? [], body.HostConfig.Binds ?? []);
            assert.deepEqual(forwarded.Env ?? [], body.Env ?? []);
            assert.ok(forwarded.HostConfig.PidsLimit > 0);
        });
    }

    it('forces Runtime runsc, a PidsLimit and NetworkMode none when they are omitted', async () => {
        const body = toolchainBody();
        delete body.HostConfig.Runtime;
        delete body.HostConfig.NetworkMode;
        assert.equal((await create(body)).status, 201);
        const forwarded = JSON.parse(lastForwarded('POST', /containers\/create/).body);
        assert.equal(forwarded.HostConfig.Runtime, 'runsc');
        assert.equal(forwarded.HostConfig.NetworkMode, 'none');
        assert.equal(forwarded.HostConfig.PidsLimit, 4096);
    });

    it('drops the docker CLI zero-valued defaults instead of forwarding them', async () => {
        const body = withHost({
            Privileged: false, MaskedPaths: null, ReadonlyPaths: [], Dns: [], ConsoleSize: [0, 0],
            ShmSize: 0, OomKillDisable: false, CgroupParent: '', PidMode: '', VolumesFrom: null, Devices: []
        });
        Object.assign(body, { Hostname: '', Domainname: '', Volumes: {}, OnBuild: null, StdinOnce: false });
        const res = await create(body);
        assert.equal(res.status, 201, res.body);
        const forwarded = JSON.parse(lastForwarded('POST', /containers\/create/).body);
        for (const field of ['Privileged', 'MaskedPaths', 'ReadonlyPaths', 'Dns', 'ShmSize', 'OomKillDisable', 'CgroupParent', 'PidMode', 'Devices']) {
            assert.equal(field in forwarded.HostConfig, false, field);
        }
        assert.equal('Hostname' in forwarded, false);
    });
});

describe('containers/create: refused', () => {
    const cases = [
        ['HostConfig + hostConfig (Go would merge the second)', { rawBody: JSON.stringify(workerBody()).replace(/}$/, ',"hostConfig":{"Privileged":true,"Runtime":"runc","Binds":["/:/h"]}}') }, 400],
        ['exact duplicate HostConfig', { rawBody: JSON.stringify(workerBody()).replace(/}$/, ',"HostConfig":{"Privileged":true}}') }, 400],
        ['duplicate Runtime inside HostConfig', { rawBody: JSON.stringify(workerBody()).replace('"Runtime":"runsc"', '"Runtime":"runsc","Runtime":"runc"') }, 400],
        ['lower-case hostconfig only', { body: { ...workerBody(), HostConfig: undefined, hostconfig: { Privileged: true } } }, 403],
        ['lower-case privileged inside HostConfig', { body: withHost({ privileged: true }) }, 403],
        ['long-s variant of Binds next to Binds', { body: withHost({ 'Bind\u017f': ['/:/host'] }) }, 400],
        ['long-s variant of Binds alone', { body: withHost({ Binds: undefined, 'Bind\u017f': ['/:/host'] }) }, 403],
        ['Privileged true', { body: withHost({ Privileged: true }) }, 403],
        ['Privileged as the string "false"', { body: withHost({ Privileged: 'false' }) }, 403],
        ['Runtime runc', { body: withHost({ Runtime: 'runc' }) }, 403],
        ['Runtime RUNSC', { body: withHost({ Runtime: 'RUNSC' }) }, 403],
        ['CapAdd ALL', { body: withHost({ CapAdd: ['ALL'] }) }, 403],
        ['CapAdd CAP_SYS_ADMIN', { body: withHost({ CapAdd: ['CAP_SYS_ADMIN'] }) }, 403],
        ['CapAdd lower-case setuid', { body: withHost({ CapAdd: ['setuid'] }) }, 403],
        ['CapDrop not ALL', { body: withHost({ CapDrop: ['NET_RAW'] }) }, 403],
        ['SecurityOpt label=disable', { body: withHost({ SecurityOpt: ['label=disable'] }) }, 403],
        ['SecurityOpt extra label:disable', { body: withHost({ SecurityOpt: ['no-new-privileges:true', 'label:disable'] }) }, 403],
        ['SecurityOpt seccomp=unconfined', { body: withHost({ SecurityOpt: ['seccomp=unconfined'] }) }, 403],
        ['SecurityOpt apparmor profile', { body: withHost({ SecurityOpt: ['no-new-privileges:true', 'apparmor=docker-default'] }) }, 403],
        ['SecurityOpt inline seccomp JSON', { body: withHost({ SecurityOpt: ['seccomp={"defaultAction":"SCMP_ACT_ALLOW"}'] }) }, 403],
        ['SecurityOpt systempaths=unconfined', { body: withHost({ SecurityOpt: ['systempaths=unconfined'] }) }, 403],
        ['SecurityOpt no-new-privileges=false', { body: withHost({ SecurityOpt: ['no-new-privileges=false'] }) }, 403],
        ['Sysctls', { body: withHost({ Sysctls: { 'net.ipv4.ip_forward': '1' } }) }, 403],
        ['CgroupParent', { body: withHost({ CgroupParent: '/system.slice/sshd.service' }) }, 403],
        ['Cgroup host', { body: withHost({ Cgroup: 'host' }) }, 403],
        ['PidMode container:', { body: withHost({ PidMode: 'container:caddy' }) }, 403],
        ['PidMode host', { body: withHost({ PidMode: 'host' }) }, 403],
        ['IpcMode host', { body: withHost({ IpcMode: 'host' }) }, 403],
        ['IpcMode shareable', { body: withHost({ IpcMode: 'shareable' }) }, 403],
        ['UTSMode host', { body: withHost({ UTSMode: 'host' }) }, 403],
        ['UsernsMode host', { body: withHost({ UsernsMode: 'host' }) }, 403],
        ['CgroupnsMode host', { body: withHost({ CgroupnsMode: 'host' }) }, 403],
        ['NetworkMode host', { body: withHost({ NetworkMode: 'host' }) }, 403],
        ['NetworkMode container:', { body: withHost({ NetworkMode: 'container:caddy' }) }, 403],
        ['NetworkMode bridge', { body: withHost({ NetworkMode: 'bridge' }) }, 403],
        ['Devices', { body: withHost({ Devices: [{ PathOnHost: '/dev/sda', PathInContainer: '/dev/sda', CgroupPermissions: 'rwm' }] }) }, 403],
        ['DeviceRequests', { body: withHost({ DeviceRequests: [{ Count: -1, Capabilities: [['gpu']] }] }) }, 403],
        ['DeviceCgroupRules', { body: withHost({ DeviceCgroupRules: ['a *:* rwm'] }) }, 403],
        ['VolumesFrom', { body: withHost({ VolumesFrom: ['caddy'] }) }, 403],
        ['Mounts bind of /', { body: withHost({ Mounts: [{ Type: 'bind', Source: '/', Target: '/host' }] }) }, 403],
        ['Mounts volume with DriverConfig', { body: withHost({ Mounts: [{ Type: 'volume', Source: 'x', Target: '/x', VolumeOptions: { DriverConfig: { Name: 'local', Options: { o: 'bind', device: '/' } } } }] }) }, 403],
        ['Mounts tmpfs', { body: withHost({ Mounts: [{ Type: 'tmpfs', Target: '/x' }] }) }, 403],
        ['OomKillDisable', { body: withHost({ OomKillDisable: true }) }, 403],
        ['ShmSize', { body: withHost({ ShmSize: 1e12 }) }, 403],
        ['Ulimits', { body: withHost({ Ulimits: [{ Name: 'nofile', Soft: 1e9, Hard: 1e9 }] }) }, 403],
        ['MaskedPaths emptied by a non-empty override', { body: withHost({ MaskedPaths: ['/nothing'] }) }, 403],
        ['Isolation', { body: withHost({ Isolation: 'hyperv' }) }, 403],
        ['PidsLimit -1', { body: withHost({ PidsLimit: -1 }) }, 403],
        ['PortBindings on 0.0.0.0', { body: withHost({ PortBindings: { '4873/tcp': [{ HostIp: '0.0.0.0', HostPort: '' }] } }) }, 403],
        ['PortBindings without HostIp', { body: withHost({ PortBindings: { '4873/tcp': [{ HostPort: '8080' }] } }) }, 403],
        ['PortBindings privileged host port', { body: withHost({ PortBindings: { '22/tcp': [{ HostIp: '127.0.0.1', HostPort: '22' }] } }) }, 403],
        ['PublishAllPorts', { body: withHost({ PublishAllPorts: true }) }, 403],
        ['ExtraHosts', { body: withHost({ ExtraHosts: ['metadata:169.254.169.254'] }) }, 403],
        ['Tmpfs with suid', { body: withHost({ Tmpfs: { '/tmp': 'rw,suid' } }) }, 403],
        ['bind of the host root', { body: withHost({ Binds: ['/:/host'] }) }, 403],
        ['bind with ..', { body: withHost({ Binds: [`${D}/../etc:/x`] }) }, 403],
        ['bind under a sibling prefix', { body: withHost({ Binds: [`${D}-evil/workspace/repos/users/alice:/x`] }) }, 403],
        ['bind of a subdirectory of a tenant root', { body: withHost({ Binds: [`${D}/workspace/repos/users/alice/repo:/x`] }) }, 403],
        ['bind with a trailing slash', { body: withHost({ Binds: [`${D}/worktrees/alice/:/x`] }) }, 403],
        ['bind of the data root itself', { body: withHost({ Binds: [`${D}:/x`] }) }, 403],
        ['bind whose tenant directory is a symlink to /', { body: withHost({ Binds: [`${D}/workspace/repos/users/mallory:/x`] }) }, 403],
        ['bind through an intermediate symlink', { body: withHost({ Binds: [`${D}/auth/users/trudy/theia-home:/x`] }) }, 403],
        ['bind whose last component is a symlink', { body: withHost({ Binds: [`${D}/auth/users/bob/theia-home:/x`] }) }, 403],
        ['bind of a missing tenant directory', { body: withHost({ Binds: [`${D}/worktrees/ghost:/x`] }) }, 403],
        ['bind with propagation rshared', { body: withHost({ Binds: [`${D}/worktrees/alice:/x:rshared`] }) }, 403],
        ['bind with rw,rshared', { body: withHost({ Binds: [`${D}/worktrees/alice:/x:rw,rshared`] }) }, 403],
        ['binds of two tenants', { body: withHost({ Binds: [`${D}/worktrees/alice:/a`, `${D}/worktrees/bob:/b`] }) }, 403],
        ['bind of an arbitrary named volume', { body: withHost({ Binds: ['evil:/x'] }) }, 403],
        ['bind destination /', { body: withHost({ Binds: [`${D}/worktrees/alice:/`] }) }, 403],
        ['missing com.qaap.managed label', { body: { ...workerBody(), Labels: { 'com.qaap.tenant-container': 'true' } } }, 403],
        ['non-Qaap label key', { body: { ...workerBody(), Labels: { ...MANAGED, 'io.evil': 'x' } } }, 403],
        ['NetworkingConfig for another network', { body: { ...workerBody(), NetworkingConfig: { EndpointsConfig: { 'qaap-net-v3-other': {} } } } }, 403],
        ['NetworkingConfig with a static IP', { body: { ...workerBody(), NetworkingConfig: { EndpointsConfig: { 'qaap-net-v3-abc': { IPAMConfig: { IPv4Address: '10.0.0.5' } } } } } }, 403],
        ['body that is an array', { rawBody: '[]' }, 400]
    ];
    for (const [label, input, status] of cases) {
        it(label, async () => {
            const res = input.rawBody !== undefined
                ? await request('POST', '/containers/create', undefined, { rawBody: input.rawBody })
                : await request('POST', '/containers/create', input.body);
            assert.equal(res.status, status, res.body);
            assert.equal(lastForwarded('POST', /containers\/create/), undefined);
        });
    }

    it('refuses a non-Qaap container name and unknown query parameters', async () => {
        assert.equal((await request('POST', '/containers/create?name=caddy', workerBody())).status, 403);
        assert.equal((await request('POST', '/containers/create?name=qaap-ws-a&name=caddy', workerBody())).status, 400);
        assert.equal((await request('POST', '/containers/create?name=qaap-ws-a;x=1', workerBody())).status, 400);
        assert.equal(lastForwarded('POST', /containers\/create/), undefined);
    });
});

describe('request targets', () => {
    for (const target of ['/containers/abc%2Fupdate/start', '/containers/%2e%2e/build', '/containers/../build', '/containers//qaap-ws-abc/start', '/containers/./create']) {
        it(`rejects ${target}`, async () => {
            const res = await request('POST', target);
            assert.equal(res.status, 400);
            assert.equal(upstreamRequests.length, 0);
        });
    }
    it('normalises the version prefix and still refuses unlisted endpoints', async () => {
        assert.equal((await request('POST', '/v1.47/containers/qaap-ws-abc/start')).status, 201);
        for (const target of ['/v1.47/build', '/v1.47/containers/qaap-ws-abc/update', '/containers/qaap-ws-abc/archive', '/commit', '/plugins/pull', '/swarm/init', '/session', '/grpc', '/images/load']) {
            assert.equal((await request('POST', target)).status, 403, target);
        }
        for (const target of ['/events', '/system/df', '/secrets', '/configs']) {
            assert.equal((await request('GET', target)).status, 403, target);
        }
        assert.equal((await request('PUT', '/containers/qaap-ws-abc/archive?path=/')).status, 403);
    });
});

describe('ownership of existing resources', () => {
    it('allows lifecycle calls on Qaap containers only', async () => {
        for (const action of ['start', 'stop', 'kill', 'wait', 'pause', 'unpause']) {
            assert.equal((await request('POST', `/containers/qaap-ws-abc/${action}`)).status, 201, action);
            assert.equal((await request('POST', `/containers/caddy/${action}`)).status, 403, action);
        }
        assert.equal((await request('DELETE', '/containers/foreign?force=1')).status, 403);
        assert.equal((await request('GET', '/containers/foreign/logs')).status, 403);
        assert.equal((await request('DELETE', '/containers/qaap-ws-abc?force=1')).status, 201);
    });
    it('relays the daemon 404 for a missing container so callers still see not-found', async () => {
        const res = await request('GET', '/containers/qaap-ws-missing/json');
        assert.equal(res.status, 404);
        assert.match(res.body, /No such container/);
    });
    it('strips daemon host paths from a container inspect but keeps Env and HostConfig', async () => {
        const res = await request('GET', '/containers/qaap-ws-abc/json');
        assert.equal(res.status, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.GraphDriver, undefined);
        assert.equal(body.LogPath, undefined);
        assert.equal(body.ResolvConfPath, undefined);
        assert.deepEqual(body.Config.Env, ['QAAP_BUILD_SHA=abc', 'SECRET=s']);
        assert.equal(body.HostConfig.Runtime, 'runsc');
        assert.equal(res.headers['x-qaap-tenant-proxy'], '1');
    });
    it('allows rename only to a Qaap name', async () => {
        assert.equal((await request('POST', '/containers/qaap-ws-abc/rename?name=qaap-ws-abc-archived-1')).status, 201);
        assert.equal((await request('POST', '/containers/qaap-ws-abc/rename?name=caddy')).status, 403);
    });
});

describe('exec', () => {
    const cliExec = { User: '0:0', Privileged: false, Tty: false, ConsoleSize: null, AttachStdin: true, AttachStderr: true, AttachStdout: true,
        Detach: false, DetachKeys: '', Env: null, WorkingDir: '/workspace', Cmd: ['bash', '-lc', 'ls'] };
    it('forwards the docker CLI exec body (hosted uid 0:0) without Privileged', async () => {
        const res = await request('POST', '/containers/qaap-ws-abc/exec', cliExec);
        assert.equal(res.status, 201, res.body);
        const forwarded = JSON.parse(lastForwarded('POST', /\/exec$/).body);
        assert.equal('Privileged' in forwarded, false);
        assert.equal(forwarded.User, '0:0');
    });
    it('refuses privileged exec in any spelling', async () => {
        assert.equal((await request('POST', '/containers/qaap-ws-abc/exec', { ...cliExec, Privileged: true })).status, 403);
        const { Privileged, ...rest } = cliExec;
        assert.equal((await request('POST', '/containers/qaap-ws-abc/exec', { ...rest, privileged: true })).status, 403);
        assert.equal((await request('POST', '/containers/qaap-ws-abc/exec', undefined, { rawBody: '{"Cmd":["id"],"cmd":["sh"]}' })).status, 400);
        assert.equal((await request('POST', '/containers/qaap-ws-abc/exec', undefined, { rawBody: '{"Cmd":["id"],"Privileged":false,"Privileged":true}' })).status, 400);
        assert.equal(lastForwarded('POST', /\/exec$/), undefined);
    });
    it('refuses exec on a container that is not Qaap and relays 404 for a missing one', async () => {
        assert.equal((await request('POST', '/containers/caddy/exec', cliExec)).status, 403);
        assert.equal((await request('POST', '/containers/qaap-ws-missing/exec', cliExec)).status, 404);
        assert.equal((await request('GET', '/exec/exec-foreign/json')).status, 403);
        assert.equal((await request('GET', '/exec/exec-owned/json')).status, 200);
    });
});

describe('hijacked endpoints', () => {
    const execStart = (id, extra = '') => {
        const body = '{"Detach":false,"Tty":false}';
        return `POST /v1.47/exec/${id}/start HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n`
            + `Content-Length: ${body.length}\r\n\r\n${body}${extra}`;
    };
    const smuggledRequest = 'POST /containers/create HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}';

    it('upgrades attach on a Qaap container and streams both ways after the 101', async () => {
        const { received } = await rawExchange([
            'POST /containers/qaap-ws-abc/attach?stream=1&stdin=1 HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n',
            200, 'hello'
        ]);
        assert.match(received, /^HTTP\/1\.1 101/);
        assert.match(received, /X-Qaap-Tenant-Proxy: 1/);
        assert.match(received, /echo:hello/);
        const upgrade = upstreamRequests.find(entry => entry.upgrade);
        assert.equal(upgrade.head, '');
    });

    it('sends only the canonical exec start body before the 101; pipelined bytes wait for the upgrade', async () => {
        const { received } = await rawExchange([execStart('exec-owned', smuggledRequest)]);
        assert.match(received, /^HTTP\/1\.1 101/);
        const upgrade = upstreamRequests.find(entry => entry.upgrade);
        assert.equal(upgrade.head, '{"Detach":false,"Tty":false}');
        // The pipelined bytes reached the daemon only as stream data after the 101 (echoed back).
        assert.match(received, /echo:POST \/containers\/create/);
        assert.equal(lastForwarded('POST', /containers\/create/), undefined);
    });

    it('relays a non-101 answer with Connection: close and never forwards a second request', async () => {
        const { received, closed } = await rawExchange([execStart('exec-stopped', smuggledRequest), 200, smuggledRequest], { waitMs: 800 });
        assert.match(received, /^HTTP\/1\.1 409/);
        assert.match(received, /Connection: close/i);
        assert.match(received, /container is not running/);
        assert.equal(closed, true);
        assert.deepEqual(smuggled, []);
        const upgrade = upstreamRequests.find(entry => entry.upgrade);
        assert.equal(upgrade.head, '{"Detach":false,"Tty":false}');
    });

    it('refuses upgrades on other routes, chunked upgrades, and exec start for foreign containers', async () => {
        const createUpgrade = await rawExchange([`POST /containers/create HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 2\r\n\r\n{}`]);
        assert.match(createUpgrade.received, /^HTTP\/1\.1 403/);
        const chunked = await rawExchange([`POST /exec/exec-owned/start HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`]);
        assert.match(chunked.received, /^HTTP\/1\.1 400/);
        const foreign = await rawExchange([execStart('exec-foreign')]);
        assert.match(foreign.received, /^HTTP\/1\.1 403/);
        const privileged = await rawExchange([`POST /exec/exec-owned/start HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 26\r\n\r\n{"Detach":false,"Tty":0x1}`]);
        assert.match(privileged.received, /^HTTP\/1\.1 400/);
        assert.equal(upstreamRequests.filter(entry => entry.upgrade).length, 0);
    });

    it('does not forward a forbidden request pipelined behind an allowed one', async () => {
        await rawExchange(['GET /_ping HTTP/1.1\r\nHost: docker\r\n\r\nPOST /build HTTP/1.1\r\nHost: docker\r\nContent-Length: 0\r\n\r\n']);
        assert.equal(lastForwarded('POST', /build/), undefined);
    });
});

describe('networks', () => {
    const tenantNetwork = { Name: 'qaap-net-v3-abc', Driver: 'bridge', Internal: true, CheckDuplicate: true,
        Labels: { ...MANAGED, 'com.qaap.tenant-network': 'true' }, Options: { 'com.docker.network.bridge.enable_icc': 'true' } };
    const egressNetwork = { Name: 'qaap-egress-v1-abc', Driver: 'bridge', Internal: false, CheckDuplicate: true,
        Labels: { ...MANAGED, 'com.qaap.tenant-egress-network': 'true' }, Options: { 'com.docker.network.bridge.enable_icc': 'false' } };
    it('creates the orchestrator networks', async () => {
        assert.equal((await request('POST', '/networks/create', tenantNetwork)).status, 201);
        assert.equal((await request('POST', '/networks/create', egressNetwork)).status, 201);
        assert.equal((await request('POST', '/networks/create', { ...egressNetwork, IPAM: { Driver: 'default', Config: [], Options: {} } })).status, 201);
    });
    for (const [label, body] of [
        ['bridge name of a host bridge', { ...egressNetwork, Options: { 'com.docker.network.bridge.name': 'docker0' } }],
        ['routed gateway mode', { ...egressNetwork, Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'routed' } }],
        ['enable_icc true on a non-internal network', { ...egressNetwork, Options: { 'com.docker.network.bridge.enable_icc': 'true' } }],
        ['IPAM subnet', { ...egressNetwork, IPAM: { Driver: 'default', Config: [{ Subnet: '172.17.0.0/16' }] } }],
        ['IPAM driver', { ...egressNetwork, IPAM: { Driver: 'evil' } }],
        ['Attachable', { ...egressNetwork, Attachable: true }],
        ['Ingress', { ...egressNetwork, Ingress: true }],
        ['ConfigFrom', { ...egressNetwork, ConfigFrom: { Network: 'x' } }],
        ['Scope', { ...egressNetwork, Scope: 'swarm' }],
        ['macvlan driver', { ...egressNetwork, Driver: 'macvlan' }],
        ['non-Qaap name', { ...egressNetwork, Name: 'evil' }],
        ['missing labels', { ...egressNetwork, Labels: {} }]
    ]) {
        it(`refuses ${label}`, async () => {
            assert.equal((await request('POST', '/networks/create', body)).status, 403);
            assert.equal(lastForwarded('POST', /networks\/create/), undefined);
        });
    }
    it('connects only Qaap containers to Qaap networks', async () => {
        assert.equal((await request('POST', '/networks/qaap-net-v3-abc/connect', { Container: 'qaap-ws-abc', EndpointConfig: { Aliases: ['qaap-egress-proxy'] } })).status, 201);
        assert.equal((await request('POST', '/networks/foreign-net/connect', { Container: 'qaap-ws-abc' })).status, 403);
        assert.equal((await request('POST', '/networks/qaap-net-v3-abc/connect', { Container: 'caddy' })).status, 403);
        assert.equal((await request('POST', '/networks/qaap-net-v3-abc/connect', { Container: 'qaap-ws-abc', EndpointConfig: { IPAMConfig: { IPv4Address: '10.0.0.9' } } })).status, 403);
        assert.equal((await request('POST', '/networks/qaap-net-v3-abc/disconnect', { Container: 'qaap-ws-abc', Force: true })).status, 201);
        assert.equal((await request('DELETE', '/networks/foreign-net')).status, 403);
        assert.equal((await request('DELETE', '/networks/qaap-net-v3-abc')).status, 201);
    });
});

describe('volumes', () => {
    const toolchain = { Name: 'qaap-agent-toolchain-0123456789ab', Labels: { ...MANAGED, 'com.qaap.agent-toolchain': 'true' } };
    it('creates the broker toolchain volume with the local driver', async () => {
        assert.equal((await request('POST', '/volumes/create', toolchain)).status, 201);
        assert.equal(JSON.parse(lastForwarded('POST', /volumes\/create/).body).Driver, 'local');
        assert.equal((await request('POST', '/volumes/create', { ...toolchain, Driver: 'local', DriverOpts: {} })).status, 201);
    });
    it('refuses bind-backed or foreign volumes and volume removal', async () => {
        assert.equal((await request('POST', '/volumes/create', { ...toolchain, DriverOpts: { type: 'none', o: 'bind', device: '/' } })).status, 403);
        assert.equal((await request('POST', '/volumes/create', { ...toolchain, Driver: 'rclone' })).status, 403);
        assert.equal((await request('POST', '/volumes/create', { ...toolchain, Name: 'evil' })).status, 403);
        assert.equal((await request('DELETE', '/volumes/qaap-agent-toolchain-0123456789ab')).status, 403);
        assert.equal((await request('GET', '/volumes/evil')).status, 403);
        assert.equal(lastForwarded('POST', /volumes\/create/)?.body?.includes('device'), undefined);
    });
});

describe('images', () => {
    it('allows pulls from the allowed registries only', async () => {
        assert.equal((await request('POST', '/images/create?fromImage=ghcr.io/example/qaap-theia&tag=v1')).status, 201);
        assert.equal((await request('POST', '/images/create?fromImage=busybox')).status, 403);
        assert.equal((await request('POST', '/images/create?fromImage=evil.io/x')).status, 403);
        assert.equal((await request('POST', '/images/create?fromSrc=-&repo=ghcr.io/x')).status, 403);
        assert.equal((await request('GET', '/images/ghcr.io/example/qaap-theia:v1/json')).status, 201);
    });
    it('parses registry hosts', () => {
        assert.equal(registryOf('ghcr.io/a/b:c'), 'ghcr.io');
        assert.equal(registryOf('busybox'), 'docker.io');
        assert.equal(registryOf('localhost/x'), 'localhost');
    });
});

describe('configuration', () => {
    it('defaults to the dedicated proxy runtime directory and validates the namespace', () => {
        const cfg = loadConfig({});
        assert.equal(cfg.listenPath, '/run/docker-tenants-proxy/proxy.sock');
        assert.equal(cfg.dataRoot, '/opt/qaap-runtime');
        assert.deepEqual(cfg.publishHostIps, ['127.0.0.1']);
        assert.throws(() => loadConfig({ QAAP_DOCKER_NAMESPACE: 'Bad-NS' }), /QAAP_DOCKER_NAMESPACE/);
        assert.throws(() => loadConfig({ QAAP_TENANT_BIND_TEMPLATES: '../{tenant}' }), /invalid bind template/);
    });
});
