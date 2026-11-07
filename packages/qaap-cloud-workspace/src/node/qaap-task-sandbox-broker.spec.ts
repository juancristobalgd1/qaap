// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import express = require('@theia/core/shared/express');
import type { QaapDockerOrchestrator, QaapTaskSandboxPlacement, QaapTenantBackendTarget } from './qaap-docker-orchestrator';
import { QaapTaskSandbox, QaapTaskSandboxService } from './qaap-task-sandbox';
import { QaapTaskSandboxBroker } from './qaap-task-sandbox-broker';
import { QaapTaskSandboxBrokerClient } from './qaap-task-sandbox-broker-client';
import { QaapTaskSandboxBrokerAuth, type QaapTaskSandboxBrokerCreateArgs, type QaapTaskSandboxBrokerSandbox } from './qaap-task-sandbox-broker-protocol';
import { encodeQaapSandboxFrame, parseQaapListeningPorts, QaapSandboxFrame, QaapSandboxFrameDecoder } from './qaap-task-sandbox-exec-protocol';
import { QaapTenantRuntimeMetrics } from './qaap-tenant-runtime-metrics';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

const SECRET = 'a'.repeat(64);
const TOKEN = crypto.randomBytes(32).toString('base64url');

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
        });
    });
}

async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, timeoutMs = 5_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value !== undefined && value !== false) {
            return value as T;
        }
        if (Date.now() > deadline) {
            throw new Error('timed out');
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** One request/answer line to an exec server (`ports`, `ping`) or an unauthorized probe. */
function queryLine(port: number, request: object): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(`${JSON.stringify(request)}\n`));
        let text = '';
        socket.on('data', chunk => text += chunk.toString());
        socket.on('close', () => resolve(text.trim()));
        socket.on('error', reject);
    });
}

describe('task sandbox exec protocol', () => {
    it('round-trips frames split across arbitrary chunk boundaries', () => {
        const wire = Buffer.concat([
            encodeQaapSandboxFrame(QaapSandboxFrame.Stdout, 'hello'),
            encodeQaapSandboxFrame(QaapSandboxFrame.StdinEnd),
            encodeQaapSandboxFrame(QaapSandboxFrame.Exit, '{"code":3}'),
        ]);
        const decoder = new QaapSandboxFrameDecoder();
        const frames = [];
        for (let offset = 0; offset < wire.length; offset += 3) {
            frames.push(...decoder.push(wire.subarray(offset, offset + 3)));
        }
        expect(frames.map(frame => [frame.type, frame.payload.toString()])).to.deep.equal([
            [QaapSandboxFrame.Stdout, 'hello'], [QaapSandboxFrame.StdinEnd, ''], [QaapSandboxFrame.Exit, '{"code":3}'],
        ]);
    });

    it('reads listening ports from /proc/net/tcp and tcp6 text, skipping Docker\'s embedded DNS', () => {
        const text = [
            '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
            '   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 1 1',
            '   1: 0100007F:1435 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1001        0 2 1',
            '   2: 0B00007F:8B4F 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 9 1', // Docker DNS
            '   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 1001 0 3 1',
        ].join('\n');
        expect(parseQaapListeningPorts(text)).to.deep.equal([5173, 8080]);
    });
});

describe('task sandbox broker auth', () => {
    it('accepts only fresh requests signed for this tenant, op and arguments', () => {
        const request = QaapTaskSandboxBrokerAuth.signRequest('Alice', SECRET, 'id1', 'create', { root: '/tmp/qaap-worktrees/alice/a' }, 1_000_000);
        expect(QaapTaskSandboxBrokerAuth.verifyRequest(request, 'alice', SECRET, 1_000_500)).to.equal(true);
        expect(QaapTaskSandboxBrokerAuth.verifyRequest(request, 'bob', SECRET, 1_000_500)).to.equal(false);
        expect(QaapTaskSandboxBrokerAuth.verifyRequest({ ...request, args: { root: '/tmp/qaap-worktrees/bob/a' } }, 'alice', SECRET, 1_000_500)).to.equal(false);
        expect(QaapTaskSandboxBrokerAuth.verifyRequest({ ...request, op: 'destroy' }, 'alice', SECRET, 1_000_500)).to.equal(false);
        expect(QaapTaskSandboxBrokerAuth.verifyRequest(request, 'alice', 'b'.repeat(64), 1_000_500)).to.equal(false);
        expect(QaapTaskSandboxBrokerAuth.verifyRequest(request, 'alice', SECRET, 1_000_000 + 61_000)).to.equal(false);
        expect(QaapTaskSandboxBrokerAuth.verifyRequest('garbage', 'alice', SECRET)).to.equal(false);
    });

    it('binds the link probe to the tenant and the secret', () => {
        const probe = QaapTaskSandboxBrokerAuth.createLinkProbe('alice', SECRET);
        expect(QaapTaskSandboxBrokerAuth.verifyLinkProbe(probe, SECRET, 'Alice')).to.equal(true);
        expect(QaapTaskSandboxBrokerAuth.verifyLinkProbe(probe, SECRET, 'bob')).to.equal(false);
        expect(QaapTaskSandboxBrokerAuth.verifyLinkProbe(probe, 'short', 'alice')).to.equal(false);
        expect(() => QaapTaskSandboxBrokerAuth.createLinkProbe('alice', 'short')).to.throw();
    });
});

