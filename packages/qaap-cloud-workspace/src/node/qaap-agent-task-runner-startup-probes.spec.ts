// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapCodexGateOverlayBuilder } from './qaap-codex-gate-overlay';
import { QaapOpencodeGateProbe } from './qaap-tool-gate-opencode-probe';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import type { AgentCandidate } from './qaap-agent-task-runner-types';
import { detectAntigravityAgentExtracted, detectCodexAgentExtracted, resolveAntigravityBinExtracted } from './qaap-agent-task-runner-render2';
import { probeAgentBinOnce } from './qaap-agent-task-runner-utils3';
import { QaapCodexHelpProbe } from './qaap-agent-task-runner-utils';

/** Minimal runner context: only the members the detectors read. */
function fakeContext(overrides: Partial<Record<string, unknown>>): { ctx: QaapAgentTaskRunnerContext; detected: Map<string, AgentCandidate> } {
    const detected = new Map<string, AgentCandidate>();
    const ctx = {
        detectedAgents: detected,
        isOnPath: (): boolean => false,
        cachedCodexHelp: (): string | undefined => '',
        probeCodexHelp: (): Promise<string> => Promise.resolve(''),
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
    it('resolves agy over gemini and antigravity when several are on PATH', () => {
        const { ctx } = fakeContext({ isOnPath: (bin: string) => bin !== 'codex' });
        expect(resolveAntigravityBinExtracted(ctx)).to.equal('agy');
    });

    it('falls back to the gemini CLI only where agy is not installed', () => {
        const { ctx } = fakeContext({ isOnPath: (bin: string) => bin === 'gemini' || bin === 'antigravity' });
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
        const { ctx, detected } = fakeContext({ isOnPath: (bin: string) => bin === 'codex', cachedCodexHelp: () => '' });
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
        const { ctx, detected } = fakeContext({ isOnPath: (bin: string) => bin === 'codex', cachedCodexHelp: () => help });
        const warnings = await captureWarnings(() => detectCodexAgentExtracted(ctx));
        expect(detected.get('codex')?.template).to.contain('codex -q --json');
        expect(detected.get('codex')?.codexSupportsApproveForMe).to.equal(false);
        expect(warnings).to.deep.equal([]);
    });
});

describe('Codex help probe off the event loop', () => {
    const modernHelp = 'Usage: codex [OPTIONS]\nCommands:\n  exec  Run Codex non-interactively\n';

    it('registers Codex at once with the unknown-CLI defaults, then refines it from the probe without a warning', async () => {
        let answer: (help: string) => void = () => undefined;
        const { ctx, detected } = fakeContext({
            isOnPath: (bin: string) => bin === 'codex',
            cachedCodexHelp: () => undefined,
            probeCodexHelp: () => new Promise<string>(resolve => { answer = resolve; }),
        });
        let pending: Promise<void> | undefined;
        const warnings = await captureWarnings(async () => {
            pending = detectCodexAgentExtracted(ctx);
            expect(detected.get('codex')?.template).to.contain('codex exec --json');
            expect(detected.get('codex')?.codexSupportsApproveForMe).to.equal(false);
            answer(`${modernHelp}  --approve-for-me  approve\n`);
            await pending;
        });
        expect(pending).to.not.equal(undefined);
        expect(detected.get('codex')?.codexSupportsApproveForMe).to.equal(true);
        expect(warnings).to.deep.equal([]);
    });

    it('warns once the probe settles empty, and never brings back a codex a later detection removed', async () => {
        let answer: (help: string) => void = () => undefined;
        const { ctx } = fakeContext({
            isOnPath: (bin: string) => bin === 'codex',
            cachedCodexHelp: () => undefined,
            probeCodexHelp: () => new Promise<string>(resolve => { answer = resolve; }),
        });
        const warnings = await captureWarnings(async () => {
            const pending = detectCodexAgentExtracted(ctx);
            answer('');
            await pending;
        });
        expect(warnings).to.have.length(1);
        expect(warnings[0]).to.contain('codex --help probe returned no output');

        const removed = fakeContext({
            isOnPath: (bin: string) => bin === 'codex',
            cachedCodexHelp: () => undefined,
            probeCodexHelp: () => new Promise<string>(resolve => { answer = resolve; }),
        });
        const pending = detectCodexAgentExtracted(removed.ctx);
        removed.detected.delete('codex');
        answer(modernHelp);
        await pending;
        expect(removed.detected.has('codex')).to.equal(false);
    });

    it('runs codex once per binary: concurrent probes share one run and later reads hit the cache', async () => {
        const runs: string[][] = [];
        class FixedBinaryProbe extends QaapCodexHelpProbe {
            protected override resolveBinary(): { readonly path: string; readonly key: string } {
                return { path: '/usr/local/bin/codex', key: 'codex-v1' };
            }
        }
        const probe = new FixedBinaryProbe(async (_file, args) => {
            runs.push([...args]);
            return args[0] === 'exec' ? 'exec help --approve-for-me' : modernHelp;
        });
        expect(probe.cached()).to.equal(undefined);
        const [first, second] = await Promise.all([probe.probe(), probe.probe()]);
        expect(first).to.equal(second);
        expect(first).to.contain('exec help --approve-for-me');
        expect(runs).to.deep.equal([['--help'], ['exec', '--help']]);
        expect(probe.cached()).to.equal(first);
        await probe.probe();
        expect(runs).to.have.length(2);
    });

    it('answers empty without running anything when no trusted codex resolves', async () => {
        let ran = false;
        class NoBinaryProbe extends QaapCodexHelpProbe {
            protected override resolveBinary(): undefined {
                return undefined;
            }
        }
        const probe = new NoBinaryProbe(async () => { ran = true; return 'x'; });
        expect(probe.cached()).to.equal('');
        expect(await probe.probe()).to.equal('');
        expect(ran).to.equal(false);
    });
});

describe('boot-time --version probe', () => {

    it('never blocks: answers at once, probes once in the background and logs one warn line on failure', async () => {
        const probed = new Set<string>();
        const started = Date.now();
        const warnings = await captureWarnings(async () => {
            expect(probeAgentBinOnce('grok', () => '/nonexistent/qaap-grok-bin', probed)).to.equal(true);
            expect(probeAgentBinOnce('grok', () => '/nonexistent/qaap-grok-bin', probed)).to.equal(true);
            expect(Date.now() - started).to.be.below(1000);
            // The asynchronous probe fails (no such binary) and reports once.
            await new Promise(resolve => setTimeout(resolve, 300));
        });
        expect(warnings).to.have.length(1);
        expect(warnings[0]).to.contain('grok --version probe failed');
    });

    it('does not probe a harness whose binary cannot be resolved', () => {
        const probed = new Set<string>();
        expect(probeAgentBinOnce('grok', () => undefined, probed)).to.equal(false);
        expect(probed.has('grok')).to.equal(false);
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
