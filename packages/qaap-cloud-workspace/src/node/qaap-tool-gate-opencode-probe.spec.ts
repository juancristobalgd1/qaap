// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapOpencodeGateProbe, type QaapOpencodeGateProbeVerdict } from './qaap-tool-gate-opencode-probe';
import { resolveQaapToolGateOpencodePluginPath } from './qaap-tool-gate-opencode-adapter';

/** Exposes the protected sandbox and env helpers of the probe to the tests. */
class SandboxProbe extends QaapOpencodeGateProbe {
    sandbox(): { base: string; agentDir: string } {
        return this.createSandbox(undefined);
    }
    remove(sandbox: { base: string; agentDir: string }): Promise<void> {
        return this.removeSandbox(sandbox, undefined);
    }
    env(parent: NodeJS.ProcessEnv, agentDir: string): NodeJS.ProcessEnv {
        return this.buildProbeEnv(parent, agentDir, '/plugin/qaap-tool-gate-opencode.mjs', path.join(agentDir, 'probe.log'), 4321);
    }
    versionEnv(parent: NodeJS.ProcessEnv, agentDir: string): NodeJS.ProcessEnv {
        return this.buildVersionEnv(parent, agentDir);
    }
}

class StubbedProbe extends QaapOpencodeGateProbe {
    runs = 0;
    /** Clock for the `--version` cache; the test moves it past the TTL to re-read a changed version. */
    clock = 1_000_000;
    protected override now(): number {
        return this.clock;
    }
    version: string | Error = '1.19.5';
    result: Omit<QaapOpencodeGateProbeVerdict, 'key'> = { ok: true, reason: 'fine' };
    protected override async readVersion(): Promise<string> {
        if (this.version instanceof Error) {
            throw this.version;
        }
        return this.version;
    }
    protected override async runProbe(key: string): Promise<QaapOpencodeGateProbeVerdict> {
        this.runs++;
        return { ...this.result, key };
    }
}

