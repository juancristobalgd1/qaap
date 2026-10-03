// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import {
    buildQaapNpmInstallInvocation,
    type QaapAgentCliInstallTarget,
    isInPlaceCliUpdateAllowed,
    QaapAgentCliUpdateService,
    QAAP_ALLOW_IN_PLACE_CLI_UPDATE,
    TRACKED_AGENT_CLIS,
} from './qaap-agent-cli-update-service';
import { resolveAgentCliPrefix, resolveAgentCliPrefixBinDirectory } from './qaap-agent-cli-prefix';

class NpmUpdateResultProbe extends QaapAgentCliUpdateService {
    result: {
        readonly status: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly stdout: string;
        readonly stderr: string;
        readonly error?: Error;
    } = { status: null, signal: 'SIGTERM', stdout: '', stderr: '' };

    override isUpdateCheckEnabled(): boolean {
        return true;
    }

    override isInPlaceCliUpdateAllowed(): boolean {
        return true;
    }

    npmInstallCalls = 0;
    /** When set, npm "runs" until the test resolves it. */
    pendingInstall: Promise<void> | undefined;

    protected override async runNpmInstall(): Promise<NpmUpdateResultProbe['result']> {
        this.npmInstallCalls++;
        await this.pendingInstall;
        return this.result;
    }

    protected override async isInstallPrefixWritableAsTarget(): Promise<boolean> {
        return true;
    }

    protected override async probeInstalled(): Promise<{ bin?: string; version?: string }> {
        return {};
    }

    protected override isSetprivAvailable(): boolean {
        return true;
    }
}

class ReadOnlyNpmUpdateProbe extends NpmUpdateResultProbe {
    protected override async isInstallPrefixWritableAsTarget(): Promise<boolean> {
        return false;
    }
}

interface CapturedProcess {
    readonly file: string;
    readonly args: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
}

/** Pretends the backend runs as `uid` and captures every process instead of starting it. */
class BackendUidProbe extends QaapAgentCliUpdateService {
    readonly processes: CapturedProcess[] = [];

    constructor(protected readonly fakeBackendUid: number | undefined) {
        super();
    }

    override isUpdateCheckEnabled(): boolean {
        return true;
    }

    protected override backendUid(): number | undefined {
        return this.fakeBackendUid;
    }

    protected override resolveSetprivExecutable(): string | undefined {
        return '/usr/bin/setpriv';
    }

    protected override async runBoundedProcess(
        file: string,
        args: readonly string[],
        options: { readonly env?: NodeJS.ProcessEnv },
    ): Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
        this.processes.push({ file, args, env: options.env });
        return { status: 0, signal: null, stdout: 'codex-cli 9.9.9', stderr: '' };
    }

    npmEnvironmentFor(target: QaapAgentCliInstallTarget): NodeJS.ProcessEnv | undefined {
        const resolved = this.resolveNpmInstallTarget(target);
        return resolved && this.npmEnvironment(resolved);
    }

    probe(agentId: string, target?: QaapAgentCliInstallTarget): Promise<{ bin?: string; version?: string }> {
        const tracked = TRACKED_AGENT_CLIS.find(entry => entry.id === agentId)!;
        return this.probeInstalled(tracked, target && this.resolveNpmInstallTarget(target));
    }
}

/** Real bounded spawn, exposed for the timeout test. */
class BoundedProcessProbe extends QaapAgentCliUpdateService {
    run(file: string, args: string[], timeoutMs: number): ReturnType<QaapAgentCliUpdateService['runBoundedProcess']> {
        return this.runBoundedProcess(file, args, { timeoutMs });
    }
}

/** These specs use POSIX paths and uids; Windows has neither /root nor setpriv. */
const posixIt = process.platform === 'win32' ? it.skip : it;
/** Needs a directory root does not own, so it cannot run as root. */
const posixNonRootIt = process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it;

