// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';
import { defaultAgentExtracted, defaultAgentFreshExtracted } from './qaap-agent-task-runner-render2';

type ConnectionState = 'connected' | 'disconnected' | 'unknown';

/** Mirrors QaapAgentTaskRunner.defaultAgent() with an injectable catalog, connection map and plan. */
interface PickDefaultOptions {
    readonly detected: readonly string[];
    readonly states: Readonly<Record<string, ConnectionState>>;
    readonly hostedModels?: boolean;
}

function pickDefaultArgs(options: PickDefaultOptions): [QaapAgentTaskRunnerContext, (id: string) => boolean, (id: string) => boolean] {
    const ctx = {
        detectedAgents: new Map(options.detected.map(id => [id, { id, label: id, bin: id, template: `${id} {prompt}` }])),
        normalizeAgentId: (token: string | undefined) => token?.trim().toLowerCase() || undefined,
    } as unknown as QaapAgentTaskRunnerContext;
    const state = (id: string): ConnectionState => options.states[id] ?? 'unknown';
    const usable = (id: string): boolean => state(id) === 'connected'
        || (id === 'opencode' && state(id) !== 'disconnected')
        || (id === 'codex' && options.hostedModels === true);
    return [ctx, id => state(id) !== 'disconnected' || usable(id), usable];
}

function pickDefault(options: PickDefaultOptions): string {
    return defaultAgentExtracted(...pickDefaultArgs(options));
}

describe('defaultAgentExtracted', () => {
    const saved = process.env.QAAP_DEFAULT_AGENT;
    beforeEach(() => { delete process.env.QAAP_DEFAULT_AGENT; });
    afterEach(() => {
        if (saved === undefined) {
            delete process.env.QAAP_DEFAULT_AGENT;
        } else {
            process.env.QAAP_DEFAULT_AGENT = saved;
        }
    });

    it('without any key or login defaults to QAIQ (the BYOK prompt), never the keyless hosted agent', () => {
        expect(pickDefault({
            detected: ['qaiq', 'claude', 'opencode'],
            states: { qaiq: 'disconnected', claude: 'disconnected', opencode: 'unknown' },
        })).to.equal('qaiq');
    });

    it('without a QAIQ key but with a connected Codex picks the first usable agent (Codex)', () => {
        expect(pickDefault({
            detected: ['qaiq', 'codex', 'opencode'],
            states: { qaiq: 'disconnected', codex: 'connected' },
        })).to.equal('codex');
    });

    it('keeps the pre-keyless default while a preferred agent is still unprobed (fresh backend start)', () => {
        expect(pickDefault({
            detected: ['qaiq', 'claude', 'opencode'],
            states: { qaiq: 'disconnected', claude: 'unknown', opencode: 'unknown' },
        })).to.equal('claude');
    });

    it('prefers the first genuinely connected agent over an unconnected one earlier in the list', () => {
        expect(pickDefault({
            detected: ['qaiq', 'codex', 'claude', 'opencode'],
            states: { qaiq: 'disconnected', codex: 'disconnected', claude: 'connected', opencode: 'unknown' },
        })).to.equal('claude');
    });

    it('keeps qaiq first when its API key is configured', () => {
        expect(pickDefault({
            detected: ['qaiq', 'claude', 'opencode'],
            states: { qaiq: 'connected', claude: 'connected' },
        })).to.equal('qaiq');
    });

    it('on Starter never picks hosted Codex, but Pro/Team may', () => {
        const input = { detected: ['qaiq', 'codex', 'opencode'], states: { qaiq: 'disconnected' as const, codex: 'disconnected' as const } };
        expect(pickDefault({ ...input, hostedModels: false })).to.equal('qaiq');
        expect(pickDefault({ ...input, hostedModels: true })).to.equal('codex');
    });

    it('honours the operator-configured QAAP_DEFAULT_AGENT, ignoring connection state', () => {
        process.env.QAAP_DEFAULT_AGENT = 'claude';
        expect(pickDefault({
            detected: ['qaiq', 'claude', 'opencode'],
            states: { qaiq: 'connected', claude: 'unknown' },
        })).to.equal('claude');
    });

    it('still falls back to an installed, not-disconnected agent when nothing is verifiably usable', () => {
        expect(pickDefault({
            detected: ['claude'],
            states: { claude: 'unknown' },
        })).to.equal('claude');
    });
});

