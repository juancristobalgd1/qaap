// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { toConversationSummary, type QaapAgentConversation } from './qaap-agent-conversation';

/** A conversation whose last turn left an agent reply that still stores a quota error. */
function conversationWithStaleError(verdict: { taskState: string } | undefined): QaapAgentConversation {
    return {
        id: 'conv-1',
        cwd: '/repo',
        agentId: 'opencode',
        title: 'hola',
        status: 'failed',
        createdAt: 1,
        updatedAt: 2,
        messages: [
            { id: 'u1', role: 'user', content: 'hola', createdAt: 1, turnVerdict: verdict },
            {
                id: 'a1',
                role: 'agent',
                content: '¡Hola! ¿En qué puedo ayudarte con el proyecto esor-vite?',
                createdAt: 2,
                error: 'This model has reached its quota. Switch model or effort in the composer, or wait until the limit resets.',
                traceEvents: [{ type: 'assistant_text', id: 't1', content: '¡Hola!', status: 'completed' }],
            },
        ],
    } as unknown as QaapAgentConversation;
}

describe('conversation summary of a settled turn', () => {

    it('a completed turn with a stale stored error is neither a failed row nor a failed conversation', () => {
        const summary = toConversationSummary(conversationWithStaleError({ taskState: 'completed' }));
        expect(summary.lastMessageError).to.equal(undefined);
        expect(summary.status).to.equal('idle');
    });

    it('a failed turn keeps its error and the failed status', () => {
        const summary = toConversationSummary(conversationWithStaleError({ taskState: 'failed' }));
        expect(summary.lastMessageError).to.contain('reached its quota');
        expect(summary.status).to.equal('failed');
    });
});
