// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isSuccessfulAgentMessageInConversation, isSuccessfulAgentTurn } from './qaap-agent-turn-outcome';

describe('settled agent turn outcome', () => {

    const reply = { content: '¡Hola! ¿En qué puedo ayudarte?', segments: [{ type: 'text', content: '¡Hola!' }] };
    const traced = { content: '', traceEvents: [{ type: 'assistant_text', status: 'completed', content: '¡Hola!' }] };
    const empty = { content: '', segments: [], traceEvents: [] };

    it('a completed turn with real content succeeds, even when it carries a stored error', () => {
        expect(isSuccessfulAgentTurn({ verdict: { taskState: 'completed' } }, reply)).to.equal(true);
    });

    it('a failed turn keeps its failure, whatever its content', () => {
        expect(isSuccessfulAgentTurn({ verdict: { taskState: 'failed' } }, reply)).to.equal(false);
        expect(isSuccessfulAgentTurn({ verdict: { taskState: 'interrupted' } }, reply)).to.equal(false);
    });

    it('a turn with no verdict follows its exit code', () => {
        expect(isSuccessfulAgentTurn({ exitCode: 0 }, reply)).to.equal(true);
        expect(isSuccessfulAgentTurn({ exitCode: 1 }, reply)).to.equal(false);
        expect(isSuccessfulAgentTurn({ verdict: { closingReport: { exitCode: 0 } } }, reply)).to.equal(true);
    });

    it('without a verdict or exit code, a completed assistant text in the trace is the success', () => {
        expect(isSuccessfulAgentTurn({}, traced)).to.equal(true);
    });

    it('no agent output means no success to show, so the stored error stays', () => {
        expect(isSuccessfulAgentTurn({ verdict: { taskState: 'completed' } }, empty)).to.equal(false);
        expect(isSuccessfulAgentTurn({ exitCode: 0 }, empty)).to.equal(false);
    });

    it('finds the verdict of the turn a conversation agent message belongs to', () => {
        const messages = [
            { id: 'u1', role: 'user', turnVerdict: { taskState: 'completed' } },
            { id: 'a1', role: 'agent', content: '¡Hola!', error: 'x' },
        ];
        expect(isSuccessfulAgentMessageInConversation(messages, { id: 'a1', role: 'agent', ...reply })).to.equal(true);
        const failed = [{ id: 'u2', role: 'user', turnVerdict: { taskState: 'failed' } }, { id: 'a2', role: 'agent' }];
        expect(isSuccessfulAgentMessageInConversation(failed, { id: 'a2', role: 'agent', ...reply })).to.equal(false);
    });
});