describe('defaultAgentExtracted without an auth signal', () => {
    const saved = process.env.QAAP_DEFAULT_AGENT;
    beforeEach(() => { delete process.env.QAAP_DEFAULT_AGENT; });
    afterEach(() => {
        if (saved === undefined) {
            delete process.env.QAAP_DEFAULT_AGENT;
        } else {
            process.env.QAAP_DEFAULT_AGENT = saved;
        }
    });

    it('never lets a harness whose sign-in state can never be known (grok) win with a permanent unknown', () => {
        const [ctx, enabled, usable] = pickDefaultArgs({
            detected: ['grok', 'claude', 'opencode'],
            states: { grok: 'unknown', claude: 'unknown', opencode: 'unknown' },
        });
        const hasAuthSignal = (id: string): boolean => id !== 'grok';
        expect(defaultAgentExtracted(ctx, enabled, usable, hasAuthSignal)).to.equal('claude');
    });

    it('falls to QAIQ, not keyless OpenCode, when the only installed preferred agent has no auth signal', () => {
        const [ctx, enabled, usable] = pickDefaultArgs({
            detected: ['grok', 'qaiq', 'opencode'],
            states: { grok: 'unknown', qaiq: 'disconnected', opencode: 'unknown' },
        });
        expect(defaultAgentExtracted(ctx, enabled, usable, id => id !== 'grok')).to.equal('qaiq');
    });

    it('a disabled QAIQ is not the fallback; the remaining custom agent is used', () => {
        const [ctx, enabled, usable] = pickDefaultArgs({
            detected: ['qaiq', 'claude', 'my-custom-cli'],
            states: { qaiq: 'disconnected', claude: 'disconnected' },
        });
        expect(defaultAgentExtracted(ctx, enabled, usable, () => true, id => id !== 'qaiq')).to.equal('my-custom-cli');
    });
});

describe('defaultAgentFreshExtracted', () => {
    const saved = process.env.QAAP_DEFAULT_AGENT;
    beforeEach(() => { delete process.env.QAAP_DEFAULT_AGENT; });
    afterEach(() => {
        if (saved === undefined) {
            delete process.env.QAAP_DEFAULT_AGENT;
        } else {
            process.env.QAAP_DEFAULT_AGENT = saved;
        }
    });

    /** Probes that settle `claude` (and qaiq) to `settle` after `delayMs`, or never when `delayMs` is undefined. */
    function pickFresh(settle: ConnectionState, delayMs: number | undefined, budgetMs: number): Promise<string> {
        const states: Record<string, ConnectionState> = { qaiq: 'disconnected', claude: 'unknown', opencode: 'unknown' };
        const [ctx, enabled, usable] = pickDefaultArgs({ detected: ['qaiq', 'claude', 'opencode'], states });
        const refresh = (id: string): Promise<ConnectionState> | undefined => {
            if (states[id] !== 'unknown') {
                return undefined;
            }
            return new Promise(resolve => {
                if (delayMs !== undefined) {
                    setTimeout(() => {
                        states[id] = settle;
                        resolve(settle);
                    }, delayMs);
                }
            });
        };
        return defaultAgentFreshExtracted(ctx, enabled, usable, refresh, budgetMs);
    }

    it('waits for an unknown probe that turns connected', async () => {
        expect(await pickFresh('connected', 5, 500)).to.equal('claude');
    });

    it('keeps the pre-keyless default when the probe is still unknown at the deadline', async () => {
        const started = Date.now();
        expect(await pickFresh('connected', undefined, 30)).to.equal('claude');
        expect(Date.now() - started).to.be.lessThan(1_000);
    });

    it('falls back to QAIQ once every preferred agent is explicitly disconnected', async () => {
        expect(await pickFresh('disconnected', 5, 500)).to.equal('qaiq');
    });
});