describe('QaapOpencodeGateProbe', () => {
    const plugin = resolveQaapToolGateOpencodePluginPath();

    it('has no verdict before it ran, which callers treat as not proven', () => {
        expect(new StubbedProbe().verdict()).to.equal(undefined);
    });

    it('probes once per version and plugin build, and exposes the verdict synchronously', async () => {
        const probe = new StubbedProbe();
        expect((await probe.ensure(plugin)).ok).to.equal(true);
        await probe.ensure(plugin);
        expect(probe.runs).to.equal(1);
        expect(probe.verdict()?.ok).to.equal(true);
        probe.version = '1.20.0';
        // Within the version cache TTL the old --version output is still reused.
        await probe.ensure(plugin);
        expect(probe.runs).to.equal(1);
        probe.clock += 5 * 60_000 + 1;
        await probe.ensure(plugin);
        expect(probe.runs).to.equal(2);
    });

    it('shares one run between concurrent callers', async () => {
        const probe = new StubbedProbe();
        await Promise.all([probe.ensure(plugin), probe.ensure(plugin), probe.ensure(plugin)]);
        expect(probe.runs).to.equal(1);
    });

    it('reports a failed probe, and caches it briefly so spawns do not re-probe in a storm', async () => {
        const probe = new StubbedProbe();
        probe.result = { ok: false, reason: 'no hook' };
        expect(await probe.ensure(plugin)).to.include({ ok: false, reason: 'no hook' });
        await probe.ensure(plugin);
        expect(probe.runs).to.equal(1);
        expect(probe.verdict()?.ok).to.equal(false);
    });

    it('is not proven when OpenCode cannot even report its version or the probe throws', async () => {
        const noBinary = new StubbedProbe();
        noBinary.version = new Error('ENOENT');
        expect((await noBinary.ensure(plugin)).ok).to.equal(false);
        const throwing = new StubbedProbe();
        throwing['runProbe'] = async () => { throw new Error('boom'); };
        const verdict = await throwing.ensure(plugin);
        expect(verdict.ok).to.equal(false);
        expect(verdict.reason).to.contain('boom');
    });

    it('the probe env inherits only PATH from the parent, never secrets or gate credentials', () => {
        const probe = new SandboxProbe();
        const parent: NodeJS.ProcessEnv = {
            PATH: '/usr/bin:/bin', HOME: '/home/agent', SECRET_API_KEY: 'sk-live', QAAP_GATE_TOKEN: 'tok', QAAP_GATE_ARM_NONCE: 'nonce', GITHUB_TOKEN: 'ghp',
        };
        const env = probe.env(parent, '/sandbox/agent');
        expect(env.PATH).to.equal('/usr/bin:/bin');
        for (const key of ['SECRET_API_KEY', 'QAAP_GATE_TOKEN', 'QAAP_GATE_ARM_NONCE', 'GITHUB_TOKEN']) {
            expect(env).to.not.have.property(key);
        }
        expect(env.HOME).to.equal('/sandbox/agent');
        expect(env.TMPDIR).to.equal('/sandbox/agent');
    });

    it('the --version env has a private HOME, TMPDIR and the four XDG dirs inside the sandbox, never the passwd home', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const probe = new SandboxProbe();
        const sandbox = probe.sandbox();
        try {
            const passwdHome = os.userInfo().homedir;
            const parent: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: passwdHome, SECRET_API_KEY: 'sk-live', GITHUB_TOKEN: 'ghp' };
            const env = probe.versionEnv(parent, sandbox.agentDir);
            expect(env.PATH).to.equal('/usr/bin:/bin');
            expect(env).to.not.have.property('SECRET_API_KEY');
            expect(env).to.not.have.property('GITHUB_TOKEN');
            for (const key of ['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
                const value = env[key];
                expect(value, key).to.be.a('string');
                expect(value!.startsWith(sandbox.base + path.sep), `${key} must live in the private probe sandbox`).to.equal(true);
                expect(value, key).to.not.equal(passwdHome);
                expect(value!.startsWith(passwdHome + path.sep), key).to.equal(false);
            }
        } finally {
            await probe.remove(sandbox);
        }
    });

    it('the --version env points HOME and XDG at the same agent directory the probe run uses', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const probe = new SandboxProbe();
        const sandbox = probe.sandbox();
        try {
            const version = probe.versionEnv({ PATH: '/usr/bin' }, sandbox.agentDir);
            const run = probe.env({ PATH: '/usr/bin' }, sandbox.agentDir);
            for (const key of ['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
                expect(version[key], key).to.equal(run[key]);
            }
        } finally {
            await probe.remove(sandbox);
        }
    });

    it('creates a fresh private mkdtemp sandbox per probe and removes it afterwards', async function (): Promise<void> {
        // The sandbox checks POSIX mode bits and owners; win32 has no equivalent and the probe fails closed there.
        if (process.platform === 'win32') {
            this.skip();
        }
        const probe = new SandboxProbe();
        const first = probe.sandbox();
        const second = probe.sandbox();
        try {
            expect(path.dirname(first.base)).to.equal(os.tmpdir());
            expect(path.basename(first.base)).to.match(/^qaap-oc-probe-.{6,}$/);
            expect(first.base).to.not.equal(second.base);
            expect(fs.statSync(first.base).mode & 0o077).to.equal(0);
            expect(fs.statSync(first.agentDir).isDirectory()).to.equal(true);
        } finally {
            await probe.remove(first);
            await probe.remove(second);
        }
        expect(fs.existsSync(first.base)).to.equal(false);
        expect(fs.existsSync(second.base)).to.equal(false);
    });

    describe('with a uid drop (the agent creates the sandbox directory, no chown)', () => {
        const agentUid = (process.getuid?.() ?? 0) + 4242;
        let chownCalls: number;
        const realFchown = fs.fchownSync;

        class AgentSandboxProbe extends SandboxProbe {
            created: string[] = [];
            /** Same mkdir the agent child runs, in this process: the test cannot change uid. */
            protected override createAgentDirectory(agentDir: string): boolean {
                this.created.push(agentDir);
                fs.mkdirSync(agentDir, { mode: 0o700 });
                return true;
            }
            protected override directoryOwnerUid(): number {
                return agentUid;
            }
            withDrop(): { base: string; agentDir: string } {
                return this.createSandbox({ uid: agentUid, gid: 7 });
            }
        }

        beforeEach(() => {
            chownCalls = 0;
            // EPERM exactly as a root backend without CAP_CHOWN sees it: any chown would fail the probe.
            (fs as any).fchownSync = (): void => {
                chownCalls++;
                throw Object.assign(new Error('EPERM: operation not permitted, fchown'), { code: 'EPERM' });
            };
        });

        afterEach(() => {
            (fs as any).fchownSync = realFchown;
        });

        it('creates a sticky 1733 base and the agent directory without calling chown', function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            const probe = new AgentSandboxProbe();
            const sandbox = probe.withDrop();
            try {
                expect(fs.statSync(sandbox.base).mode & 0o7777).to.equal(0o1733);
                expect(probe.created).to.deep.equal([sandbox.agentDir]);
                expect(fs.statSync(sandbox.agentDir).isDirectory()).to.equal(true);
                expect(chownCalls).to.equal(0);
            } finally {
                fs.rmSync(sandbox.base, { recursive: true, force: true });
            }
        });

        it('fails with a clear error when the agent user cannot create the directory', function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            class Failing extends AgentSandboxProbe {
                protected override createAgentDirectory(): boolean {
                    return false;
                }
            }
            expect(() => new Failing().withDrop()).to.throw('Could not create the gate probe directory as the agent user');
            expect(chownCalls).to.equal(0);
        });
    });

    describe('OpenCode version cache', () => {
        class VersionCacheProbe extends QaapOpencodeGateProbe {
            clock = 1_000_000;
            reads = 0;
            failNext = false;
            protected override now(): number {
                return this.clock;
            }
            protected override async readVersion(): Promise<string> {
                this.reads++;
                if (this.failNext) {
                    this.failNext = false;
                    throw new Error('ENOENT');
                }
                return '1.19.5';
            }
            protected override async runProbe(key: string): Promise<QaapOpencodeGateProbeVerdict> {
                return { ok: true, reason: 'fine', key };
            }
        }

        it('reads the version once within the cache window and again after it expires', async () => {
            const probe = new VersionCacheProbe();
            await probe.ensure(plugin);
            probe.clock += 4 * 60_000;
            await probe.ensure(plugin);
            expect(probe.reads).to.equal(1);
            probe.clock += 60_000 + 1;
            await probe.ensure(plugin);
            expect(probe.reads).to.equal(2);
        });

        it('does not cache a failed version read, so the next spawn tries again', async () => {
            const probe = new VersionCacheProbe();
            probe.failNext = true;
            expect((await probe.ensure(plugin)).ok).to.equal(false);
            expect((await probe.ensure(plugin)).ok).to.equal(true);
            expect(probe.reads).to.equal(2);
        });
    });

    it('the plugin file the probe loads exists', () => {
        expect(fs.existsSync(plugin)).to.equal(true);
    });
});
