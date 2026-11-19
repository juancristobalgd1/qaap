// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapHarnessModelAvailability, type QaapHarnessSession, type QaapModelTier } from './qaap-harness-model-availability';
import { listQaapComposerPickerAgents, type QaapAgentConnectionState } from './qaap-agent-task-client';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from './qaap-builtin-agents';

describe('qaap-harness-model-availability', () => {

    describe('session', () => {

        it('lets accessState decide alone when present, whatever the connection state says', () => {
            const connectionStates: (QaapAgentConnectionState | undefined)[] = ['connected', 'disconnected', 'unknown', 'not-required', undefined];
            for (const connectionState of connectionStates) {
                for (const probeSettled of [true, false, undefined]) {
                    const label = `${connectionState}/${probeSettled}`;
                    expect(QaapHarnessModelAvailability.session({ connectionState, accessState: 'session', probeSettled }), `session/${label}`).to.equal('signed-in');
                    expect(QaapHarnessModelAvailability.session({ connectionState, accessState: 'none', probeSettled }), `none/${label}`).to.equal('signed-out');
                    // Was always 'checking'; a settled unknown is now its own 'unknown' state (fail-open, see below).
                    expect(QaapHarnessModelAvailability.session({ connectionState, accessState: 'unknown', probeSettled }), `unknown/${label}`)
                        .to.equal(probeSettled === true ? 'unknown' : 'checking');
                }
            }
        });

        it('maps connectionState when accessState is absent', () => {
            expect(QaapHarnessModelAvailability.session({ connectionState: 'connected' })).to.equal('signed-in');
            expect(QaapHarnessModelAvailability.session({ connectionState: 'not-required' })).to.equal('signed-in');
            expect(QaapHarnessModelAvailability.session({ connectionState: 'disconnected' })).to.equal('signed-out');
        });

        // Was: a settled unknown read as signed-out (fail-closed), which locked Antigravity's Pro models whenever its
        // probe timed out. Only a positive answer is a sign-out now.
        it('never treats an unknown connectionState as signed-out: unknown once settled, checking before', () => {
            expect(QaapHarnessModelAvailability.session({ connectionState: 'unknown', probeSettled: true })).to.equal('unknown');
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
                [{ connectionState: 'disconnected', accessState: 'unknown', probeSettled: true }, 'unknown'],
                [{ connectionState: 'unknown', accessState: 'none', probeSettled: false }, 'signed-out'],
                [{ connectionState: 'not-required', probeSettled: false }, 'signed-in'],
                [{ connectionState: 'disconnected', probeSettled: false }, 'signed-out'],
                [{ connectionState: 'unknown', probeSettled: true }, 'unknown'],
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

        const sessions: QaapHarnessSession[] = ['signed-in', 'signed-out', 'checking', 'unknown'];
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

        it('keeps pro models selectable while the session is checking (probe still running)', () => {
            expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session: 'checking', tier: 'pro' }))
                .to.deep.equal({ visible: true, selectable: true });
        });

        it('locks pro models with sign-in-required when the session is unknown (fail-closed)', () => {
            expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session: 'unknown', tier: 'pro' }))
                .to.deep.equal({ visible: true, selectable: false, reason: 'sign-in-required' });
        });

        it('locks pro models on a positive sign-out or an unknown session, and only those', () => {
            const locked = sessions.filter(session => !QaapHarnessModelAvailability.availability({ harnessEnabled: true, session, tier: 'pro' }).selectable);
            expect(locked).to.deep.equal(['signed-out', 'unknown']);
        });

        it('keeps free models selectable even when the session is unknown', () => {
            expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session: 'unknown', tier: 'free' }))
                .to.deep.equal({ visible: true, selectable: true });
        });
    });

    describe('blocksPro', () => {

        it('is true only for a positive sign-out or an unknown session', () => {
            expect(QaapHarnessModelAvailability.blocksPro('signed-out')).to.equal(true);
            expect(QaapHarnessModelAvailability.blocksPro('unknown')).to.equal(true);
            expect(QaapHarnessModelAvailability.blocksPro('checking')).to.equal(false);
            expect(QaapHarnessModelAvailability.blocksPro('signed-in')).to.equal(false);
            expect(QaapHarnessModelAvailability.blocksPro(undefined)).to.equal(false);
        });

        it('agrees with availability for every session state (one rule for picker, send and pre-spawn guard)', () => {
            for (const session of ['signed-in', 'signed-out', 'checking', 'unknown'] as const) {
                const selectable = QaapHarnessModelAvailability.availability({ harnessEnabled: true, session, tier: 'pro' }).selectable;
                expect(selectable, session).to.equal(!QaapHarnessModelAvailability.blocksPro(session));
            }
        });
    });

    describe('toLegacyUnavailableReason', () => {

        it('maps the unified reasons onto the legacy DTO values', () => {
            expect(QaapHarnessModelAvailability.toLegacyUnavailableReason('sign-in-required')).to.equal('not-connected');
            expect(QaapHarnessModelAvailability.toLegacyUnavailableReason('checking-sign-in')).to.equal('checking');
            expect(QaapHarnessModelAvailability.toLegacyUnavailableReason('harness-disabled')).to.equal(undefined);
            expect(QaapHarnessModelAvailability.toLegacyUnavailableReason(undefined)).to.equal(undefined);
        });
    });

    /**
     * Harness × state matrix for every built-in harness, current and future (the list is read, not copied):
     * signed out (backend `accessState: 'none'`), signed in, session unknown / checking (a harness without a usable
     * answer: fail-open), and disabled in Settings → Harness. Pro is every catalog model except OpenCode's own free ones.
     */
    describe('harness × state matrix', () => {
        const PRO_MODEL: Readonly<Record<string, string>> = {
            codex: 'gpt-6-luna', claude: 'claude-opus-5-5', opencode: 'opencode/minimax-m3', pi: 'openrouter/qwen/qwen3-coder:free',
            cursor: 'auto', antigravity: 'gemini-3.8-pro', copilot: 'gpt-6', grok: 'grok-4.7',
        };
        const states: ReadonlyArray<{ readonly name: string; readonly enabled: boolean; readonly session: QaapHarnessSession; readonly pro: object; readonly free: object }> = [
            { name: 'signed out', enabled: true, session: 'signed-out', pro: { visible: true, selectable: false, reason: 'sign-in-required' }, free: { visible: true, selectable: true } },
            { name: 'signed in', enabled: true, session: 'signed-in', pro: { visible: true, selectable: true }, free: { visible: true, selectable: true } },
            { name: 'session unknown', enabled: true, session: 'unknown', pro: { visible: true, selectable: false, reason: 'sign-in-required' }, free: { visible: true, selectable: true } },
            { name: 'session checking', enabled: true, session: 'checking', pro: { visible: true, selectable: true }, free: { visible: true, selectable: true } },
            { name: 'disabled in Settings', enabled: false, session: 'signed-in', pro: { visible: false, selectable: false, reason: 'harness-disabled' }, free: { visible: false, selectable: false, reason: 'harness-disabled' } },
            { name: 'disabled and signed out', enabled: false, session: 'signed-out', pro: { visible: false, selectable: false, reason: 'harness-disabled' }, free: { visible: false, selectable: false, reason: 'harness-disabled' } },
        ];

        for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
            for (const state of states) {
                it(`${definition.id}, ${state.name}`, () => {
                    const proModelId = PRO_MODEL[definition.id] ?? `${definition.id}/some-model`;
                    const proTier = QaapHarnessModelAvailability.tier(definition.id, { modelId: proModelId });
                    expect(proTier, proModelId).to.equal('pro');
                    expect(QaapHarnessModelAvailability.availability({ harnessEnabled: state.enabled, session: state.session, tier: proTier })).to.deep.equal(state.pro);
                    if (definition.id === 'opencode') {
                        const freeTier = QaapHarnessModelAvailability.tier(definition.id, { modelId: 'opencode/beam-free', vendor: 'opencode' });
                        expect(freeTier).to.equal('free');
                        expect(QaapHarnessModelAvailability.availability({ harnessEnabled: state.enabled, session: state.session, tier: freeTier })).to.deep.equal(state.free);
                    }
                });
            }
            // A positive `none` / `disconnected` is a sign-out; an inconclusive settled answer is `unknown`, which
            // locks Pro just like a sign-out (fail-closed). Only `checking` (probe still running) stays selectable.
            it(`${definition.id}: a positive sign-out and an inconclusive settled answer both lock Pro`, () => {
                expect(QaapHarnessModelAvailability.session({ connectionState: 'unknown', accessState: 'none', probeSettled: true })).to.equal('signed-out');
                expect(QaapHarnessModelAvailability.session({ connectionState: 'disconnected' })).to.equal('signed-out');
                expect(QaapHarnessModelAvailability.session({ connectionState: 'unknown', accessState: 'unknown', probeSettled: true })).to.equal('unknown');
                expect(QaapHarnessModelAvailability.blocksPro(QaapHarnessModelAvailability.session({ connectionState: 'unknown', accessState: 'unknown', probeSettled: true }))).to.equal(true);
            });
        }

        it('drops a harness disabled in Settings → Harness from the picker, signed in or not', () => {
            for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
                for (const session of ['signed-in', 'signed-out'] as const) {
                    const agents = [{ id: definition.id, label: definition.label, available: true, session }];
                    expect(listQaapComposerPickerAgents(agents, []).map(agent => agent.id), `${definition.id} enabled`).to.include(definition.id);
                    expect(listQaapComposerPickerAgents(agents, [definition.id]).map(agent => agent.id), `${definition.id} disabled`).to.not.include(definition.id);
                }
            }
        });

        it('declares a session check on every built-in harness (no harness without one)', () => {
            for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
                expect(['probe', 'attestation'], definition.id).to.include(definition.sessionCheck);
            }
        });
    });
});