describe('task sandbox exec server and local client (real processes)', function (): void {
    this.timeout(20_000);
    if (process.platform === 'win32') {
        return;
    }
    let server: ChildProcess;
    let port: number;
    let home: string;
    let work: string;

    before(async () => {
        port = await freePort();
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-exec-home-'));
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-exec-work-'));
        server = spawn(process.execPath, [path.join(__dirname, 'qaap-task-sandbox-exec-server.js')], {
            env: {
                PATH: process.env.PATH, HOME: home,
                QAAP_SANDBOX_EXEC_PORT: String(port),
                QAAP_SANDBOX_HOME_LINKS: JSON.stringify([{ name: '.claude', target: '/home/theia/.qaap/agent/.claude' }, { name: '../evil', target: '/' }]),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        server.stdin!.end(`${TOKEN}\n`);
        let stdout = '';
        server.stdout!.on('data', chunk => stdout += chunk);
        await waitFor(() => stdout.includes('QAAP_SANDBOX_EXEC_READY'));
    });

    after(() => {
        server.kill();
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    });

    const runClient = (file: string, args: string[], env: Record<string, string> = {}): { child: ChildProcess; requestFile: string; output: () => string } => {
        const requestFile = path.join(work, `req-${crypto.randomBytes(4).toString('hex')}.json`);
        fs.writeFileSync(requestFile, JSON.stringify({ host: '127.0.0.1', port, token: TOKEN, file, args, cwd: work, env }), { mode: 0o600 });
        const child = spawn(process.execPath, [path.join(__dirname, 'qaap-task-sandbox-exec-client-main.js'), requestFile], {
            env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
        });
        let output = '';
        child.stdout!.on('data', chunk => output += chunk);
        child.stderr!.on('data', chunk => output += chunk);
        return { child, requestFile, output: () => output };
    };

    const exited = (child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
        new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));

    it('rejects a request without the sandbox token', async () => {
        expect(await queryLine(port, { token: 'x'.repeat(43), op: 'ping' })).to.contain('unauthorized');
        expect(await queryLine(port, { token: TOKEN, op: 'ping' })).to.equal('{"ok":true}');
    });

    it('streams stdin/stdout/stderr, the env and the exit code, and deletes the request file', async () => {
        const run = runClient('/bin/sh', ['-c', 'read line; echo "out:$line:$TASK_VALUE:$(pwd)"; echo err >&2; exit 7'], { TASK_VALUE: 'v1' });
        run.child.stdin!.end('hello\n');
        const result = await exited(run.child);
        expect(result.code).to.equal(7);
        expect(run.output()).to.contain(`out:hello:v1:${fs.realpathSync(work)}`).and.to.contain('err');
        expect(fs.existsSync(run.requestFile)).to.equal(false);
    });

    it('takes its token only from stdin: a token in the environment is not enough to start', async () => {
        const envOnly = spawn(process.execPath, [path.join(__dirname, 'qaap-task-sandbox-exec-server.js')], {
            env: { PATH: process.env.PATH, HOME: home, QAAP_SANDBOX_EXEC_TOKEN: TOKEN, QAAP_SANDBOX_EXEC_PORT: String(await freePort()) },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        envOnly.stdin!.end();
        let stderr = '';
        envOnly.stderr!.on('data', chunk => stderr += chunk);
        const code = await new Promise(resolve => envOnly.on('exit', resolve));
        expect(code).to.equal(2);
        expect(stderr).to.contain('without a token on stdin');
    });

    it('finds its token behind the attach body that docker can leak onto stdin', async () => {
        const leakedPort = await freePort();
        const leaked = spawn(process.execPath, [path.join(__dirname, 'qaap-task-sandbox-exec-server.js')], {
            env: { PATH: process.env.PATH, HOME: home, QAAP_SANDBOX_EXEC_PORT: String(leakedPort) },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        try {
            // What a container read under load: docker-modem's JSON attach body, then the token line.
            leaked.stdin!.end(`{"stream":true,"stdin":true,"hijack":true}${TOKEN}\n`);
            let stdout = '';
            leaked.stdout!.on('data', chunk => stdout += chunk);
            await waitFor(() => stdout.includes('QAAP_SANDBOX_EXEC_READY'));
            expect(await queryLine(leakedPort, { token: TOKEN, op: 'ping' })).to.equal('{"ok":true}');
        } finally {
            leaked.kill();
        }
    });

    it('never passes the token to the commands it runs', async () => {
        const run = runClient('/bin/sh', ['-c', 'echo "token=[${QAAP_SANDBOX_EXEC_TOKEN:-}]"']);
        run.child.stdin!.end();
        await exited(run.child);
        expect(run.output()).to.contain('token=[]');
    });

    it('SIGTERM to the client ends the remote process group and the client dies by that signal', async () => {
        const pidFile = path.join(work, 'term.pid');
        const run = runClient('/bin/sh', ['-c', `sleep 30 & echo $! > ${pidFile}; wait`]);
        const remote = Number(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() || undefined));
        expect(alive(remote)).to.equal(true);
        process.kill(-run.child.pid!, 'SIGTERM');
        const result = await exited(run.child);
        expect(result.signal).to.equal('SIGTERM');
        await waitFor(() => !alive(remote) || undefined);
    });

    it('a SIGKILLed client still takes the remote tree down (dead socket)', async () => {
        const pidFile = path.join(work, 'kill.pid');
        const run = runClient('/bin/sh', ['-c', `sleep 30 & echo $! > ${pidFile}; wait`]);
        const remote = Number(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() || undefined));
        run.child.kill('SIGKILL');
        await exited(run.child);
        await waitFor(() => !alive(remote) || undefined, 8_000);
    });

    it('bridges a connect request to the sandbox loopback port (preview channel)', async () => {
        const app = http.createServer((_req, res) => res.end('from-sandbox'));
        await new Promise<void>(resolve => app.listen(0, '127.0.0.1', () => resolve()));
        const appPort = (app.address() as net.AddressInfo).port;
        try {
            const socket = net.connect(port, '127.0.0.1');
            socket.write(`${JSON.stringify({ token: TOKEN, op: 'connect', port: appPort })}\nGET / HTTP/1.0\r\n\r\n`);
            let text = '';
            socket.on('data', chunk => text += chunk.toString());
            await new Promise(resolve => socket.on('close', resolve));
            expect(text.startsWith('{"ok":true}\n')).to.equal(true);
            expect(text).to.contain('from-sandbox');
        } finally {
            app.close();
        }
    });

    it('recreates only well-formed HOME links', () => {
        expect(fs.readlinkSync(path.join(home, '.claude'))).to.equal('/home/theia/.qaap/agent/.claude');
        expect(fs.existsSync(path.join(path.dirname(home), 'evil'))).to.equal(false);
    });

    it('stays compatible with the shared frame codec', async () => {
        const socket = net.connect(port, '127.0.0.1');
        socket.write(`${JSON.stringify({ token: TOKEN, op: 'exec', file: '/bin/cat', args: [], cwd: work, env: {} })}\n`);
        socket.write(encodeQaapSandboxFrame(QaapSandboxFrame.Stdin, 'ping'));
        socket.write(encodeQaapSandboxFrame(QaapSandboxFrame.StdinEnd));
        const decoder = new QaapSandboxFrameDecoder();
        const frames: Array<[number, string]> = [];
        socket.on('data', chunk => frames.push(...decoder.push(chunk).map(frame => [frame.type, frame.payload.toString()] as [number, string])));
        await new Promise(resolve => socket.on('close', resolve));
        expect(frames).to.deep.equal([[QaapSandboxFrame.Stdout, 'ping'], [QaapSandboxFrame.Exit, '{"code":0,"signal":null}']]);
    });
});

/** Minimal Dockerode double: records createContainer configs and answers inspect/list/logs. */
class FakeDocker {
    readonly created: Array<Record<string, unknown>> = [];
    readonly removed: string[] = [];
    readonly containers = new Map<string, { labels: Record<string, string>; env: string[]; running: boolean; image: string; networks: Record<string, string> }>();
    readonly volumes: Array<Record<string, unknown>> = [];
    readonly connected: string[] = [];
    readonly presentImages = new Set(['qaap-theia:test']);
    readonly stdinWrites = new Map<string, string>();
    readonly pulls: string[] = [];
    readonly pendingPulls: Array<(error?: Error) => void> = [];
    failImage: string | undefined;
    modem = { followProgress: (_stream: unknown, done: (error: Error | null) => void) => done(null) };

    createContainer(config: { name?: string; Image: string; Labels?: Record<string, string>; Env?: string[]; HostConfig?: { NetworkMode?: string } }): unknown {
        this.created.push(config as unknown as Record<string, unknown>);
        const name = config.name ?? `helper-${this.created.length}`;
        const networks: Record<string, string> = config.HostConfig?.NetworkMode ? { [config.HostConfig.NetworkMode]: `172.24.0.${this.created.length + 1}` } : {};
        this.containers.set(name, { labels: config.Labels ?? {}, env: config.Env ?? [], running: false, image: config.Image, networks });
        return this.getContainer(name);
    }

    getContainer(name: string): unknown {
        const containers = this.containers;
        const removed = this.removed;
        const stdinWrites = this.stdinWrites;
        const failImage = (): string | undefined => this.failImage;
        return {
            attach: async () => ({
                end: (chunk: string, callback: () => void) => {
                    stdinWrites.set(name, chunk);
                    callback();
                },
            }),
            start: async () => {
                const container = containers.get(name)!;
                container.running = container.image !== failImage();
            },
            wait: async () => ({ StatusCode: 0 }),
            logs: async () => Buffer.from(containers.get(name)?.running ? 'QAAP_SANDBOX_EXEC_READY\n' : 'node: not found\n'),
            remove: async () => {
                containers.delete(name);
                removed.push(name);
            },
            stop: async () => {
                containers.get(name)!.running = false;
            },
            rename: async ({ name: next }: { name: string }) => {
                containers.set(next, containers.get(name)!);
                containers.delete(name);
            },
            inspect: async () => {
                const container = containers.get(name);
                if (!container) {
                    throw Object.assign(new Error('no such container'), { statusCode: 404 });
                }
                return {
                    Config: { Labels: container.labels, Env: container.env, Image: container.image },
                    State: { Running: container.running, ExitCode: 127 },
                    NetworkSettings: { Networks: Object.fromEntries(Object.entries(container.networks).map(([network, IPAddress]) => [network, { IPAddress }])) },
                };
            },
        };
    }

    async listContainers(options: { filters?: { label?: string[] } }): Promise<unknown[]> {
        const wanted = options.filters?.label ?? [];
        return [...this.containers.entries()]
            .filter(([, container]) => wanted.every(label => {
                const [key, value] = label.split('=');
                return container.labels[key] === value;
            }))
            .map(([name, container]) => ({ Names: [`/${name}`], Labels: container.labels, State: container.running ? 'running' : 'exited' }));
    }

    getImage(image: string): unknown {
        return {
            inspect: async () => {
                if (!this.presentImages.has(image)) {
                    throw Object.assign(new Error('no such image'), { statusCode: 404 });
                }
                return { Id: `sha256:${image}` };
            },
        };
    }

    async createVolume(config: Record<string, unknown>): Promise<void> {
        this.volumes.push(config);
    }

    getNetwork(network: string): unknown {
        return {
            connect: async ({ Container }: { Container: string }) => {
                this.connected.push(`${network}:${Container}`);
                const container = this.containers.get(Container);
                if (container) {
                    container.networks[network] = `172.25.0.${this.connected.length + 1}`;
                }
            },
        };
    }

    pull(image: string, callback: (error: Error | undefined, stream?: unknown) => void): void {
        this.pulls.push(image);
        // Stays in progress until the spec settles it.
        this.pendingPulls.push(error => callback(error, {}));
    }
}

describe('QaapTaskSandboxBroker (control plane)', () => {
    let hostRoot: string;
    let docker: FakeDocker;
    let broker: QaapTaskSandboxBroker;

    const placementFor = (tenant: string): QaapTaskSandboxPlacement => ({
        docker: docker as unknown as QaapTaskSandboxPlacement['docker'],
        image: 'qaap-theia:test',
        user: '1001:1001',
        network: `qaap-tenant-net-${tenant}`,
        directEgressNetwork: `qaap-tenant-egress-${tenant}`,
        egressEnv: {},
        roots: [
            { kind: 'repos', backendPath: `/workspace/repos/users/${tenant}`, hostPath: path.join(hostRoot, 'repos', tenant), source: `/node/repos/${tenant}` },
            { kind: 'worktrees', backendPath: `/tmp/qaap-worktrees/${tenant}`, hostPath: path.join(hostRoot, 'worktrees', tenant), source: `/node/worktrees/${tenant}` },
            { kind: 'parallel', backendPath: `/tmp/qaap-parallel/${tenant}`, hostPath: path.join(hostRoot, 'parallel', tenant), source: `/node/parallel/${tenant}` },
            { kind: 'tenant-config', backendPath: '/home/theia/.qaap', hostPath: path.join(hostRoot, 'config', tenant), source: `/node/config/${tenant}` },
        ],
    });

    beforeEach(() => {
        hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-broker-'));
        for (const tenant of ['alice', 'bob']) {
            fs.mkdirSync(path.join(hostRoot, 'worktrees', tenant, 'repo-1'), { recursive: true });
            fs.mkdirSync(path.join(hostRoot, 'repos', tenant, 'repo'), { recursive: true });
        }
        fs.symlinkSync('/etc', path.join(hostRoot, 'worktrees', 'alice', 'escape'));
        docker = new FakeDocker();
        // The tenant backend sits on the tenant network and on the direct-egress network.
        docker.containers.set('qaap-backend-alice', {
            labels: {}, env: [], running: true, image: 'qaap-theia:test',
            networks: { 'qaap-tenant-net-alice': '172.24.0.50', 'qaap-tenant-egress-alice': '172.25.0.50' },
        });
        broker = new QaapTaskSandboxBroker();
        const orchestrator = {
            taskSandboxPlacement: async (tenant: string) => placementFor(tenant),
            getTenantBackendTarget: (tenant: string) => tenant === 'alice'
                ? { containerId: 'qaap-backend-alice', containerName: 'qaap-backend-alice', host: '127.0.0.1', port: 4873, tenantLogin: 'alice' }
                : undefined,
            isBackendPerTenantEnabled: () => true,
            getTenantBackendAssertionSecret: () => SECRET,
            getTenantBackendConnectionToken: () => undefined,
            listTenantBackendTargets: () => [],
            listTaskSandboxContainers: async () => [...docker.containers.entries()]
                .filter(([, container]) => container.labels['com.qaap.task-sandbox.broker'] === 'true')
                .map(([name, container]) => ({ tenantLogin: container.labels['com.qaap.tenant-login'], name, running: container.running })),
        };
        (broker as unknown as { orchestrator: unknown }).orchestrator = orchestrator;
        (broker as unknown as { execServerSource: () => string }).execServerSource = () => '/* server */';
    });

    afterEach(() => fs.rmSync(hostRoot, { recursive: true, force: true }));

    it('accepts only normalized roots strictly inside the calling tenant\'s own trees', () => {
        const placement = placementFor('alice');
        expect(broker.validateRoot(placement, '/tmp/qaap-worktrees/alice/repo-1')).to.equal('/tmp/qaap-worktrees/alice/repo-1');
        expect(broker.validateRoot(placement, '/workspace/repos/users/alice/repo')).to.equal('/workspace/repos/users/alice/repo');
        for (const hostile of [
            '/tmp/qaap-worktrees/bob/repo-1', // another tenant
            '/tmp/qaap-worktrees/alice', // the tenant root itself
            '/tmp/qaap-worktrees/alice/../bob/repo-1',
            '/tmp/qaap-worktrees/alice/escape', // a symlink out of the tree
            '/tmp/qaap-worktrees/alice/missing',
            '/home/theia/.qaap/agent', // tenant storage is never a worktree
            '/var/run/docker.sock',
            'relative/path',
        ]) {
            expect(() => broker.validateRoot(placement, hostile), hostile).to.throw();
        }
    });

    it('creates a hardened sandbox on the tenant network that binds only the fixed tenant roots', async () => {
        const args: QaapTaskSandboxBrokerCreateArgs = {
            root: '/tmp/qaap-worktrees/alice/repo-1',
            homeLinks: [{ name: '.claude', target: '/home/theia/.qaap/agent/.claude' }, { name: '.x', target: '/var/run/docker.sock' }],
            devcontainer: { containerEnv: { APP_MODE: 'dev', PATH: '/evil', QAAP_SANDBOX_EXEC_TOKEN: 'mine', LD_PRELOAD: '/x.so' } },
        };
        const sandbox = await broker.create('alice', args);
        const config = docker.created.find(entry => entry.name === sandbox.name) as {
            User: string; Entrypoint: string[]; Env: string[]; Labels: Record<string, string>; WorkingDir: string;
            HostConfig: { Binds: string[]; CapDrop: string[]; SecurityOpt: string[]; NetworkMode: string; ReadonlyRootfs: boolean; Init: boolean; Privileged?: boolean; Memory: number };
        };
        // The exec server is reached on the INTERNAL network's address, never by name: Docker DNS may
        // answer with the direct-egress address, and that bridge drops container-to-container traffic.
        const internalAddress = docker.containers.get(sandbox.name)!.networks['qaap-tenant-net-alice'];
        expect(internalAddress).to.match(/^172\.24\./);
        expect(sandbox).to.include({ root: args.root, host: internalAddress, port: 7391, created: true, imageKind: 'base' });
        expect(sandbox.token).to.have.length.greaterThan(40);
        expect(config.User).to.equal('1001:1001');
        expect(config.WorkingDir).to.equal(args.root);
        expect(config.Entrypoint).to.deep.equal(['/opt/qaap-agent/current/bin/node', '/opt/qaap-agent/current/lib/qaap-task-sandbox-exec-server.js']);
        expect(config.HostConfig.Binds.slice(0, 4)).to.deep.equal([
            '/node/repos/alice:/workspace/repos/users/alice:rw',
            '/node/worktrees/alice:/tmp/qaap-worktrees/alice:rw',
            '/node/parallel/alice:/tmp/qaap-parallel/alice:rw',
            '/node/config/alice:/home/theia/.qaap:rw',
        ]);
        expect(config.HostConfig.Binds[4]).to.match(/qaap-agent-toolchain-[0-9a-f]{12}:\/opt\/qaap-agent:ro$/);
        expect(config.HostConfig.Binds).to.have.length(5);
        expect(config.HostConfig).to.include({ NetworkMode: 'qaap-tenant-net-alice', ReadonlyRootfs: true, Init: true });
        expect(config.HostConfig.CapDrop).to.deep.equal(['ALL']);
        expect(config.HostConfig.SecurityOpt).to.deep.equal(['no-new-privileges:true']);
        // Default sandbox memory fits a large monorepo build (a 4 GiB Node heap).
        expect(config.HostConfig.Memory).to.equal(4 * 1024 ** 3);
        expect(docker.connected).to.deep.equal([`qaap-tenant-egress-alice:${sandbox.name}`]);
        expect(config.Labels).to.include({ 'com.qaap.task-sandbox.broker': 'true', 'com.qaap.tenant-login': 'alice', 'com.qaap.task-sandbox.worktree': args.root });
        expect(config.Env).to.include('APP_MODE=dev');
        // The token never reaches Env (it would sit in /proc/<pid>/environ and docker inspect): it goes in on stdin.
        expect(config.Env.some(entry => entry.includes(sandbox.token) || entry.startsWith('QAAP_SANDBOX_EXEC_TOKEN'))).to.equal(false);
        expect(config).to.include({ OpenStdin: true, StdinOnce: true });
        expect(docker.stdinWrites.get(sandbox.name)).to.equal(`${sandbox.token}\n`);
        expect(config.Env.filter(entry => entry.startsWith('PATH='))).to.deep.equal(['PATH=/opt/qaap-agent/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']);
        expect(config.Env.some(entry => entry.startsWith('LD_PRELOAD'))).to.equal(false);
        expect(config.Env).to.include('QAAP_SANDBOX_HOME_LINKS=[{"name":".claude","target":"/home/theia/.qaap/agent/.claude"}]');
        // A second create for the same root reuses the running sandbox and its token.
        const again = await broker.create('alice', args);
        expect(again).to.include({ name: sandbox.name, token: sandbox.token, host: internalAddress, created: false });
        // A restarted control plane no longer knows the token: it recreates instead of guessing.
        const restarted = new QaapTaskSandboxBroker();
        (restarted as unknown as { orchestrator: unknown }).orchestrator = (broker as unknown as { orchestrator: unknown }).orchestrator;
        (restarted as unknown as { execServerSource: () => string }).execServerSource = () => '/* server */';
        const recreated = await restarted.create('alice', args);
        expect(recreated.created).to.equal(true);
        expect(recreated.token).to.not.equal(sandbox.token);
    });

    it('hands the sandbox the backend address on the tenant network, never the egress one', async () => {
        const sandbox = await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1' });
        expect(sandbox.backendHost).to.equal('172.24.0.50');
        // Reuse of a running sandbox still reports the current backend address.
        expect((await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1' })).backendHost).to.equal('172.24.0.50');
    });

    it('omits backendHost when the backend has no address on the tenant network, or is unknown', async () => {
        docker.containers.get('qaap-backend-alice')!.networks = { 'qaap-tenant-egress-alice': '172.25.0.50' };
        expect((await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1' })).backendHost).to.equal(undefined);
        expect((await broker.create('bob', { root: '/tmp/qaap-worktrees/bob/repo-1' })).backendHost).to.equal(undefined);
    });

    it('returns the internal-network address of the exec server, and the name only without an egress network', async () => {
        const root = '/tmp/qaap-worktrees/alice/repo-1';
        const name = broker.containerName('alice', root);
        const placement = placementFor('alice');
        const describe = (inspect: unknown, withEgress: boolean): string => (broker as unknown as {
            execServerHost(name: string, placement: QaapTaskSandboxPlacement, inspect: unknown): string;
        }).execServerHost(name, withEgress ? placement : { ...placement, directEgressNetwork: undefined }, inspect);
        const networks = { 'qaap-tenant-egress-alice': { IPAddress: '172.25.0.3' }, 'qaap-tenant-net-alice': { IPAddress: '172.24.0.4' } };
        expect(describe({ NetworkSettings: { Networks: networks } }, true)).to.equal('172.24.0.4');
        expect(() => describe({ NetworkSettings: { Networks: { 'qaap-tenant-egress-alice': networks['qaap-tenant-egress-alice'] } } }, true))
            .to.throw(/no address on the tenant network/);
        // Only one network: its DNS name can resolve to nothing else.
        expect(describe({ NetworkSettings: { Networks: {} } }, false)).to.equal(name);
    });

    it('pulls a missing devcontainer image only when allowlisted, and caps pulls per tenant', async () => {
        const saved = { ...process.env };
        try {
            await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1', devcontainer: { image: 'evil.example/huge:1' } });
            expect(docker.pulls).to.deep.equal([]); // empty allowlist: never pull
            process.env.QAAP_TASK_SANDBOX_PULL_ALLOWLIST = 'mcr.microsoft.com/devcontainers/';
            process.env.QAAP_TASK_SANDBOX_PULLS_PER_DAY = '2';
            for (const name of ['repo-2', 'repo-3', 'repo-4']) {
                fs.mkdirSync(path.join(hostRoot, 'worktrees', 'alice', name));
            }
            await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-2', devcontainer: { image: 'evil.example/huge:1' } });
            await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-3', devcontainer: { image: 'mcr.microsoft.com/devcontainers/base:1' } });
            // One pull per tenant at a time: a second image waits for the first to finish.
            await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-4', devcontainer: { image: 'mcr.microsoft.com/devcontainers/node:1' } });
            expect(docker.pulls).to.deep.equal(['mcr.microsoft.com/devcontainers/base:1']);
            docker.pendingPulls.shift()!();
            await new Promise(resolve => setTimeout(resolve, 10));
            await broker.destroy('alice', { name: broker.containerName('alice', '/tmp/qaap-worktrees/alice/repo-4') });
            await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-4', devcontainer: { image: 'mcr.microsoft.com/devcontainers/node:1' } });
            docker.pendingPulls.shift()!();
            await new Promise(resolve => setTimeout(resolve, 10));
            // The daily cap (2) is reached.
            await broker.destroy('alice', { name: broker.containerName('alice', '/tmp/qaap-worktrees/alice/repo-4') });
            await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-4', devcontainer: { image: 'mcr.microsoft.com/devcontainers/go:1' } });
            expect(docker.pulls).to.deep.equal(['mcr.microsoft.com/devcontainers/base:1', 'mcr.microsoft.com/devcontainers/node:1']);
        } finally {
            process.env = saved;
        }
    });

    it('serializes creates per tenant and counts sandboxes in every state against the cap', async () => {
        process.env.QAAP_TASK_SANDBOX_MAX_PER_TENANT = '1';
        try {
            fs.mkdirSync(path.join(hostRoot, 'worktrees', 'alice', 'repo-2'));
            fs.mkdirSync(path.join(hostRoot, 'worktrees', 'alice', 'repo-3'));
            const results = await Promise.allSettled([
                broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1' }),
                broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-2' }),
            ]);
            expect(results.map(result => result.status).sort()).to.deep.equal(['fulfilled', 'rejected']);
            const winner = (results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<QaapTaskSandboxBrokerSandbox>).value;
            docker.containers.get(winner.name)!.running = false; // a stopped sandbox still counts
            await expectRejection(broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-3' }), /limit 1/);
        } finally {
            delete process.env.QAAP_TASK_SANDBOX_MAX_PER_TENANT;
        }
    });

    it('keeps a bounded number of archives and the sweep removes expired ones', async () => {
        process.env.QAAP_TASK_SANDBOX_MAX_ARCHIVES_PER_TENANT = '1';
        try {
            fs.mkdirSync(path.join(hostRoot, 'worktrees', 'alice', 'repo-2'));
            const first = await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1' });
            await broker.destroy('alice', { name: first.name, mode: 'archive' });
            await new Promise(resolve => setTimeout(resolve, 5));
            const second = await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-2' });
            await broker.destroy('alice', { name: second.name, mode: 'archive' });
            const archives = (await broker.list('alice')).filter(entry => entry.archived);
            expect(archives).to.have.length(1);
            expect(archives[0].name.startsWith(second.name)).to.equal(true);
            await broker.sweep(Date.now() + 25 * 60 * 60_000);
            expect(await broker.list('alice')).to.deep.equal([]);
        } finally {
            delete process.env.QAAP_TASK_SANDBOX_MAX_ARCHIVES_PER_TENANT;
        }
    });

    it('after a restart, reaps sandboxes of tenants whose backend never came back (seeded from Docker)', async () => {
        const sandbox = await broker.create('bob', { root: '/tmp/qaap-worktrees/bob/repo-1' });
        const restarted = new QaapTaskSandboxBroker();
        (restarted as unknown as { orchestrator: unknown }).orchestrator = (broker as unknown as { orchestrator: unknown }).orchestrator;
        const now = Date.now();
        restarted.syncLinks(now + 120_000);
        expect(docker.containers.has(sandbox.name)).to.equal(true); // nothing known yet: in-memory state is gone
        await restarted.sweep(now);
        restarted.syncLinks(now + 30_000);
        expect(docker.containers.has(sandbox.name)).to.equal(true); // still within the grace period
        restarted.syncLinks(now + 61_000);
        await waitFor(() => !docker.containers.has(sandbox.name) || undefined);
    });

    it('falls back to the base image when a devcontainer image cannot run the exec server', async () => {
        docker.presentImages.add('alpine:3');
        docker.failImage = 'alpine:3';
        const sandbox = await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1', devcontainer: { image: 'alpine:3' } });
        expect(sandbox.image).to.equal('qaap-theia:test');
        expect(sandbox.imageKind).to.equal('base');
        expect(docker.removed).to.include(sandbox.name);
    });

    it('rejects a bad image reference and never touches another tenant\'s sandbox', async () => {
        await expectRejection(broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1', devcontainer: { image: '--privileged' } }));
        const bobs = await broker.create('bob', { root: '/tmp/qaap-worktrees/bob/repo-1' });
        await expectRejection(broker.destroy('alice', { name: bobs.name }));
        expect(await broker.list('alice')).to.deep.equal([]);
        expect((await broker.list('bob')).map(entry => entry.name)).to.deep.equal([bobs.name]);
        await broker.destroy('bob', { name: bobs.name });
        expect(await broker.list('bob')).to.deep.equal([]);
    });

    it('caps the number of sandboxes per tenant', async () => {
        process.env.QAAP_TASK_SANDBOX_MAX_PER_TENANT = '1';
        try {
            fs.mkdirSync(path.join(hostRoot, 'worktrees', 'alice', 'repo-2'));
            await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1' });
            await expectRejection(broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-2' }), /limit 1/);
        } finally {
            delete process.env.QAAP_TASK_SANDBOX_MAX_PER_TENANT;
        }
    });

    describe('spare sandbox', () => {
        const homeLinks = [{ name: '.claude', target: '/home/theia/.qaap/agent/.claude' }];
        const settled = (tenant = 'alice'): Promise<void> =>
            (broker as unknown as { withTenantLock(tenant: string, operation: () => Promise<void>): Promise<void> }).withTenantLock(tenant, async () => undefined);

        it('keeps one hidden spare after prepare and hands it out to the next base-image create', async () => {
            const metrics = new QaapTenantRuntimeMetrics();
            (broker as unknown as { runtimeMetrics: QaapTenantRuntimeMetrics }).runtimeMetrics = metrics;
            await broker.handle('alice', { op: 'prepare', args: { homeLinks } });
            await settled();
            const spare = broker.spareName('alice');
            expect(docker.containers.get(spare)?.running).to.equal(true);
            const spareConfig = docker.created.find(entry => entry.name === spare) as { Env: string[]; HostConfig: { Binds: string[]; CapDrop: string[] }; User: string };
            // Hardened and mounted exactly like any sandbox of this tenant, with the requested HOME links.
            expect(spareConfig.User).to.equal('1001:1001');
            expect(spareConfig.HostConfig.CapDrop).to.deep.equal(['ALL']);
            expect(spareConfig.HostConfig.Binds.slice(0, 4)).to.deep.equal([
                '/node/repos/alice:/workspace/repos/users/alice:rw',
                '/node/worktrees/alice:/tmp/qaap-worktrees/alice:rw',
                '/node/parallel/alice:/tmp/qaap-parallel/alice:rw',
                '/node/config/alice:/home/theia/.qaap:rw',
            ]);
            expect(spareConfig.Env).to.include(`QAAP_SANDBOX_HOME_LINKS=${JSON.stringify(homeLinks)}`);
            // No task owns it: the tenant never sees it (its backend would reap it as an orphan).
            expect(await broker.list('alice')).to.deep.equal([]);

            const spareToken = docker.stdinWrites.get(spare)!.trim();
            const creates = docker.created.length;
            const root = '/tmp/qaap-worktrees/alice/repo-1';
            const sandbox = await broker.create('alice', { root, homeLinks });
            expect(sandbox).to.include({ name: broker.containerName('alice', root), root, token: spareToken, created: true, source: 'spare' });
            expect(docker.created.length).to.equal(creates); // renamed, not created
            expect(docker.containers.has(sandbox.name)).to.equal(true);
            expect(sandbox.host).to.equal(docker.containers.get(sandbox.name)!.networks['qaap-tenant-net-alice']);
            expect(await broker.list('alice')).to.deep.equal([{ name: sandbox.name, root, running: true, archived: false }]);
            // A second create for the same root reuses the adopted sandbox.
            expect(await broker.create('alice', { root, homeLinks })).to.include({ token: spareToken, created: false, source: 'reused' });

            // The handout queued a refill: a fresh spare with a new token.
            await settled();
            expect(docker.containers.get(spare)?.running).to.equal(true);
            expect(docker.stdinWrites.get(spare)!.trim()).to.not.equal(spareToken);
            const report = metrics.snapshot().taskSandbox;
            expect(report.spare).to.deep.include({ count: 1, window: 1 });
            expect(report.cold.count).to.equal(0);
            expect(report.reused).to.equal(1);
            expect(report.sparesCreated.count).to.equal(2);
            expect(report.toolchainPopulations.count).to.equal(1);
        });

        it('never hands the spare to a create with other HOME links or a devcontainer env, and replaces a stale one', async () => {
            await broker.handle('alice', { op: 'prepare', args: { homeLinks } });
            await settled();
            const spare = broker.spareName('alice');
            const firstSpareToken = docker.stdinWrites.get(spare);
            fs.mkdirSync(path.join(hostRoot, 'worktrees', 'alice', 'repo-2'));
            const withEnv = await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1', homeLinks, devcontainer: { containerEnv: { APP_MODE: 'dev' } } });
            expect(withEnv.source).to.equal('cold');
            expect(docker.stdinWrites.get(spare)).to.equal(firstSpareToken); // untouched
            const otherLinks = await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-2', homeLinks: [] });
            expect(otherLinks.source).to.equal('cold');
            expect(otherLinks.token).to.not.equal(firstSpareToken!.trim());
            // The refill follows the links the tenant now asks for.
            await settled();
            const refilled = docker.created.filter(entry => entry.name === spare).pop() as { Env: string[] };
            expect(refilled.Env).to.include('QAAP_SANDBOX_HOME_LINKS=[]');
        });

        it('recreates a spare whose container died, skips it at the cap, is off with QAAP_TASK_SANDBOX_SPARE=0, and is reaped with the tenant', async () => {
            const spare = broker.spareName('alice');
            await broker.handle('alice', { op: 'prepare', args: { homeLinks } });
            await settled();
            docker.containers.get(spare)!.running = false;
            const sandbox = await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1', homeLinks });
            expect(sandbox.source).to.equal('cold');
            await settled();
            expect(docker.containers.get(spare)?.running).to.equal(true);

            process.env.QAAP_TASK_SANDBOX_MAX_PER_TENANT = '1';
            try {
                await broker.removeTenantSandboxes('alice');
                expect(docker.containers.has(spare)).to.equal(false);
                await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1', homeLinks });
                await settled();
                expect(docker.containers.has(spare)).to.equal(false); // the cap is reached
            } finally {
                delete process.env.QAAP_TASK_SANDBOX_MAX_PER_TENANT;
            }

            process.env.QAAP_TASK_SANDBOX_SPARE = '0';
            try {
                await broker.handle('bob', { op: 'prepare', args: { homeLinks: [] } });
                await settled('bob');
                expect(docker.containers.has(broker.spareName('bob'))).to.equal(false);
            } finally {
                delete process.env.QAAP_TASK_SANDBOX_SPARE;
            }
        });
    });

    it('populates the toolchain volume of every Docker node at boot, so the first create does not', async () => {
        const second = new FakeDocker();
        const metrics = new QaapTenantRuntimeMetrics();
        const orchestrator = (broker as unknown as { orchestrator: Record<string, unknown> }).orchestrator;
        orchestrator.taskSandboxToolchainPlacements = async () => [
            { docker, image: 'qaap-theia:test', nodeId: 'default' },
            { docker: second, image: 'qaap-theia:test', nodeId: 'node-2' },
        ];
        (broker as unknown as { runtimeMetrics: QaapTenantRuntimeMetrics }).runtimeMetrics = metrics;
        const saved = { ...process.env };
        process.env.QAAP_TASK_SANDBOX = '1';
        delete process.env.QAAP_TENANT_BACKEND_MODE;
        try {
            broker.onStart();
            await broker.toolchainPrewarm;
        } finally {
            broker.onStop();
            process.env = saved;
        }
        // One volume per node: each node has its own daemon.
        expect(docker.volumes).to.have.length(1);
        expect(second.volumes).to.have.length(1);
        expect(metrics.snapshot().taskSandbox.toolchainPopulations.count).to.equal(2);
        const helpers = docker.created.length;
        process.env.QAAP_TASK_SANDBOX_SPARE = '0';
        try {
            await broker.create('alice', { root: '/tmp/qaap-worktrees/alice/repo-1' });
        } finally {
            delete process.env.QAAP_TASK_SANDBOX_SPARE;
        }
        expect(docker.created.length).to.equal(helpers + 1); // the sandbox only, no toolchain helper
        expect(docker.volumes).to.have.length(1);
    });
});

async function expectRejection(promise: Promise<unknown>, pattern?: RegExp): Promise<void> {
    try {
        await promise;
    } catch (error) {
        if (pattern) {
            expect((error as Error).message).to.match(pattern);
        }
        return;
    }
    throw new Error('expected a rejection');
}

describe('task sandbox broker link (tenant backend ↔ control plane over HTTP)', function (): void {
    this.timeout(10_000);
    const saved: Record<string, string | undefined> = {};
    const env = { QAAP_TASK_SANDBOX: '1', QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_BACKEND_SECRET: SECRET, QAAP_TENANT_LOGIN: 'alice' };
    let httpServer: http.Server;
    let client: QaapTaskSandboxBrokerClient;
    let broker: QaapTaskSandboxBroker;
    let target: QaapTenantBackendTarget;
    const handled: Array<{ tenant: string; op: string; args: unknown }> = [];

    before(async () => {
        for (const [key, value] of Object.entries(env)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
        client = new QaapTaskSandboxBrokerClient();
        const app = express();
        app.use(express.json());
        client.configure(app as never);
        httpServer = http.createServer(app);
        await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', () => resolve()));
        target = { containerId: 'c1', containerName: 'backend', host: '127.0.0.1', port: (httpServer.address() as net.AddressInfo).port, tenantLogin: 'alice' };
        broker = new QaapTaskSandboxBroker();
        (broker as unknown as { orchestrator: Partial<QaapDockerOrchestrator> }).orchestrator = {
            getTenantBackendAssertionSecret: () => SECRET,
            getTenantBackendConnectionToken: () => undefined,
            listTenantBackendTargets: () => [target],
        };
        broker.handle = async (tenant, request) => {
            handled.push({ tenant, op: request.op, args: request.args });
            if (request.op === 'create') {
                return { name: 'qaap-task-x', root: (request.args as { root: string }).root, host: 'qaap-task-x', port: 7391, token: 't', image: 'i', imageKind: 'base', startupMs: 1, created: true };
            }
            if (request.op === 'prepare') {
                return { ok: true };
            }
            throw new Error('no such sandbox');
        };
    });

    after(() => {
        broker.onStop();
        client.onStop();
        httpServer.close();
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('refuses a link without the tenant-scoped probe', async () => {
        const status = await new Promise<number | undefined>(resolve => {
            http.get({ host: '127.0.0.1', port: target.port, path: '/qaap/api/tenant-runtime/task-sandbox/link' }, response => {
                response.resume();
                resolve(response.statusCode);
            }).on('error', () => resolve(undefined));
        });
        expect(status).to.not.equal(200);
        expect(client.isLinked()).to.equal(false);
    });

    it('carries signed requests down the link and replies back, scoped to the linked tenant', async () => {
        // The tenant backend asks for a spare sandbox every time the link comes up.
        const prepared = new Promise<void>(resolve => client.onDidLink(() => {
            client.prepare({ homeLinks: [{ name: '.claude', target: '/home/theia/.qaap/agent/.claude' }] }).then(resolve);
        }));
        broker.syncLinks();
        await waitFor(() => client.isLinked() || undefined);
        await prepared;
        expect(handled.find(entry => entry.op === 'prepare')).to.deep.equal({
            tenant: 'alice', op: 'prepare', args: { homeLinks: [{ name: '.claude', target: '/home/theia/.qaap/agent/.claude' }] },
        });
        // The link must stay up after the GET was read (not just long enough for one call).
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(client.isLinked()).to.equal(true);
        const created = await client.create({ root: '/tmp/qaap-worktrees/alice/repo-1' }) as QaapTaskSandboxBrokerSandbox;
        expect(created.name).to.equal('qaap-task-x');
        expect(handled.find(entry => entry.op === 'create')).to.deep.equal({ tenant: 'alice', op: 'create', args: { root: '/tmp/qaap-worktrees/alice/repo-1' } });
        await expectRejection(client.destroy({ name: 'other' }), /no such sandbox/);
    });

    it('backs off exponentially on a refused link and warns once per state change', async () => {
        const refusing = http.createServer((_req, res) => res.writeHead(404).end());
        await new Promise<void>(resolve => refusing.listen(0, '127.0.0.1', () => resolve()));
        const refusedTarget = { ...target, containerId: 'c2', tenantLogin: 'carol', port: (refusing.address() as net.AddressInfo).port };
        const backoff = new QaapTaskSandboxBroker();
        (backoff as unknown as { orchestrator: Partial<QaapDockerOrchestrator> }).orchestrator = {
            getTenantBackendAssertionSecret: () => SECRET,
            getTenantBackendConnectionToken: () => undefined,
            listTenantBackendTargets: () => [refusedTarget],
        };
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (message: string) => warnings.push(message);
        try {
            const delays: number[] = [];
            let previous: number | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
                const before = Date.now();
                // Pretend the backoff window has elapsed.
                backoff.syncLinks(previous ?? before);
                const retryAt = await waitFor(() => {
                    const current = backoff.linkRetryAt('carol');
                    return current !== undefined && current !== previous ? current : undefined;
                });
                delays.push(retryAt - before);
                previous = retryAt;
                // Within the backoff window nothing is retried.
                backoff.syncLinks(Date.now());
            }
            expect(delays[1]).to.be.greaterThan(delays[0]);
            expect(delays[2]).to.be.greaterThan(delays[1]);
            expect(warnings.filter(message => message.includes('cannot link to carol'))).to.have.length(1);
        } finally {
            console.warn = originalWarn;
            backoff.onStop();
            refusing.close();
        }
    });
});

describe('QaapTaskSandboxService in broker mode (tenant backend)', function (): void {
    this.timeout(20_000);
    if (process.platform === 'win32') {
        return;
    }
    const saved: Record<string, string | undefined> = {};
    let server: ChildProcess;
    let execPort: number;
    let worktree: string;
    let home: string;
    let service: QaapTaskSandboxService;
    const creates: QaapTaskSandboxBrokerCreateArgs[] = [];
    const destroys: string[] = [];

    before(async () => {
        for (const [key, value] of Object.entries({ QAAP_TASK_SANDBOX: '1', QAAP_TENANT_BACKEND_MODE: '1', QAAP_TASK_SANDBOX_LINGER_MS: '0', QAAP_TASK_SANDBOX_PORT_WATCH_MS: '50' })) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
        execPort = await freePort();
        worktree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-broker-wt-')));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-broker-home-'));
        fs.mkdirSync(path.join(home, 'store', '.claude'), { recursive: true });
        fs.symlinkSync(path.join(home, 'store', '.claude'), path.join(home, '.claude'));
        server = spawn(process.execPath, [path.join(__dirname, 'qaap-task-sandbox-exec-server.js')], {
            env: { PATH: process.env.PATH, HOME: home, QAAP_SANDBOX_EXEC_PORT: String(execPort) },
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        server.stdin!.end(`${TOKEN}\n`);
        let stdout = '';
        server.stdout!.on('data', chunk => stdout += chunk);
        await waitFor(() => stdout.includes('QAAP_SANDBOX_EXEC_READY'));
        const brokerClient = {
            isEnabled: () => true,
            create: async (args: QaapTaskSandboxBrokerCreateArgs) => {
                creates.push(args);
                return { name: 'qaap-task-b', root: args.root, host: '127.0.0.1', port: execPort, token: TOKEN, image: 'qaap-theia:test', imageKind: 'base', startupMs: 5, created: true };
            },
            destroy: async (args: { name: string }) => {
                destroys.push(args.name);
            },
            list: async () => [{ name: 'qaap-task-orphan', root: '/x', running: true, archived: false }],
        };
        service = new QaapTaskSandboxService();
        (service as unknown as { broker: unknown }).broker = brokerClient;
    });

    after(async () => {
        await service.end(worktree).catch(() => undefined);
        server.kill();
        fs.rmSync(worktree, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    let sandbox: QaapTaskSandbox;

    it('asks the broker for the worktree root and forwards the persistent HOME links', async () => {
        sandbox = await service.acquire({ taskId: 't1', cwd: worktree, env: { HOME: home } });
        expect(service.mode()).to.equal('broker');
        expect(creates[0].root).to.equal(worktree);
        expect(creates[0].homeLinks).to.deep.equal([{ name: '.claude', target: path.join(home, 'store', '.claude') }]);
        expect(sandbox.exec).to.deep.equal({ host: '127.0.0.1', port: execPort, token: TOKEN });
        expect(service.sandboxFor(worktree)?.name).to.equal('qaap-task-b');
    });

    it('does not forward, and warns about, a sign-in left in HOME without a persistent link', () => {
        const volatileHome = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-volatile-home-'));
        fs.mkdirSync(path.join(volatileHome, '.codex'));
        const warnings: string[] = [];
        const savedWarn = console.warn;
        console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
        try {
            const links = (service as unknown as { homeLinks(home: string | undefined): Array<{ name: string; target: string }> })
                .homeLinks(volatileHome);
            expect(links).to.deep.equal([]);
            expect(warnings).to.have.length(1);
            expect(warnings[0]).to.include('.codex').and.to.include('not linked to persistent agent storage');
        } finally {
            console.warn = savedWarn;
            fs.rmSync(volatileHome, { recursive: true, force: true });
        }
    });

    it('spawns through the local exec client with the task env and no secret on the argv', async () => {
        let launched: { file: string; args: string[]; options: { env: NodeJS.ProcessEnv } } | undefined;
        const child = service.spawnInSandbox(sandbox, '/bin/sh', ['-c', 'echo "$TASK_KEY:$QAAP_TENANT_BACKEND_SECRET:$HOME"'],
            { cwd: worktree, env: { TASK_KEY: 'k1', QAAP_TENANT_BACKEND_SECRET: SECRET }, stdio: ['pipe', 'pipe', 'pipe'] },
            (file, args, options) => {
                launched = { file, args, options: options as { env: NodeJS.ProcessEnv } };
                return spawn(file, args, options as never);
            });
        child.stdin!.end();
        let output = '';
        child.stdout!.on('data', chunk => output += chunk);
        const code = await new Promise(resolve => child.on('exit', resolve));
        expect(code).to.equal(0);
        expect(output.trim()).to.equal('k1::/tmp/qaap-home');
        expect(launched!.file).to.equal(process.execPath);
        expect(launched!.args.join(' ')).to.not.contain(TOKEN).and.to.not.contain('k1');
        expect(Object.keys(launched!.options.env)).to.deep.equal(['PATH']);
    });

    it('wraps a terminal shell as the exec client in tty mode', () => {
        const wrapped = service.wrapInteractive(sandbox, worktree, '/bin/bash', ['-l'], { TERM: 'xterm-256color' });
        expect(wrapped.file).to.equal(process.execPath);
        const request = JSON.parse(fs.readFileSync(wrapped.args[1], 'utf8'));
        fs.rmSync(wrapped.args[1]);
        expect(request).to.include({ file: '/bin/bash', tty: true, cwd: worktree, token: TOKEN });
        expect(request.env.TERM).to.equal('xterm-256color');
        expect((fs.statSync(path.dirname(wrapped.args[1])).mode & 0o777).toString(8)).to.equal('700');
    });

    it('retargets an expected preview port to the port an app that ignores PORT really bound', async () => {
        const expected = await freePort();
        const app = http.createServer((_req, res) => res.end('hardcoded'));
        const listing = { ports: [] as number[] };
        service.listPorts = async () => listing.ports;
        service.expectPreviewPort(sandbox, expected);
        await new Promise(resolve => setTimeout(resolve, 120));
        await new Promise<void>(resolve => app.listen(0, '127.0.0.1', () => resolve()));
        const hardcoded = (app.address() as net.AddressInfo).port;
        listing.ports = [hardcoded];
        try {
            await waitFor(() => service.hostPortFor(worktree, hardcoded) === expected || undefined);
            const body = await new Promise<string>((resolve, reject) => http.get({ host: '127.0.0.1', port: expected, path: '/' }, response => {
                let text = '';
                response.on('data', chunk => text += chunk);
                response.on('end', () => resolve(text));
            }).on('error', reject));
            expect(body).to.equal('hardcoded');
        } finally {
            app.close();
        }
    });

    it('reaps sandboxes the broker lists that this backend does not own, and destroys on release', async () => {
        expect(await service.reapOrphans()).to.equal(1);
        expect(destroys).to.deep.equal(['qaap-task-orphan']);
        service.release('t1');
        await waitFor(() => destroys.includes('qaap-task-b') || undefined);
        expect(service.sandboxFor(worktree)).to.equal(undefined);
    });
});

describe('QaapTenantSpawnService routes terminals into a task sandbox', () => {
    it('wraps the shell of a sandboxed cwd and leaves other cwds alone', () => {
        const sandbox: QaapTaskSandbox = {
            name: 'qaap-task-t', root: path.resolve('/work/tree'), image: 'img', imageKind: 'base', startupMs: 0, created: true, forwardPorts: [], remoteEnv: {},
        };
        const sandboxService = new QaapTaskSandboxService();
        sandboxService.isEnabled = () => true;
        sandboxService.sandboxFor = cwd => cwd.startsWith(sandbox.root) ? sandbox : undefined;
        const calls: string[] = [];
        sandboxService.wrapInteractive = (_sandbox, cwd, file) => {
            calls.push(`${cwd}:${file}`);
            return { file: 'sandboxed', args: [] };
        };
        class Spawn extends QaapTenantSpawnService {
            constructor() {
                super();
                (this as unknown as { taskSandbox: QaapTaskSandboxService }).taskSandbox = sandboxService;
            }
            override resolveSpawnIdentity(): {} { return {}; }
            override isContainerIsolationEnabled(): boolean { return false; }
            override enforceIsolationPolicy(): void { /* local dev */ }
            protected override launchProcess(): ChildProcess { return new EventEmitter() as ChildProcess; }
        }
        const spawnService = new Spawn();
        expect(spawnService.wrapShellForTenant(path.join(sandbox.root, 'src'), '/bin/bash', ['-l']).file).to.equal('sandboxed');
        expect(spawnService.wrapShellForTenant(path.resolve('/elsewhere'), '/bin/bash', ['-l']).file).to.not.equal('sandboxed');
        expect(calls).to.deep.equal([`${path.join(sandbox.root, 'src')}:/bin/bash`]);
    });
});
