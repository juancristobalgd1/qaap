// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { AgentCandidate } from './qaap-agent-task-runner-types';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { assertAgentModelAccessExtracted, QaapAgentSignInRequiredError } from './qaap-agent-sign-in-preflight';
import { extractAgentAuthLoginChallenge } from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import { detectAgentFailureKind } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';

type ConnectionState = 'connected' | 'disconnected' | 'unknown' | 'not-required';

describe('assertAgentModelAccessExtracted (pre-spawn sign-in guard)', () => {
    const candidates: AgentCandidate[] = [
        { id: 'codex', label: 'Codex', bin: 'codex', template: 'codex {prompt}' },
        { id: 'opencode', label: 'OpenCode', bin: 'opencode', template: 'opencode run {prompt}' },
        { id: 'shell', label: 'Shell', bin: 'sh', template: '{prompt}' },
        { id: 'qaiq', label: 'QAIQ', bin: 'qaiq', template: 'qaiq {prompt}' },
        { id: 'antigravity', label: 'Antigravity CLI', bin: 'agy', template: 'agy -p {prompt}' },
    ];
    const proModel = { provider: 'openai', vendor: 'openai', modelId: 'gpt-5.5', label: 'GPT 5.5' } as const;
    const freeModel = { provider: 'openai', vendor: 'opencode', modelId: 'opencode/beam-free', label: 'Beam Free' } as const;

    function ctxFor(state: ConnectionState, probeSettled: boolean, enabled = true): QaapAgentTaskRunnerContext {
        return {
            detectedAgents: new Map(candidates.map(candidate => [candidate.id, candidate])),
            isAgentEnabled: () => enabled,
            agentConnectionSnapshot: () => ({ connectionState: state, probeSettled }),
        } as unknown as QaapAgentTaskRunnerContext;
    }

    function thrownBy(run: () => void): unknown {
        try {
            run();
        } catch (error) {
            return error;
        }
        return undefined;
    }

    it('refuses a Pro model for a signed-out owner, with a clear sign-in message and no spawn', () => {
        const error = thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'codex', 'alice', proModel as never));
        expect(error).to.be.instanceOf(QaapAgentSignInRequiredError);
        expect((error as QaapAgentSignInRequiredError).reason).to.equal('sign-in-required');
        expect((error as Error).message).to.equal('Sign in to Codex to use gpt-5.5.');
    });

    it('lets a signed-out owner run a Free OpenCode model', () => {
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'opencode', 'alice', freeModel as never))).to.equal(undefined);
    });

    it('refuses a Pro OpenCode model for a signed-out owner', () => {
        const paid = { provider: 'openai', vendor: 'opencode', modelId: 'opencode/minimax-m3', label: 'MiniMax-M3' } as const;
        const error = thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'opencode', 'alice', paid as never));
        expect((error as QaapAgentSignInRequiredError).reason).to.equal('sign-in-required');
    });

    // Fail-closed: an inconclusive settled probe refuses agy's Pro models like a sign-out; only a pending probe
    // (checking) or a confirmed session lets them run. agy has no Free tier, so every model here is Pro.
    it('refuses agy when its session is positively signed out or settled inconclusive; a pending probe or a session lets it run', () => {
        const models = [undefined, { provider: 'google', vendor: 'antigravity', modelId: 'auto' }, { provider: 'google', vendor: 'antigravity', modelId: 'gemini-3.8-flash-medium' }];
        for (const model of models) {
            const error = thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'antigravity', 'alice', model as never));
            expect(error, `${model?.modelId}/disconnected`).to.be.instanceOf(QaapAgentSignInRequiredError);
            expect((thrownBy(() => assertAgentModelAccessExtracted(ctxFor('unknown', true), 'antigravity', 'alice', model as never)) as QaapAgentSignInRequiredError).reason,
                `${model?.modelId}/unknown/settled`).to.equal('sign-in-required');
            for (const [state, settled] of [['unknown', false], ['connected', true]] as const) {
                expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor(state, settled), 'antigravity', 'alice', model as never)), `${model?.modelId}/${state}/${settled}`)
                    .to.equal(undefined);
            }
        }
    });

    it('lets a signed-in owner run a Pro model', () => {
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('connected', true), 'codex', 'alice', proModel as never))).to.equal(undefined);
    });

    it('lets a harness that needs no sign-in run its Pro models', () => {
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('not-required', true), 'codex', 'alice', proModel as never))).to.equal(undefined);
    });

    // A pending probe (checking) waits for its answer and lets the Pro model run; a settled inconclusive one
    // (unknown) refuses it with the sign-in reason, the same as a sign-out (fail-closed).
    it('lets a Pro model run while the sign-in is still checking, and refuses it once settled inconclusive (fail-closed)', () => {
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('unknown', false), 'codex', 'alice', proModel as never))).to.equal(undefined);
        const error = thrownBy(() => assertAgentModelAccessExtracted(ctxFor('unknown', true), 'codex', 'alice', proModel as never));
        expect(error).to.be.instanceOf(QaapAgentSignInRequiredError);
        expect((error as QaapAgentSignInRequiredError).reason).to.equal('sign-in-required');
        expect((error as Error).message).to.equal('Sign in to Codex to use gpt-5.5.');
        expect((thrownBy(() => assertAgentModelAccessExtracted(ctxFor('unknown', true), 'codex', 'alice', undefined)) as QaapAgentSignInRequiredError).reason)
            .to.equal('sign-in-required');
    });

    it('lets a Free model run whatever the session state, even settled unknown', () => {
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('unknown', false), 'opencode', 'alice', freeModel as never))).to.equal(undefined);
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('unknown', true), 'opencode', 'alice', freeModel as never))).to.equal(undefined);
    });

    it('treats a turn without a resolved model as Pro (fail-closed)', () => {
        const error = thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'codex', 'alice', undefined));
        expect((error as QaapAgentSignInRequiredError).reason).to.equal('sign-in-required');
    });

    it('refuses a harness the owner turned off, with the Settings message', () => {
        const error = thrownBy(() => assertAgentModelAccessExtracted(ctxFor('connected', true, false), 'codex', 'alice', proModel as never));
        expect((error as QaapAgentSignInRequiredError).reason).to.equal('harness-disabled');
        expect((error as Error).message).to.equal('Codex is turned off in Settings → Harness.');
    });

    it('never checks the shell or QAIQ, which have no harness sign-in', () => {
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'shell', 'alice', proModel as never))).to.equal(undefined);
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'qaiq', 'alice', proModel as never))).to.equal(undefined);
    });

    it('writes refusals the transcript reads as a sign-in failure (Sign in chip), not a generic start failure', () => {
        const refusals = [
            thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'codex', 'alice', proModel as never)),
        ].map(error => `${(error as Error).message}\n`);
        for (const log of refusals) {
            expect(detectAgentFailureKind(log), log).to.equal('auth');
            expect(extractAgentAuthLoginChallenge(log, { agentId: 'codex' })?.mode, log).to.equal('session');
        }
    });

    it('does not guard an agent that is not detected on this host', () => {
        expect(thrownBy(() => assertAgentModelAccessExtracted(ctxFor('disconnected', true), 'gemini-missing', 'alice', proModel as never))).to.equal(undefined);
    });
});
