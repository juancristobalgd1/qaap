// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapCreateAgentTaskQaiqModel } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import {
    resolveTranscriptHarnessSwitches,
    resolveTranscriptPendingHarnessSwitch,
    transcriptHarnessSwitchKey,
    type TranscriptHarnessMessage,
} from './qaap-transcript-harness-switch';

const opus: QaapCreateAgentTaskQaiqModel = { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-opus-5-5' };
const sonnet: QaapCreateAgentTaskQaiqModel = { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-5' };

function user(turnAgentId?: string, turnAgentModel?: QaapCreateAgentTaskQaiqModel): TranscriptHarnessMessage {
    return { role: 'user', turnAgentId, turnAgentModel };
}
const agent: TranscriptHarnessMessage = { role: 'agent' };

describe('qaap-transcript-harness-switch', () => {

    describe('resolveTranscriptHarnessSwitches', () => {
        it('marks the user turn that ran on another harness than the previous turn', () => {
            const switches = resolveTranscriptHarnessSwitches([
                user('claude', opus), agent,
                user('codex'), agent,
            ]);
            expect([...switches.keys()]).to.deep.equal([2]);
            expect(switches.get(2)).to.deep.equal({
                from: { agentId: 'claude', model: opus },
                to: { agentId: 'codex', model: undefined },
            });
        });

        it('records every switch, including a switch back', () => {
            const switches = resolveTranscriptHarnessSwitches([
                user('opencode'), agent, user('antigravity'), agent, user('opencode'), agent,
            ]);
            expect([...switches.keys()]).to.deep.equal([2, 4]);
            expect(switches.get(4)?.from.agentId).to.equal('antigravity');
        });

        it('ignores a model-only change inside the same harness', () => {
            const switches = resolveTranscriptHarnessSwitches([
                user('claude', opus), agent, user('claude', sonnet), agent,
            ]);
            expect(switches.size).to.equal(0);
        });

        it('treats harness aliases as the same harness', () => {
            expect(resolveTranscriptHarnessSwitches([user('cursor-agent'), agent, user('cursor')]).size).to.equal(0);
            expect(resolveTranscriptHarnessSwitches([user('gemini'), agent, user('antigravity')]).size).to.equal(0);
        });

        it('skips turns without provenance without resetting the previous harness', () => {
            const switches = resolveTranscriptHarnessSwitches([
                user('claude'), agent, user(undefined), agent, user('codex'), agent,
            ]);
            expect([...switches.keys()]).to.deep.equal([4]);
            expect(switches.get(4)?.from.agentId).to.equal('claude');
        });

        it('has no switch for the first turn or a single-harness conversation', () => {
            expect(resolveTranscriptHarnessSwitches([]).size).to.equal(0);
            expect(resolveTranscriptHarnessSwitches([user('codex'), agent, user('codex'), agent]).size).to.equal(0);
        });
    });

    describe('resolveTranscriptPendingHarnessSwitch', () => {
        const history = [user('claude', opus), agent];

        it('is pending while the composer selects another harness than the last turn', () => {
            expect(resolveTranscriptPendingHarnessSwitch(history, { agentId: 'codex' })).to.deep.equal({
                from: { agentId: 'claude', model: opus },
                to: { agentId: 'codex', model: undefined },
            });
        });

        it('is not pending for the same harness, even with another model', () => {
            expect(resolveTranscriptPendingHarnessSwitch(history, { agentId: 'claude', model: sonnet })).to.equal(undefined);
        });

        it('is not pending without a selection or without a sealed turn to hand off from', () => {
            expect(resolveTranscriptPendingHarnessSwitch(history, undefined)).to.equal(undefined);
            expect(resolveTranscriptPendingHarnessSwitch(history, { agentId: 'task' })).to.equal(undefined);
            expect(resolveTranscriptPendingHarnessSwitch([], { agentId: 'codex' })).to.equal(undefined);
        });

        it('steps aside while the latest user turn is in flight (not sealed yet)', () => {
            expect(resolveTranscriptPendingHarnessSwitch([...history, user(undefined)], { agentId: 'codex' })).to.equal(undefined);
        });

        it('settles once the next turn ran on the selected harness', () => {
            const messages = [...history, user('codex'), agent];
            expect(resolveTranscriptPendingHarnessSwitch(messages, { agentId: 'codex' })).to.equal(undefined);
            expect([...resolveTranscriptHarnessSwitches(messages).keys()]).to.deep.equal([2]);
        });

        it('does not stay pending after a failed turn on the selected harness', () => {
            expect(resolveTranscriptPendingHarnessSwitch(history, { agentId: 'opencode' }, {
                conversationStatus: 'failed',
                conversationAgentId: 'opencode',
            })).to.equal(undefined);
            // Switching to a third harness to recover from a failed turn still previews the new handoff.
            expect(resolveTranscriptPendingHarnessSwitch(history, { agentId: 'codex' }, {
                conversationStatus: 'failed',
                conversationAgentId: 'opencode',
            })?.to.agentId).to.equal('codex');
        });
    });

    it('keys distinguish pending from settled and different models', () => {
        const harnessSwitch = { from: { agentId: 'claude', model: opus }, to: { agentId: 'codex' } };
        expect(transcriptHarnessSwitchKey(harnessSwitch, true)).to.not.equal(transcriptHarnessSwitchKey(harnessSwitch, false));
        expect(transcriptHarnessSwitchKey(harnessSwitch, false)).to.not.equal(
            transcriptHarnessSwitchKey({ ...harnessSwitch, from: { agentId: 'claude', model: sonnet } }, false),
        );
    });
});
