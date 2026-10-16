// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { ChildProcess, execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapDevcontainerResolver } from './qaap-devcontainer-config';
import { QaapTaskSandbox, QaapTaskSandboxService } from './qaap-task-sandbox';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

/** Records every Docker CLI call instead of running it; `inspect` misses until a `run` happened. */
class FakeDockerSandboxService extends QaapTaskSandboxService {
    readonly calls: string[][] = [];
    readonly running = new Set<string>();
    builtImages = new Set<string>();
    psOutput = '';

    protected override async docker(args: string[]): Promise<string> {
        this.calls.push(args);
        const [command] = args;
        if (command === 'run') {
            this.running.add(args[args.indexOf('--name') + 1]);
            return 'container-id\n';
        }
        if (command === 'inspect') {
            const name = args[args.length - 1];
            if (!this.running.has(name)) {
                throw new Error('No such object');
            }
            return 'true\n';
        }
        if (command === 'image') {
            if (!this.builtImages.has(args[args.length - 1])) {
                throw new Error('No such image');
            }
            return 'sha256:x\n';
        }
        if (command === 'rm') {
            this.running.delete(args[args.length - 1]);
        }
        if (command === 'ps') {
            return this.psOutput;
        }
        return '';
    }

    callsOf(command: string): string[][] {
        return this.calls.filter(call => call[0] === command);
    }
}

const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'sandbox-spec', GIT_AUTHOR_EMAIL: 'sandbox@spec',
    GIT_COMMITTER_NAME: 'sandbox-spec', GIT_COMMITTER_EMAIL: 'sandbox@spec',
};
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv });

