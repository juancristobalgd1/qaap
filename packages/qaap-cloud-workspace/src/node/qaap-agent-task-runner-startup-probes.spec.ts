// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as childProcess from 'child_process';
import { QaapCodexGateOverlayBuilder } from './qaap-codex-gate-overlay';
import { QaapOpencodeGateProbe } from './qaap-tool-gate-opencode-probe';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import type { AgentCandidate } from './qaap-agent-task-runner-types';
import { detectAntigravityAgentExtracted, detectCodexAgentExtracted, resolveAntigravityBinExtracted } from './qaap-agent-task-runner-render2';
import { probeAgentBinOnce } from './qaap-agent-task-runner-utils3';

/** Minimal runner context: only the members the detectors read. */
function fakeContext(overrides: Partial<Record<string, unknown>>): { ctx: QaapAgentTaskRunnerContext; detected: Map<string, AgentCandidate> } {
    const detected = new Map<string, AgentCandidate>();
    const ctx = {
        detectedAgents: detected,
        isOnPath: (): boolean => false,
        readCodexHelp: (): string => '',
        ...overrides,
    } as unknown as QaapAgentTaskRunnerContext;
    return { ctx, detected };
}

/** Replaces `console.warn` for the duration of one test and returns the captured lines. */
function captureWarnings(run: () => void | Promise<void>): Promise<string[]> {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]): void => { lines.push(args.map(String).join(' ')); };
    return Promise.resolve()
        .then(run)
        .finally(() => { console.warn = original; })
        .then(() => lines);
}

describe('Antigravity CLI resolution on the task runner', () => {
    it('resolves gemini over agy and antigravity when several are on PATH', () => {
        const { ctx } = fakeContext({ isOnPath: (bin: string) => bin !== 'codex' });
        expect(resolveAntigravityBinExtracted(ctx)).to.equal('gemini');
    });

    it('registers the agent with the template of the resolved binary', () => {
        const gemini = fakeContext({
            isOnPath: (bin: string) => bin === 'gemini' || bin === 'agy',
            resolveAntigravityBin: () => 'gemini',
        });
        detectAntigravityAgentExtracted(gemini.ctx);
        expect(gemini.detected.get('antigravity')).to.deep.include({
            bin: 'gemini',
            template: 'gemini --approval-mode=yolo {model_flags} -p {prompt}',
        });

        const agy = fakeContext({ resolveAntigravityBin: () => 'agy' });
        detectAntigravityAgentExtracted(agy.ctx);
        expect(agy.detected.get('antigravity')).to.deep.include({ bin: 'agy', template: 'agy -p {prompt}' });
    });

    it('registers nothing when no Antigravity CLI is installed', () => {
        const { ctx, detected } = fakeContext({ resolveAntigravityBin: () => undefined });
        detectAntigravityAgentExtracted(ctx);
        expect(detected.has('antigravity')).to.equal(false);
    });
});

describe('Codex startup detection fallback', () => {
    it('uses the modern exec template but no approve-for-me flag when the help probe returns nothing', async () => {
        const { ctx, detected } = fakeContext({ isOnPath: (bin: string) => bin === 'codex', readCodexHelp: () => '' });
        const warnings = await captureWarnings(() => detectCodexAgentExtracted(ctx));
        const codex = detected.get('codex');
        expect(codex?.template).to.contain('codex exec --json');
        expect(codex?.template).to.not.contain('codex -q');
        expect(codex?.codexSupportsApproveForMe).to.equal(false);
        expect(warnings).to.have.length(1);
        expect(warnings[0]).to.contain('codex --help probe returned no output');
    });

    it('still reads a legacy CLI from help text that clearly shows the legacy flags', async () => {
        const help = 'Usage: codex [options]\n  -q, --quiet   quiet mode\n';
        const { ctx, detected } = fakeContext({ isOnPath: (bin: string) => bin === 'codex', readCodexHelp: () => help });
        const warnings = await captureWarnings(() => detectCodexAgentExtracted(ctx));
        expect(detected.get('codex')?.template).to.contain('codex -q --json');
        expect(detected.get('codex')?.codexSupportsApproveForMe).to.equal(false);
        expect(warnings).to.deep.equal([]);
    });
});

describe('boot-time --version probe', () => {
    let originalSpawnSync: typeof childProcess.spawnSync;
    let calls: Array<{ file: string; options: childProcess.SpawnSyncOptions }>;

    beforeEach(() => {
        originalSpawnSync = childProcess.spawnSync;
        calls = [];
        (childProcess as { spawnSync: unknown }).spawnSync = (file: string, _args: readonly string[], options: childProcess.SpawnSyncOptions) => {
            calls.push({ file, options });
            return { status: null, signal: 'SIGTERM', error: new Error('spawnSync qaap-cli ETIMEDOUT') };
        };
    });

    afterEach(() => {
        (childProcess as { spawnSync: unknown }).spawnSync = originalSpawnSync;
    });

    it('caps the probe at 5 s and logs one warn line when it fails, then keeps booting', async () => {
        const probed = new Set<string>();
        const warnings = await captureWarnings(() => {
            expect(probeAgentBinOnce('grok', () => '/opt/qaap/grok', probed)).to.equal(true);
            expect(probeAgentBinOnce('grok', () => '/opt/qaap/grok', probed)).to.equal(true);
        });
        expect(calls).to.have.length(1);
        expect(calls[0].options.timeout).to.be.at.most(5000);
        expect(warnings).to.have.length(1);
        expect(warnings[0]).to.contain('grok --version probe failed');
    });

    it('does not probe a harness whose binary cannot be resolved', () => {
        const probed = new Set<string>();
        expect(probeAgentBinOnce('grok', () => undefined, probed)).to.equal(false);
        expect(calls).to.have.length(0);
    });
});

describe('gate version probes fall back to a safe default', () => {
    it('reports the codex version as unknown and warns once when codex cannot be started', async () => {
        const builder = QaapCodexGateOverlayBuilder as unknown as { codexVersion(env: NodeJS.ProcessEnv): Promise<string> };
        let version = '';
        const warnings = await captureWarnings(async () => {
            version = await builder.codexVersion({ PATH: '/nonexistent-qaap-dir' });
        });
        expect(version).to.equal('unknown');
        expect(warnings).to.have.length(1);
        expect(warnings[0]).to.contain('codex --version probe failed');
    });

    it('fails the opencode version probe closed with a verdict and a warn line', async () => {
        const probe = new QaapOpencodeGateProbe();
        const warnings = await captureWarnings(async () => {
            const verdict = await probe.ensure('/nonexistent-qaap-plugin.js', { PATH: '/nonexistent-qaap-dir' }, '/nonexistent-qaap-opencode');
            expect(verdict.ok).to.equal(false);
        });
        expect(warnings.some(line => line.includes('opencode --version probe failed'))).to.equal(true);
    });
});