describe('QaapAgentCliUpdateService', () => {
    // A non-root backend may only install for its own uid; a root backend drops to 1001 via setpriv.
    const agentUid = typeof process.getuid === 'function' && process.getuid() !== 0 ? process.getuid() : 1001;
    const originalCheck = process.env.QAAP_AGENT_CLI_UPDATE_CHECK;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCloudMode = process.env.QAAP_CLOUD_MODE;
    const originalAllow = process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
    const originalAgentUid = process.env.QAAP_AGENT_UID;
    const originalAgentGid = process.env.QAAP_AGENT_GID;

    afterEach(() => {
        if (originalCheck === undefined) {
            delete process.env.QAAP_AGENT_CLI_UPDATE_CHECK;
        } else {
            process.env.QAAP_AGENT_CLI_UPDATE_CHECK = originalCheck;
        }
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
        if (originalCloudMode === undefined) {
            delete process.env.QAAP_CLOUD_MODE;
        } else {
            process.env.QAAP_CLOUD_MODE = originalCloudMode;
        }
        if (originalAllow === undefined) {
            delete process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
        } else {
            process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE] = originalAllow;
        }
        if (originalAgentUid === undefined) {
            delete process.env.QAAP_AGENT_UID;
        } else {
            process.env.QAAP_AGENT_UID = originalAgentUid;
        }
        if (originalAgentGid === undefined) {
            delete process.env.QAAP_AGENT_GID;
        } else {
            process.env.QAAP_AGENT_GID = originalAgentGid;
        }
    });

    it('disables the update check via QAAP_AGENT_CLI_UPDATE_CHECK', async () => {
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '0';
        const service = new QaapAgentCliUpdateService();
        expect(service.isUpdateCheckEnabled()).to.equal(false);
        expect(await service.listOutdated()).to.deep.equal({ updates: [] });
    });

    it('rejects in-place update for QAIQ (Docker-layer only)', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('qaiq');
        expect(result.ok).to.equal(false);
        expect(result.id).to.equal('qaiq');
        expect(result.message).to.match(/not updated in-place|Rebuild/i);
    });

    it('rejects unknown agent ids without shelling out', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('not-a-real-agent');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/Unknown agent CLI/i);
    });

    it('refuses production installs without a configured non-root agent uid', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '1';
        delete process.env.QAAP_AGENT_UID;
        delete process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE];
        expect(isInPlaceCliUpdateAllowed()).to.equal(false);
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('codex');
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/configured tenant user/i);
        expect(result.message).not.to.match(/in-place|rebuild/i);
    });

    it('still denies in-place updates in production when the legacy override is set', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_AGENT_UID;
        process.env[QAAP_ALLOW_IN_PLACE_CLI_UPDATE] = '1';
        expect(isInPlaceCliUpdateAllowed()).to.equal(false);
    });

    it('rejects install when update checks are disabled', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '0';
        const service = new QaapAgentCliUpdateService();
        const result = await service.installUpdate('codex', {
            home: '/home/qaap-tenants/alice',
            uid: 1001,
            gid: 1001,
        });
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/UPDATE_CHECK/i);
    });

    it('treats a signaled npm install as failure and preserves an actionable reason', async () => {
        const service = new NpmUpdateResultProbe();
        const target = { home: '/home/qaap-tenants/alice', uid: agentUid, gid: agentUid };
        const result = await service.installUpdate('codex', target);
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/SIGTERM/);

        service.result = { status: 1, signal: null, stdout: '', stderr: 'EACCES: permission denied' };
        const permissionFailure = await service.installUpdate('codex', target);
        expect(permissionFailure.ok).to.equal(false);
        expect(permissionFailure.message).to.contain('EACCES: permission denied');
    });

    it('runs npm through an absolute setpriv with a complete drop and without lifecycle scripts', () => {
        const invocation = buildQaapNpmInstallInvocation(
            '@openai/codex',
            { prefix: '/home/qaap-tenants/alice/.qaap/cli', uid: 1001, gid: 1001 },
            { backendUid: 0, platform: 'linux', setprivPath: '/usr/bin/setpriv' },
        );
        expect(invocation).to.deep.equal({
            file: '/usr/bin/setpriv',
            args: [
                '--reuid', '1001',
                '--regid', '1001',
                '--clear-groups',
                '--no-new-privs',
                '--inh-caps=-all',
                '--bounding-set=-all',
                '--',
                'npm',
                'install',
                '-g',
                '--prefix',
                '/home/qaap-tenants/alice/.qaap/cli',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                '@openai/codex@latest',
            ],
            shell: false,
        });
    });

    it('enables lifecycle scripts only for packages whose binary is produced by postinstall', () => {
        expect(TRACKED_AGENT_CLIS.filter(cli => cli.requiresInstallScripts).map(cli => cli.id))
            .to.deep.equal(['claude', 'opencode']);
        const invocation = buildQaapNpmInstallInvocation(
            '@anthropic-ai/claude-code',
            { prefix: '/home/qaap-tenants/alice/.qaap/cli', uid: 1001, gid: 1001 },
            { backendUid: 0, platform: 'linux', setprivPath: '/usr/bin/setpriv', runInstallScripts: true },
        );
        expect(invocation.args).to.include('--ignore-scripts=false');
        expect(invocation.args).not.to.include('--ignore-scripts');
    });

    it('never runs npm by a PATH-resolved setpriv when a root backend drops privileges', () => {
        expect(() => buildQaapNpmInstallInvocation(
            '@openai/codex',
            { prefix: '/home/qaap-tenants/alice/.qaap/cli', uid: 1001, gid: 1001 },
            { backendUid: 0, platform: 'linux' },
        )).to.throw(/setpriv/);
    });

    posixIt('refuses root-owned and read-only homes before running npm', async () => {
        const target = { home: '/root/tenant', uid: agentUid, gid: agentUid };
        const service = new NpmUpdateResultProbe();
        const rootPathResult = await service.installUpdate('codex', target);
        expect(rootPathResult.ok).to.equal(false);
        expect(rootPathResult.message).to.match(/not available|writable tenant home/i);

        process.env.NODE_ENV = 'production';
        process.env.QAAP_AGENT_UID = String(agentUid);
        const readOnlyService = new ReadOnlyNpmUpdateProbe();
        const readOnlyResult = await readOnlyService.installUpdate('codex', {
            home: '/home/qaap-tenants/alice',
            uid: agentUid,
            gid: agentUid,
        });
        expect(readOnlyResult.ok).to.equal(false);
        expect(readOnlyResult.message).to.match(/read-only/i);
    });

    it('reports harnesses without an installable package honestly instead of as unknown', async () => {
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '1';
        const service = new NpmUpdateResultProbe();
        const result = await service.installUpdate('grok', { home: '/home/qaap-tenants/alice', uid: 1001, gid: 1001 });
        expect(result.ok).to.equal(false);
        expect(result.message).to.match(/no installable package/i);
        expect(result.message).not.to.match(/unknown agent cli/i);
        expect(service.hasInstallablePackage('grok')).to.equal(false);
        expect(service.hasInstallablePackage('codex')).to.equal(true);
    });

    posixIt('refuses a non-persistent /tmp prefix in production even when HOME is a tmpfs', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_AGENT_CLI_UPDATE_CHECK = '1';
        process.env.QAAP_AGENT_UID = '1001';
        const service = new NpmUpdateResultProbe();
        service.result = { status: 0, signal: null, stdout: '', stderr: '' };
        const tmpPrefix = await service.installUpdate('codex', {
            home: '/tmp/qaap-home', prefix: '/tmp/qaap-home/.qaap/cli', uid: 1001, gid: 1001,
        });
        expect(tmpPrefix.ok).to.equal(false);
        expect(service.isAgentInstallSupported('codex', {
            home: '/tmp/qaap-home', prefix: '/tmp/qaap-home/.qaap/cli', uid: 1001, gid: 1001,
        })).to.equal(false);
    });
});

