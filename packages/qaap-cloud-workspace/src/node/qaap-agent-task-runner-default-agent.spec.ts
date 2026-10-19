// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { defaultAgentExtracted } from './qaap-agent-task-runner-render2';

type ConnectionState = 'connected' | 'disconnected' | 'unknown';

/** Mirrors QaapAgentTaskRunner.defaultAgent() with an injectable catalog, connection map and plan. */
function pickDefault(options: {
    readonly detected: readonly string[];
    readonly states: Readonly<Record<string, ConnectionState>>;
    readonly hostedModels?: boolean;
}): string {
    const ctx = {
        detectedAgents: new Map(options.detected.map(id => [id, { id, label: id, bin: id, template: `${id} {prompt}` }])),
        normalizeAgentId: (token: string | undefined) => token?.trim().toLowerCase() || undefined,
    } as unknown as QaapAgentTaskRunnerContext;
    const state = (id: string): ConnectionState => options.states[id] ?? 'unknown';
    const usable = (id: string): boolean => state(id) === 'connected'
        || (id === 'opencode' && state(id) !== 'disconnected')
        || (id === 'codex' && options.hostedModels === true);
    return defaultAgentExtracted(ctx, id => state(id) !== 'disconnected' || usable(id), usable);
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
            states: { qaiq: 'disconnected', claude: 'unknown', opencode: 'unknown' },
        })).to.equal('opencode');
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
