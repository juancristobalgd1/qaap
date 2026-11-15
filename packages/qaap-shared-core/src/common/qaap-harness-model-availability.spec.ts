// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapHarnessModelAvailability, type QaapHarnessSession, type QaapModelTier } from './qaap-harness-model-availability';
import type { QaapAgentConnectionState } from './qaap-agent-task-client';

describe('qaap-harness-model-availability', () => {

    describe('session', () => {

        it('lets accessState decide alone when present, whatever the connection state says', () => {
            const connectionStates: (QaapAgentConnectionState | undefined)[] = ['connected', 'disconnected', 'unknown', 'not-required', undefined];
            for (const connectionState of connectionStates) {
                for (const probeSettled of [true, false, undefined]) {
                    const label = `${connectionState}/${probeSettled}`;
                    expect(QaapHarnessModelAvailability.session({ connectionState, accessState: 'session', probeSettled }), `session/${label}`).to.equal('signed-in');
                    expect(QaapHarnessModelAvailability.session({ connectionState, accessState: 'none', probeSettled }), `none/${label}`).to.equal('signed-out');
                    expect(QaapHarnessModelAvailability.session({ connectionState, accessState: 'unknown', probeSettled }), `unknown/${label}`).to.equal('checking');
                }
            }
        });

        it('maps connectionState when accessState is absent', () => {
            expect(QaapHarnessModelAvailability.session({ connectionState: 'connected' })).to.equal('signed-in');
            expect(QaapHarnessModelAvailability.session({ connectionState: 'not-required' })).to.equal('signed-in');
            expect(QaapHarnessModelAvailability.session({ connectionState: 'disconnected' })).to.equal('signed-out');
        });

        it('treats unknown connectionState as signed-out only once the probe has settled', () => {
            expect(QaapHarnessModelAvailability.session({ connectionState: 'unknown', probeSettled: true })).to.equal('signed-out');
            expect(QaapHarnessModelAvailability.session({ connectionState: 'unknown', probeSettled: false })).to.equal('checking');
            expect(QaapHarnessModelAvailability.session({ connectionState: 'unknown' })).to.equal('checking');
        });

        it('treats a missing connectionState and missing accessState as checking, even with a settled probe', () => {
            expect(QaapHarnessModelAvailability.session({})).to.equal('checking');
            expect(QaapHarnessModelAvailability.session({ probeSettled: true })).to.equal('checking');
        });

        it('keeps the full precedence table explicit', () => {
            const rows: [Parameters<typeof QaapHarnessModelAvailability.session>[0], QaapHarnessSession][] = [
                [{ connectionState: 'connected', accessState: 'session' }, 'signed-in'],
                [{ connectionState: 'disconnected', accessState: 'session' }, 'signed-in'],
                [{ connectionState: 'connected', accessState: 'none' }, 'signed-out'],
                [{ connectionState: 'connected', accessState: 'unknown' }, 'checking'],
                [{ connectionState: 'disconnected', accessState: 'unknown', probeSettled: true }, 'checking'],
                [{ connectionState: 'unknown', accessState: 'none', probeSettled: false }, 'signed-out'],
                [{ connectionState: 'not-required', probeSettled: false }, 'signed-in'],
                [{ connectionState: 'disconnected', probeSettled: false }, 'signed-out'],
                [{ connectionState: 'unknown', probeSettled: true }, 'signed-out'],
                [{ connectionState: 'unknown', probeSettled: false }, 'checking'],
                [{}, 'checking'],
            ];
            for (const [input, expected] of rows) {
                expect(QaapHarnessModelAvailability.session(input), JSON.stringify(input)).to.equal(expected);
            }
        });
    });

    describe('tier', () => {

        it('classifies OpenCode catalog free models as free', () => {
            expect(QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'opencode/beam-free', label: 'Beam Free' })).to.equal('free');
            expect(QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'opencode/big-pickle' })).to.equal('free');
        });

        it('matches the agent id case-insensitively and ignores surrounding whitespace', () => {
            expect(QaapHarnessModelAvailability.tier(' OpenCode ', { vendor: 'opencode', modelId: 'opencode/big-pickle' })).to.equal('free');
        });

        it('classifies paid OpenCode models as pro', () => {
            expect(QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'opencode/minimax-m3', label: 'MiniMax-M3' })).to.equal('pro');
            expect(QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'anthropic/x', label: 'X Free' })).to.equal('pro');
        });

        it('classifies models of every other harness as pro, including OpenRouter :free models used through Pi', () => {
            const freeLooking = { vendor: 'opencode', modelId: 'opencode/beam-free', label: 'Beam Free' };
            const openRouterFree = { modelId: 'meta-llama/llama-3.3-70b-instruct:free' };
            for (const agentId of ['pi', 'codex', 'claude', 'antigravity', 'copilot', 'grok', 'cursor']) {
                expect(QaapHarnessModelAvailability.tier(agentId, openRouterFree), `${agentId} :free`).to.equal('pro');
                expect(QaapHarnessModelAvailability.tier(agentId, freeLooking), `${agentId} opencode-free-looking`).to.equal('pro');
            }
        });

        it('requires the opencode/ prefix: a free-looking model from another provider under OpenCode is pro', () => {
            expect(QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'opencode/beam-free' })).to.equal('free');
            expect(QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'openrouter/x:free' })).to.equal('pro');
            expect(QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'openrouter/x/free' })).to.equal('pro');
            expect(QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'opencode/minimax-m3' })).to.equal('pro');
        });

        it('fails closed to pro when the model cannot be proven free', () => {
            expect(QaapHarnessModelAvailability.tier('opencode', { modelId: '' })).to.equal('pro');
            expect(QaapHarnessModelAvailability.tier('opencode', { modelId: 'opencode/beam-free' })).to.equal('pro');
        });
    });

    describe('availability', () => {

        const sessions: QaapHarnessSession[] = ['signed-in', 'signed-out', 'checking'];
        const tiers: QaapModelTier[] = ['free', 'pro'];

        it('hides every model of a disabled harness, whatever the session and tier', () => {
            for (const session of sessions) {
                for (const tier of tiers) {
                    expect(QaapHarnessModelAvailability.availability({ harnessEnabled: false, session, tier }), `${session}/${tier}`)
                        .to.deep.equal({ visible: false, selectable: false, reason: 'harness-disabled' });
                }
            }
        });

        it('makes free models visible and selectable in every session state', () => {
            for (const session of sessions) {
                expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session, tier: 'free' }), session)
                    .to.deep.equal({ visible: true, selectable: true });
            }
        });

        it('makes pro models selectable only when signed in', () => {
            expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session: 'signed-in', tier: 'pro' }))
                .to.deep.equal({ visible: true, selectable: true });
        });

        it('locks pro models with sign-in-required when signed out', () => {
            expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session: 'signed-out', tier: 'pro' }))
                .to.deep.equal({ visible: true, selectable: false, reason: 'sign-in-required' });
        });

        it('locks pro models with checking-sign-in while the session is unresolved', () => {
            expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session: 'checking', tier: 'pro' }))
                .to.deep.equal({ visible: true, selectable: false, reason: 'checking-sign-in' });
        });
    });

    describe('toLegacyUnavailableReason', () => {

        it('maps the unified reasons onto the legacy DTO values', () => {
            expect(QaapHarnessModelAvailability.toLegacyUnavailableReason('sign-in-required')).to.equal('not-connected');
            expect(QaapHarnessModelAvailability.toLegacyUnavailableReason('checking-sign-in')).to.equal('unknown');
            expect(QaapHarnessModelAvailability.toLegacyUnavailableReason('harness-disabled')).to.equal(undefined);
            expect(QaapHarnessModelAvailability.toLegacyUnavailableReason(undefined)).to.equal(undefined);
        });
    });
});