describe('QaapAgentCliUpdateService hardening', () => {
    const originalEnv = { ...process.env };
    let sandbox: string;

    beforeEach(() => {
        sandbox = mkdtempSync(join(tmpdir(), 'qaap-cli-hardening-'));
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        delete process.env.QAAP_AGENT_UID;
        delete process.env.QAAP_AGENT_CLI_UPDATE_CHECK;
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) {
                delete process.env[key];
            }
        }
        Object.assign(process.env, originalEnv);
        rmSync(sandbox, { recursive: true, force: true });
    });

    it('gives npm and its lifecycle scripts an allowlisted env without provider keys or tokens', () => {
        delete process.env.NODE_ENV;
        Object.assign(process.env, {
            ANTHROPIC_API_KEY: 'sk-ant-operator',
            OPENAI_API_KEY: 'sk-operator',
            GITHUB_TOKEN: 'ghp_operator',
            GH_TOKEN: 'gho_operator',
            COPILOT_GITHUB_TOKEN: 'copilot-operator',
            QAAP_TENANT_BACKEND_SECRET: 'backend-secret',
            HTTPS_PROXY: 'http://proxy.internal:3128',
            LANG: 'C.UTF-8',
        });
        const service = new BackendUidProbe(1001);
        const env = service.npmEnvironmentFor({
            home: '/home/qaap-tenants/alice',
            uid: 1001,
            gid: 1001,
            env: { npm_config_cache: '/home/theia/.qaap/npm-cache', XDG_CONFIG_HOME: '/x', SOME_TOKEN: 'leak' },
        })!;
        const keys = Object.keys(env);
        expect(keys.filter(key => /API_?KEY|TOKEN|SECRET/i.test(key))).to.deep.equal([]);
        expect(env.HTTPS_PROXY).to.equal('http://proxy.internal:3128');
        expect(env.LANG).to.equal('C.UTF-8');
        expect(env.npm_config_cache).to.equal('/home/theia/.qaap/npm-cache');
        expect(env.HOME).to.equal(resolve('/home/qaap-tenants/alice'));
        expect(env.PATH?.split(delimiter)[0])
            .to.equal(resolveAgentCliPrefixBinDirectory(resolveAgentCliPrefix(resolve('/home/qaap-tenants/alice'))));
    });

    it('serializes installs per prefix (busy) without blocking the event loop, then rate limits per user', async () => {
        delete process.env.NODE_ENV;
        const service = new NpmUpdateResultProbe();
        service.result = { status: 0, signal: null, stdout: '', stderr: '' };
        let releaseInstall: () => void = () => undefined;
        service.pendingInstall = new Promise<void>(resolveInstall => {
            releaseInstall = resolveInstall;
        });
        const uid = typeof process.getuid === 'function' && process.getuid() !== 0 ? process.getuid() : 1001;
        const target = { home: join(sandbox, 'alice'), uid, gid: uid };

        const first = service.installUpdate('copilot', target, { userKey: 'alice' });
        const second = await service.installUpdate('copilot', target, { userKey: 'alice' });
        expect(second).to.include({ ok: false, reason: 'busy' });

        // The first install is still "running"; the event loop keeps serving other work.
        let ticked = false;
        await new Promise<void>(resolveTick => setImmediate(() => {
            ticked = true;
            resolveTick();
        }));
        expect(ticked).to.equal(true);
        releaseInstall();
        expect((await first).ok).to.equal(true);
        expect(service.npmInstallCalls).to.equal(1);

        service.pendingInstall = undefined;
        for (let attempt = 1; attempt < 5; attempt++) {
            expect((await service.installUpdate('copilot', target, { userKey: 'alice' })).ok).to.equal(true);
        }
        const limited = await service.installUpdate('copilot', target, { userKey: 'alice' });
        expect(limited).to.include({ ok: false, reason: 'rate-limited' });
        expect((await service.installUpdate('copilot', { ...target, home: join(sandbox, 'bob') }, { userKey: 'bob' })).ok).to.equal(true);
    });

    it('kills an install that exceeds its timeout instead of waiting on it', async () => {
        const started = Date.now();
        const result = await new BoundedProcessProbe().run(process.execPath, ['-e', 'setTimeout(() => undefined, 30000)'], 300);
        expect(result.error?.message).to.match(/timed out/);
        expect(result.status).to.equal(null);
        expect(Date.now() - started).to.be.lessThan(10_000);
    });

    posixNonRootIt('never executes a tenant-planted CLI as root while probing versions', async () => {
        delete process.env.NODE_ENV;
        // A tenant-writable directory (owned by the test uid, not root) with a planted `codex`.
        const plantedBin = join(sandbox, 'tenant', '.qaap', 'cli', 'bin');
        mkdirSync(plantedBin, { recursive: true });
        const marker = join(sandbox, 'pwned');
        writeFileSync(join(plantedBin, 'codex'), `#!/bin/sh\ntouch '${marker}'\n`);
        chmodSync(join(plantedBin, 'codex'), 0o755);
        process.env.PATH = [plantedBin, process.env.PATH ?? ''].join(delimiter);

        // No target: the root backend may only run a codex root trusts — the planted one is not.
        const rootService = new BackendUidProbe(0);
        expect((await rootService.probe('codex')).bin).to.equal('codex');
        expect(rootService.processes.filter(started => started.file.startsWith(sandbox))).to.deep.equal([]);
        rootService.processes.length = 0;

        // Tenant target: the probe runs as the agent uid through the absolute setpriv.
        const tenant = { home: join(sandbox, 'tenant'), prefix: join(sandbox, 'tenant', '.qaap', 'cli'), uid: 1001, gid: 1001 };
        const probed = await rootService.probe('codex', tenant);
        expect(probed).to.deep.equal({ bin: 'codex', version: '9.9.9' });
        expect(rootService.processes).to.have.length(1);
        expect(rootService.processes[0].file).to.equal('/usr/bin/setpriv');
        expect(rootService.processes[0].args.slice(0, 2)).to.deep.equal(['--reuid', '1001']);
        expect(rootService.processes[0].args).to.include('--no-new-privs');
        expect(existsSync(marker)).to.equal(false);
    });

    posixIt('lets a local root backend without an agent identity install into its own home (not in production)', () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        delete process.env.QAAP_AGENT_UID;
        const service = new BackendUidProbe(0);
        const home = homedir();
        expect(service.isInstallSupportedForTarget({ home, prefix: join(home, '.qaap', 'cli') })).to.equal(true);
        expect(buildQaapNpmInstallInvocation('@github/copilot', { prefix: join(home, '.qaap', 'cli'), uid: 0, gid: 0 }, {
            backendUid: 0, platform: 'linux',
        }).file).to.equal('npm');
        // A hosted identity that resolved to uid 0 is still refused, and production never installs as root.
        expect(service.isInstallSupportedForTarget({ home, prefix: join(home, '.qaap', 'cli'), uid: 0 })).to.equal(false);
        process.env.NODE_ENV = 'production';
        expect(service.isInstallSupportedForTarget({ home, prefix: join(home, '.qaap', 'cli') })).to.equal(false);
    });
});

