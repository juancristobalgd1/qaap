// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import { QaapOpencodeGateProbe, type QaapOpencodeGateProbeVerdict } from './qaap-tool-gate-opencode-probe';
import { resolveQaapToolGateOpencodePluginPath } from './qaap-tool-gate-opencode-adapter';

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

    it('the plugin file the probe loads exists', () => {
        expect(fs.existsSync(plugin)).to.equal(true);
    });
});
