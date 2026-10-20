// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
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

    it('without any key or login falls through qaiq to the keyless hosted agent', () => {
        expect(pickDefault({
            detected: ['qaiq', 'claude', 'opencode'],
            states: { qaiq: 'disconnected', claude: 'disconnected', opencode: 'unknown' },
        })).to.equal('opencode');
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
        const input = { detected: ['codex', 'opencode'], states: { codex: 'disconnected' as const } };
        expect(pickDefault({ ...input, hostedModels: false })).to.equal('opencode');
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

    it('falls to keyless OpenCode when the only installed preferred agent has no auth signal', () => {
        const [ctx, enabled, usable] = pickDefaultArgs({
            detected: ['grok', 'opencode'],
            states: { grok: 'unknown', opencode: 'unknown' },
        });
        expect(defaultAgentExtracted(ctx, enabled, usable, id => id !== 'grok')).to.equal('opencode');
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

    it('falls back to the keyless agent once every preferred agent is explicitly disconnected', async () => {
        expect(await pickFresh('disconnected', 5, 500)).to.equal('opencode');
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
            billingStore: { peekEntitlements: () => options.entitlements },
        });
        return runner;
    }

    const signedOut = { qaiq: 'disconnected', codex: 'disconnected', opencode: 'unknown' } as const;

    it('Starter without keys or logins defaults to keyless OpenCode', () => {
        const runner = runnerWith({ states: signedOut, entitlements: { hostedModels: false, creditsRemaining: 0 } });
        expect(runner.defaultAgent('alice')).to.equal('opencode');
    });

    it('Pro with credits gets hosted Codex even though Codex is signed out', () => {
        const runner = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 10 } });
        expect(runner.defaultAgent('alice')).to.equal('codex');
    });

    it('Pro with the hosted credits spent does not get a Codex that turn start would deny', () => {
        const runner = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 0 } });
        expect(runner.defaultAgent('alice')).to.equal('opencode');
    });

    it('an installed grok (no auth probe, never connected) does not beat keyless OpenCode', () => {
        const runner = runnerWith({ states: signedOut, entitlements: undefined, extraDetected: ['grok'] });
        expect(runner.defaultAgent('alice')).to.equal('opencode');
    });

    it('a cold billing cache is treated as Starter', () => {
        const runner = runnerWith({ states: signedOut, entitlements: undefined });
        expect(runner.defaultAgent('alice')).to.equal('opencode');
    });

    it('an anonymous owner never gets hosted Codex', () => {
        const runner = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 10 } });
        expect(runner.defaultAgent(undefined)).to.equal('opencode');
    });

    it('listAgents keeps a signed-out Codex unavailable once the credits are gone', () => {
        const withCredits = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 10 } });
        const spent = runnerWith({ states: signedOut, entitlements: { hostedModels: true, creditsRemaining: 0 } });
        const codexOf = (runner: QaapAgentTaskRunner) => runner.listAgents('alice').find(agent => agent.id === 'codex');
        expect(codexOf(withCredits)?.available).to.equal(true);
        expect(codexOf(spent)?.available).to.equal(false);
    });
});