describe('Dockerfile tracked agent CLI coverage', () => {
    it('pins every npm-backed tracked harness into the runtime image and smoke checks Copilot', () => {
        const repositoryRoot = resolve(__dirname, '../../../..');
        const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
        const runtimeSmoke = readFileSync(resolve(repositoryRoot, 'scripts/qaap-image-runtime-check.js'), 'utf8');
        const npmInstall = dockerfile.match(/&& npm install -g \\\r?\n([\s\S]*?)\\\r?\n\s*&& npm install -g bun/)?.[1];

        if (!npmInstall) {
            throw new Error('Dockerfile global agent npm install block was not found.');
        }
        for (const tracked of TRACKED_AGENT_CLIS.filter(cli => !!cli.npmPackage)) {
            expect(tracked.expectedVersionEnv).to.be.a('string');
            expect(npmInstall).to.include(`${tracked.npmPackage}@"\${${tracked.expectedVersionEnv}}"`);
            const versionArg = dockerfile.match(
                new RegExp(`^ARG ${tracked.expectedVersionEnv}=([0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?)$`, 'm'),
            );
            expect(versionArg, `${tracked.id} must have an exact Dockerfile version pin`).not.to.equal(null);
        }
        expect(TRACKED_AGENT_CLIS.find(cli => cli.id === 'copilot')?.bins).to.include('copilot');
        expect(dockerfile).to.include('&& copilot --version');
        expect(runtimeSmoke).to.include("'copilot'");
        expect(runtimeSmoke).to.include("spawnSync('copilot', ['--version']");
    });
});
