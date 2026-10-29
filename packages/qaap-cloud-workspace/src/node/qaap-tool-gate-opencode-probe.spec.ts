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
}

class StubbedProbe extends QaapOpencodeGateProbe {
    runs = 0;
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

    it('creates a fresh private mkdtemp sandbox per probe and removes it afterwards', async () => {
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

    it('the plugin file the probe loads exists', () => {
        expect(fs.existsSync(plugin)).to.equal(true);
    });
});