describe('QaapAgentTaskRunner.defaultAgent (real runner, stubbed auth and billing)', () => {
    const saved = process.env.QAAP_DEFAULT_AGENT;
    beforeEach(() => { delete process.env.QAAP_DEFAULT_AGENT; });
    afterEach(() => {
        if (saved === undefined) {
            delete process.env.QAAP_DEFAULT_AGENT;
        } else {
            process.env.QAAP_DEFAULT_AGENT = saved;
        }
    });

    function runnerWith(options: {
        readonly states: Readonly<Record<string, ConnectionState>>;
        readonly entitlements?: { readonly hostedModels: boolean; readonly creditsRemaining: number };
        readonly extraDetected?: readonly string[];
    }): QaapAgentTaskRunner {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            detectedAgents: new Map<string, AgentCandidate>(
                ['qaiq', 'codex', 'opencode', ...(options.extraDetected ?? [])].map(id => [id, { id, label: id, bin: id, template: `${id} {prompt}` }]),
            ),
            isAgentEnabled: () => true,
            agentConnectionState: (id: string) => options.states[id] ?? 'unknown',
            agentConnectionStates: new Map(),
            preferenceReaderForOwner: () => () => undefined,
            billingStore: { peekEntitlements: () => options.entitlements },
        });
        return runner;
    }

    const signedOut = { qaiq: 'disconnected', codex: 'disconnected', opencode: 'unknown' } as const;

    it('Starter without keys or logins defaults to QAIQ (BYOK prompt), not keyless OpenCode', () => {
        const runner = runnerWith({ states: signedOut, entitlements: { hostedModels: false, creditsRemaining: 0 } });
        expect(runner.defaultAgent('alice')).to.equal('qaiq');
    });

    it('Pro with credits gets hosted Codex even though Codex is signed out', () => {
        const runner = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 10 } });
        expect(runner.defaultAgent('alice')).to.equal('codex');
    });

    it('Pro with the hosted credits spent does not get a Codex that turn start would deny', () => {
        const runner = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 0 } });
        expect(runner.defaultAgent('alice')).to.equal('qaiq');
    });

    it('an installed grok (no auth probe, never connected) does not beat QAIQ', () => {
        const runner = runnerWith({ states: signedOut, entitlements: undefined, extraDetected: ['grok'] });
        expect(runner.defaultAgent('alice')).to.equal('qaiq');
    });

    it('a cold billing cache is treated as Starter', () => {
        const runner = runnerWith({ states: signedOut, entitlements: undefined });
        expect(runner.defaultAgent('alice')).to.equal('qaiq');
    });

    it('an anonymous owner never gets hosted Codex', () => {
        const runner = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 10 } });
        expect(runner.defaultAgent(undefined)).to.equal('qaiq');
    });

    it('listAgents keeps a signed-out Codex unavailable once the credits are gone', () => {
        const withCredits = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 10 } });
        const spent = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 0 } });
        const codexOf = (runner: QaapAgentTaskRunner) => runner.listAgents('alice').find(agent => agent.id === 'codex');
        expect(codexOf(withCredits)?.available).to.equal(true);
        expect(codexOf(spent)?.available).to.equal(false);
    });
});