describe('QaapTaskSandboxService', function (): void {
    this.timeout(20_000);

    const saved: Record<string, string | undefined> = {};
    const setEnv = (values: Record<string, string | undefined>): void => {
        for (const [key, value] of Object.entries(values)) {
            if (!(key in saved)) {
                saved[key] = process.env[key];
            }
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    };

    let scratch: string;
    let repo: string;
    let worktreeA: string;
    let worktreeB: string;
    let home: string;

    before(() => {
        scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-sandbox-spec-')));
        repo = path.join(scratch, 'repo');
        fs.mkdirSync(repo);
        git(repo, 'init', '-q');
        fs.writeFileSync(path.join(repo, 'README.md'), 'spec\n');
        git(repo, 'add', '-A');
        git(repo, 'commit', '-qm', 'init');
        worktreeA = path.join(scratch, 'worktrees', 'a');
        worktreeB = path.join(scratch, 'worktrees', 'b');
        git(repo, 'worktree', 'add', '-q', '-b', 'qaap/worktree/a', worktreeA);
        git(repo, 'worktree', 'add', '-q', '-b', 'qaap/worktree/b', worktreeB);
        home = path.join(scratch, 'home');
        fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    });

    after(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    beforeEach(() => {
        setEnv({
            QAAP_TASK_SANDBOX: '1',
            QAAP_TASK_SANDBOX_IMAGE: 'qaap-base:test',
            QAAP_TASK_SANDBOX_LINGER_MS: '0',
            QAAP_TASK_SANDBOX_ON_END: undefined,
            QAAP_TASK_SANDBOX_TOOLCHAIN: undefined,
            QAAP_TASK_SANDBOX_HOME_DIRS: undefined,
        });
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
            delete saved[key];
        }
    });

    it('is off unless QAAP_TASK_SANDBOX is 1/true', () => {
        const service = new FakeDockerSandboxService();
        expect(service.isEnabled({})).to.equal(false);
        expect(service.isEnabled({ QAAP_TASK_SANDBOX: '0' })).to.equal(false);
        expect(service.isEnabled({ QAAP_TASK_SANDBOX: 'true' })).to.equal(true);
    });

    it('gives each worktree its own hardened container holding only that worktree', async () => {
        const service = new FakeDockerSandboxService();
        const a = await service.acquire({ taskId: 't1', cwd: path.join(worktreeA), env: { HOME: home }, uid: 20001, gid: 20002 });
        const b = await service.acquire({ taskId: 't2', cwd: worktreeB, env: { HOME: home }, uid: 20001, gid: 20002 });
        expect(a.name).to.not.equal(b.name);
        expect(a.created && b.created).to.equal(true);
        const runs = service.callsOf('run');
        expect(runs).to.have.length(2);
        const run = runs[0];
        const binds = run.flatMap((arg, i) => run[i - 1] === '-v' ? [arg] : []);
        const common = fs.realpathSync(path.join(repo, '.git'));
        expect(binds).to.include(`${worktreeA}:${worktreeA}:rw`);
        expect(binds).to.include(`${common}:${common}:rw`);
        // Metadata the backend later runs git over is read-only inside the sandbox.
        expect(binds).to.include(`${path.join(common, 'config')}:${path.join(common, 'config')}:ro`);
        expect(binds).to.include(`${path.join(common, 'hooks')}:${path.join(common, 'hooks')}:ro`);
        expect(binds).to.include(`${path.join(worktreeA, '.git')}:${path.join(worktreeA, '.git')}:ro`);
        expect(binds.some(bind => bind.startsWith(`${path.join(common, 'worktrees', 'a')}/commondir:`) && bind.endsWith(':ro'))).to.equal(true);
        // Neither the other worktree nor the main checkout is mounted.
        expect(binds.some(bind => bind.startsWith(worktreeB) || bind.startsWith(`${repo}:`))).to.equal(false);
        expect(binds).to.include(`${path.join(home, '.claude')}:/tmp/qaap-home/.claude:rw`);
        expect(run).to.include.members(['--init', '--read-only']);
        expect(run.join(' ')).to.contain('--cap-drop ALL').and.to.contain('--security-opt no-new-privileges:true')
            .and.to.contain('--user 20001:20002').and.to.contain('--network bridge');
        expect(run[run.indexOf('--entrypoint') + 2]).to.equal('qaap-base:test');
    });

    it('shares one container between tasks of the same worktree and ends it after the last release', async () => {
        const service = new FakeDockerSandboxService();
        const [first, second] = await Promise.all([
            service.acquire({ taskId: 't1', cwd: worktreeA }),
            service.acquire({ taskId: 't2', cwd: path.join(worktreeA, '.') }),
        ]);
        expect(first.name).to.equal(second.name);
        expect(service.callsOf('run')).to.have.length(1);
        service.release('t1');
        expect(service.callsOf('rm')).to.have.length(0);
        service.release('t2');
        await new Promise(resolve => setImmediate(resolve));
        expect(service.callsOf('rm')).to.deep.equal([['rm', '-f', first.name]]);
        expect(service.sandboxFor(worktreeA)).to.equal(undefined);
    });

    it('archives instead of destroying when QAAP_TASK_SANDBOX_ON_END=archive', async () => {
        setEnv({ QAAP_TASK_SANDBOX_ON_END: 'archive' });
        const service = new FakeDockerSandboxService();
        const sandbox = await service.acquire({ taskId: 't1', cwd: worktreeA });
        service.release('t1');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(service.callsOf('stop')[0]).to.deep.equal(['stop', '-t', '5', sandbox.name]);
        expect(service.callsOf('rename')[0][2]).to.match(new RegExp(`^${sandbox.name}-archived-\\d+$`));
        expect(service.callsOf('rm')).to.have.length(0);
    });

    it('keeps the sandbox for the linger period so a follow-up turn reuses it', async () => {
        setEnv({ QAAP_TASK_SANDBOX_LINGER_MS: '60000' });
        const service = new FakeDockerSandboxService();
        const sandbox = await service.acquire({ taskId: 't1', cwd: worktreeA });
        service.release('t1');
        const again = await service.acquire({ taskId: 't2', cwd: worktreeA });
        expect(again).to.equal(sandbox);
        expect(service.callsOf('run')).to.have.length(1);
        await service.end(sandbox.root);
    });

    it('routes a cwd to the sandbox of its worktree, never a sibling', async () => {
        const service = new FakeDockerSandboxService();
        const a = await service.acquire({ taskId: 't1', cwd: worktreeA });
        fs.mkdirSync(path.join(worktreeA, 'src'), { recursive: true });
        expect(service.sandboxFor(path.join(worktreeA, 'src'))?.name).to.equal(a.name);
        expect(service.sandboxFor(worktreeB)).to.equal(undefined);
        expect(service.sandboxFor(`${worktreeA}-other`)).to.equal(undefined);
        await service.end(a.root);
    });

    it('passes variables to exec by name only and sets the sandbox PATH and HOME itself', async () => {
        const service = new FakeDockerSandboxService();
        const sandbox = await service.acquire({ taskId: 't1', cwd: worktreeA });
        const wrapped = service.wrapExec(sandbox, worktreeA, '/bin/sh', ['-c', 'qaiq'], {
            ANTHROPIC_API_KEY: 'sk-secret', PATH: '/host/bin', HOME: '/Users/host', DOCKER_HOST: 'unix:///x',
        }, 'x1');
        expect(wrapped.file).to.equal('docker');
        const joined = wrapped.args.join(' ');
        expect(joined).to.not.contain('sk-secret');
        expect(wrapped.args).to.include('ANTHROPIC_API_KEY');
        expect(joined).to.not.contain('/host/bin').and.to.not.contain('/Users/host').and.to.not.contain('DOCKER_HOST');
        expect(joined).to.contain('HOME=/tmp/qaap-home').and.to.contain(`-w ${worktreeA} ${sandbox.name} /tmp/.qaap-exec/run x1 /bin/sh -c qaiq`);
        // Secrets are never part of the container's persisted create-time config either.
        expect(service.callsOf('run')[0].join(' ')).to.not.contain('ANTHROPIC_API_KEY');
        await service.end(sandbox.root);
    });

    it('runs the exec client under a trap that kills the in-container process group on TERM', async () => {
        const service = new FakeDockerSandboxService();
        const sandbox = await service.acquire({ taskId: 't1', cwd: worktreeA });
        const launches: Array<{ file: string; args: string[]; options: { env: NodeJS.ProcessEnv } }> = [];
        service.spawnInSandbox(sandbox, 'npm', ['run', 'dev'], { cwd: worktreeA, env: { TASK_TOKEN: 't' }, stdio: ['ignore', 'pipe', 'pipe'] },
            (file, args, options) => {
                launches.push({ file, args, options: options as { env: NodeJS.ProcessEnv } });
                return new EventEmitter() as ChildProcess;
            });
        const [launch] = launches;
        expect(launch.file).to.equal('/bin/sh');
        expect(launch.args[1]).to.contain('trap').and.to.contain('TERM INT HUP');
        const execId = launch.args[launch.args.indexOf('/tmp/.qaap-exec/run') + 1];
        expect(launch.args.slice(3, 6)).to.deep.equal(['docker', sandbox.name, service.killScript(execId)]);
        expect(service.killScript(execId)).to.contain(`/tmp/.qaap-exec/${execId}.pid`).and.to.contain('kill -TERM -"$p"');
        expect(launch.args.slice(-3)).to.deep.equal(['npm', 'run', 'dev']);
        // The docker CLI itself gets the backend PATH; the task's own variables still reach it by name.
        expect(launch.options.env.PATH).to.equal(process.env.PATH);
        expect(launch.options.env.TASK_TOKEN).to.equal('t');
        await service.end(sandbox.root);
    });

    it('reaps orphaned sandboxes but keeps fresh archives and live ones', async () => {
        const service = new FakeDockerSandboxService();
        const live = await service.acquire({ taskId: 't1', cwd: worktreeA });
        const now = Date.parse('2026-10-16T12:00:00Z');
        service.psOutput = [
            `${live.name}\trunning\t2026-10-16 11:00:00 +0000 UTC`,
            'qaap-task-aaaaaaaaaaaa\trunning\t2026-10-16 11:00:00 +0000 UTC',
            'qaap-task-bbbbbbbbbbbb-archived-1\texited\t2026-10-16 11:00:00 +0000 UTC',
            'qaap-task-cccccccccccc-archived-1\texited\t2026-10-10 11:00:00 +0000 UTC',
            'someone-else\trunning\t2026-10-16 11:00:00 +0000 UTC',
        ].join('\n');
        expect(await service.reapOrphans(now)).to.equal(2);
        expect(service.callsOf('rm').map(call => call[2])).to.deep.equal(['qaap-task-aaaaaaaaaaaa', 'qaap-task-cccccccccccc-archived-1']);
        await service.end(live.root);
    });

    it('uses a devcontainer image, and falls back to the base image while a Dockerfile build runs', async () => {
        const service = new FakeDockerSandboxService();
        fs.mkdirSync(path.join(worktreeB, '.devcontainer'), { recursive: true });
        fs.writeFileSync(path.join(worktreeB, '.devcontainer', 'devcontainer.json'),
            '{ // comment\n "image": "mcr.microsoft.com/devcontainers/javascript-node:22", "containerEnv": {"FOO": "bar"}, "postCreateCommand": "npm ci", }');
        const withImage = await service.acquire({ taskId: 't1', cwd: worktreeB });
        expect(withImage.imageKind).to.equal('image');
        const run = service.callsOf('run')[0];
        expect(run).to.include('mcr.microsoft.com/devcontainers/javascript-node:22').and.to.include('FOO=bar');
        expect(run).to.not.include('--read-only');
        expect(service.callsOf('exec').some(call => call.includes('npm ci'))).to.equal(true);
        await service.end(withImage.root);

        fs.writeFileSync(path.join(worktreeB, '.devcontainer', 'devcontainer.json'), '{ "build": { "dockerfile": "Dockerfile" } }');
        fs.writeFileSync(path.join(worktreeB, '.devcontainer', 'Dockerfile'), 'FROM node:22\n');
        const cold = await service.acquire({ taskId: 't2', cwd: worktreeB });
        expect(cold.imageKind).to.equal('base');
        expect(cold.image).to.equal('qaap-base:test');
        expect(service.callsOf('build')).to.have.length(1);
        await service.end(cold.root);
        fs.rmSync(path.join(worktreeB, '.devcontainer'), { recursive: true, force: true });
    });
});

describe('QaapDevcontainerResolver', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-devcontainer-spec-'));
        fs.mkdirSync(path.join(root, '.devcontainer'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const write = (text: string): void => fs.writeFileSync(path.join(root, '.devcontainer', 'devcontainer.json'), text);

    it('returns the base image when the repo has no devcontainer', () => {
        fs.rmSync(path.join(root, '.devcontainer'), { recursive: true });
        expect(new QaapDevcontainerResolver().plan(root, 'base:1')).to.deep.equal({ kind: 'base', image: 'base:1' });
    });

    it('parses JSONC without touching comment-like text inside strings', () => {
        expect(JSON.parse(QaapDevcontainerResolver.stripJsonc('{"a": "http://x/*y*/", /* c */ "b": [1, 2,], // d\n}')))
            .to.deep.equal({ a: 'http://x/*y*/', b: [1, 2] });
    });

    it('content-addresses Dockerfile builds and refuses build paths outside the repo', () => {
        write('{ "build": { "dockerfile": "Dockerfile", "args": { "V": "1" } } }');
        fs.writeFileSync(path.join(root, '.devcontainer', 'Dockerfile'), 'FROM node:22\n');
        const resolver = new QaapDevcontainerResolver();
        const first = resolver.plan(root, 'base');
        expect(first.kind).to.equal('build');
        expect(first.image).to.match(/^qaap-devcontainer:[0-9a-f]{16}$/);
        fs.writeFileSync(path.join(root, '.devcontainer', 'Dockerfile'), 'FROM node:24\n');
        expect(resolver.plan(root, 'base').image).to.not.equal(first.image);

        write('{ "build": { "dockerfile": "../../etc/Dockerfile" } }');
        expect(resolver.plan(root, 'base')).to.deep.equal({ kind: 'base', image: 'base' });
    });

    it('never honors host-executing or privilege-granting keys', () => {
        write('{ "image": "x:1", "initializeCommand": "rm -rf ~", "runArgs": ["--privileged"], "privileged": true, "remoteUser": "root" }');
        const config = new QaapDevcontainerResolver().read(root)!;
        expect(config.image).to.equal('x:1');
        expect(Object.keys(config)).to.not.include.members(['initializeCommand', 'runArgs', 'privileged', 'remoteUser']);
    });

    it('turns string, argv and parallel-object postCreateCommands into one shell line', () => {
        expect(QaapDevcontainerResolver.lifecycleCommand('npm ci')).to.equal('npm ci');
        expect(QaapDevcontainerResolver.lifecycleCommand(['echo', "it's"])).to.equal('\'echo\' \'it\'\\\'\'s\'');
        expect(QaapDevcontainerResolver.lifecycleCommand({ a: 'npm ci', b: ['pip', 'install'] })).to.equal("( npm ci ) & ( 'pip' 'install' ) & wait");
        expect(QaapDevcontainerResolver.lifecycleCommand(42)).to.equal(undefined);
    });
});

describe('QaapTenantSpawnService with a per-task sandbox', () => {
    class RoutingSpawnService extends QaapTenantSpawnService {
        readonly launches: Array<{ file: string; args: string[] }> = [];
        constructor(sandboxService: QaapTaskSandboxService) {
            super();
            (this as unknown as { taskSandbox: QaapTaskSandboxService }).taskSandbox = sandboxService;
        }
        override resolveSpawnIdentity(): {} { return {}; }
        protected override isSetprivAvailable(): boolean { return false; }
        override isContainerIsolationEnabled(): boolean { return false; }
        protected override launchProcess(file: string, args: string[]): ChildProcess {
            this.launches.push({ file, args });
            return new EventEmitter() as ChildProcess;
        }
    }

    const sandbox: QaapTaskSandbox = {
        name: 'qaap-task-test', root: path.resolve('/work/tree'), image: 'img', imageKind: 'base',
        startupMs: 1, created: true, forwardPorts: [], remoteEnv: {},
    };

    const fakeSandboxService = (enabled: boolean): QaapTaskSandboxService => {
        const service = new QaapTaskSandboxService();
        service.isEnabled = () => enabled;
        service.sandboxFor = cwd => cwd.startsWith(sandbox.root) ? sandbox : undefined;
        return service;
    };

    it('runs agent commands and argv spawns inside the sandbox that owns the cwd', () => {
        const spawnService = new RoutingSpawnService(fakeSandboxService(true));
        spawnService.spawn('qaiq --print', { cwd: path.join(sandbox.root, 'src'), env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
        spawnService.spawnArgvPrepared('npm', ['run', 'dev'], { cwd: sandbox.root, env: {} });
        expect(spawnService.launches.map(launch => launch.file)).to.deep.equal(['/bin/sh', '/bin/sh']);
        expect(spawnService.launches.every(launch => launch.args.includes('docker') && launch.args.includes('exec'))).to.equal(true);
        const args = spawnService.launches[0].args;
        expect(args[args.lastIndexOf(sandbox.name) + 1]).to.equal('/tmp/.qaap-exec/run');
        expect(spawnService.launches[0].args.slice(-3)).to.deep.equal(['/bin/sh', '-c', 'qaiq --print']);
        expect(spawnService.launches[1].args.slice(-3)).to.deep.equal(['npm', 'run', 'dev']);
    });

    it('leaves spawns untouched when the flag is off or the cwd has no sandbox', () => {
        const off = new RoutingSpawnService(fakeSandboxService(false));
        off.spawnArgvPrepared('npm', ['test'], { cwd: sandbox.root, env: {} });
        const elsewhere = new RoutingSpawnService(fakeSandboxService(true));
        elsewhere.spawnArgvPrepared('npm', ['test'], { cwd: path.resolve('/other'), env: {} });
        expect([...off.launches, ...elsewhere.launches].some(launch => [launch.file, ...launch.args].includes('docker'))).to.equal(false);
    });
});