describe('defaultAgentExtracted fallbacks past the preferred agents', () => {
    const savedDefault = process.env.QAAP_DEFAULT_AGENT;
    const savedCommand = process.env.QAAP_AGENT_COMMAND;
    beforeEach(() => {
        delete process.env.QAAP_DEFAULT_AGENT;
        delete process.env.QAAP_AGENT_COMMAND;
    });
    afterEach(() => {
        for (const [key, value] of [['QAAP_DEFAULT_AGENT', savedDefault], ['QAAP_AGENT_COMMAND', savedCommand]] as const) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('with no agents detected at all falls back to the shell', () => {
        expect(pickDefault({ detected: [], states: {} })).to.equal('shell');
    });

    it('with no agents detected but QAAP_AGENT_COMMAND set uses the operator command', () => {
        process.env.QAAP_AGENT_COMMAND = 'my-agent {prompt}';
        expect(pickDefault({ detected: [], states: {} })).to.equal('env');
    });

    it('when every preferred agent is disconnected and QAIQ is not detected, falls to the shell or operator command', () => {
        const input: PickDefaultOptions = {
            detected: ['codex', 'claude'],
            states: { codex: 'disconnected', claude: 'disconnected' },
            hostedModels: false,
        };
        expect(pickDefault(input)).to.equal('shell');
        process.env.QAAP_AGENT_COMMAND = 'my-agent {prompt}';
        expect(pickDefault(input)).to.equal('env');
    });

    it('when every preferred agent is disconnected and QAIQ is not detected, prefers a custom detected agent', () => {
        expect(pickDefault({
            detected: ['claude', 'my-custom-cli'],
            states: { claude: 'disconnected' },
        })).to.equal('my-custom-cli');
    });

    it('when every preferred agent is disconnected, defaults to QAIQ before a custom detected agent', () => {
        expect(pickDefault({
            detected: ['qaiq', 'claude', 'my-custom-cli'],
            states: { qaiq: 'disconnected', claude: 'disconnected' },
        })).to.equal('qaiq');
    });

    it('an operator QAAP_DEFAULT_AGENT=opencode still wins over the QAIQ fallback', () => {
        process.env.QAAP_DEFAULT_AGENT = 'opencode';
        expect(pickDefault({
            detected: ['qaiq', 'opencode'],
            states: { qaiq: 'disconnected' },
        })).to.equal('opencode');
    });
});

describe('defaultAgentFreshExtracted with grok and a pending vs failed probe', () => {
    const saved = process.env.QAAP_DEFAULT_AGENT;
    beforeEach(() => { delete process.env.QAAP_DEFAULT_AGENT; });
    afterEach(() => {
        if (saved === undefined) {
            delete process.env.QAAP_DEFAULT_AGENT;
        } else {
            process.env.QAAP_DEFAULT_AGENT = saved;
        }
    });

    /**
     * `claude`'s probe either never settles (`pending`) or rejects (`failed`); as in the runner, a failed
     * probe makes the agent count as disconnected for default selection. grok has no auth signal.
     */
    function pickFreshWithGrok(probe: 'pending' | 'failed'): Promise<string> {
        const failed = new Set<string>();
        const [ctx, , usable] = pickDefaultArgs({
            detected: ['grok', 'claude', 'opencode'],
            states: { grok: 'unknown', claude: 'unknown', opencode: 'unknown' },
        });
        const enabled = (id: string): boolean => !failed.has(id) || usable(id);
        const refresh = (id: string): Promise<unknown> | undefined => {
            if (id !== 'claude') {
                return undefined;
            }
            if (probe === 'pending') {
                return new Promise(() => undefined);
            }
            failed.add(id);
            return Promise.reject(new Error('probe crashed'));
        };
        return defaultAgentFreshExtracted(ctx, enabled, usable, refresh, 30, id => id !== 'grok');
    }

    it('keeps the agent whose probe is still pending', async () => {
        expect(await pickFreshWithGrok('pending')).to.equal('claude');
    });

    it('never grok once the probe failed; with no QAIQ detected the remaining fallbacks (shell) apply', async () => {
        expect(await pickFreshWithGrok('failed')).to.equal('shell');
    });
});

describe('QaapAgentTaskRunner.defaultAgentFresh with failing auth probes (real runner)', () => {
    const savedEnv: Record<string, string | undefined> = {
        QAAP_DEFAULT_AGENT: process.env.QAAP_DEFAULT_AGENT,
        QAAP_CLOUD_MODE: process.env.QAAP_CLOUD_MODE,
        QAAP_REPOS_ROOT: process.env.QAAP_REPOS_ROOT,
    };
    beforeEach(() => { delete process.env.QAAP_DEFAULT_AGENT; });
    afterEach(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    /** Detects grok, claude and opencode. `probeClaude` answers claude's probe (opencode's resolves `unknown`); omit it to run the real probe. */
    function runnerWithProbe(probeClaude?: () => Promise<ConnectionState>): QaapAgentTaskRunner {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            detectedAgents: new Map<string, AgentCandidate>(
                ['grok', 'claude', 'opencode'].map(id => [id, { id, label: id, bin: id, template: `${id} {prompt}` }]),
            ),
            agentConnectionStates: new Map(),
            agentConnectionProbes: new Map(),
            isAgentEnabled: () => true,
            preferenceReaderForOwner: () => () => undefined,
            billingStore: undefined,
        });
        if (probeClaude) {
            Object.assign(runner, {
                probeAgentConnectionState: (agentId: string): Promise<ConnectionState> => agentId === 'claude' ? probeClaude() : Promise.resolve('unknown'),
            });
        }
        return runner;
    }

    const claudeChip = (runner: QaapAgentTaskRunner): string | undefined => runner.listAgents('alice').find(agent => agent.id === 'claude')?.connectionState;

    it('a probe that throws leaves no usable preferred agent; with no QAIQ detected the remaining fallbacks (shell) apply, while the chip still says unknown', async () => {
        const runner = runnerWithProbe(() => Promise.reject(new Error('tenant wrapper failed')));
        expect(await runner.defaultAgentFresh('alice', 500)).to.equal('shell');
        expect(runner.defaultAgent('alice')).to.equal('shell');
        expect(claudeChip(runner)).to.equal('unknown');
    });

    it('a probe still pending at the deadline keeps the pre-keyless default', async () => {
        const runner = runnerWithProbe(() => new Promise<ConnectionState>(() => undefined));
        expect(await runner.defaultAgentFresh('alice', 30)).to.equal('claude');
    });

    it('an inconclusive probe answer (e.g. a timeout) is not a failure and keeps the pre-keyless default', async () => {
        const runner = runnerWithProbe(() => Promise.resolve('unknown'));
        expect(await runner.defaultAgentFresh('alice', 500)).to.equal('claude');
    });

    it('a stale failed probe is re-probed within the budget, so a now signed-in agent wins again', async () => {
        const runner = runnerWithProbe(() => Promise.resolve('connected'));
        const states = (runner as unknown as { agentConnectionStates: Map<string, { state: ConnectionState; at: number; probeFailed?: boolean }> })
            .agentConnectionStates;
        states.set('claude:alice', { state: 'unknown', at: 0, probeFailed: true });
        expect(await runner.defaultAgentFresh('alice', 500)).to.equal('claude');
        expect(claudeChip(runner)).to.equal('connected');
    });

    it('a fresh failed probe is not re-probed and does not fall to keyless OpenCode', async () => {
        let probes = 0;
        const runner = runnerWithProbe(() => {
            probes++;
            return Promise.resolve('connected');
        });
        const states = (runner as unknown as { agentConnectionStates: Map<string, { state: ConnectionState; at: number; probeFailed?: boolean }> })
            .agentConnectionStates;
        states.set('claude:alice', { state: 'unknown', at: Date.now(), probeFailed: true });
        expect(await runner.defaultAgentFresh('alice', 500)).to.equal('shell');
        expect(probes).to.equal(0);
    });

    it('a docker tenant without a repos root yet (the probe cannot run without its tenant cwd) does not default to keyless OpenCode', async () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        process.env.QAAP_REPOS_ROOT = path.join(os.tmpdir(), `qaap-default-agent-missing-${process.pid}-${Date.now()}`);
        const runner = runnerWithProbe();
        // OpenCode's real probe fails here too; keyless OpenCode is no longer an automatic default, so the remaining fallbacks apply.
        expect(await runner.defaultAgentFresh('alice', 500)).to.equal('shell');
        expect(claudeChip(runner)).to.equal('unknown');
    });
});
