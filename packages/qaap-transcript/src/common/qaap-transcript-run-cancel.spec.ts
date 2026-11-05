// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { appendOptimisticStoppedTurnRow, applyOptimisticRunCancelToConversation } from './qaap-transcript-run-cancel';

function conversationWithTwoRuns(): QaapAgentConversationDTO {
    return {
        id: 'c1',
        cwd: '/tmp/project',
        agentId: 'claude',
        title: 'Session',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 2,
        messages: [
            { id: 'user-1', role: 'user', content: 'first', createdAt: 1 },
            { id: 'agent-1', role: 'agent', content: '', createdAt: 2, runActive: true },
            { id: 'user-2', role: 'user', content: 'second', createdAt: 3 },
            { id: 'agent-2', role: 'agent', content: 'done', createdAt: 4, runActive: true },
        ],
    } as QaapAgentConversationDTO;
}

function runCancelledRows(conv: QaapAgentConversationDTO, messageId: string): number {
    const message = conv.messages.find(candidate => candidate.id === messageId);
    return (message?.traceEvents ?? []).filter(event => event.type === 'run_cancelled').length;
}

describe('applyOptimisticRunCancelToConversation', () => {

    it('adds one run_cancelled row to every live agent message and clears runActive', () => {
        const next = applyOptimisticRunCancelToConversation(conversationWithTwoRuns());

        expect(runCancelledRows(next, 'agent-1')).to.equal(1);
        expect(runCancelledRows(next, 'agent-2')).to.equal(1);
        expect(next.messages.every(message => !message.runActive)).to.equal(true);
    });

    it('is idempotent: a second application keeps a single run_cancelled row', () => {
        const once = applyOptimisticRunCancelToConversation(conversationWithTwoRuns());
        const twice = applyOptimisticRunCancelToConversation(once);

        expect(runCancelledRows(twice, 'agent-1')).to.equal(1);
        expect(runCancelledRows(twice, 'agent-2')).to.equal(1);
    });

    it('narrows a per-run Stop to the named message and leaves the other run live', () => {
        const next = applyOptimisticRunCancelToConversation(conversationWithTwoRuns(), 'agent-2');

        expect(runCancelledRows(next, 'agent-2')).to.equal(1);
        expect(runCancelledRows(next, 'agent-1')).to.equal(0);
        expect(next.messages.find(message => message.id === 'agent-1')?.runActive).to.equal(true);
    });

    it('does not mutate the input conversation', () => {
        const source = conversationWithTwoRuns();
        applyOptimisticRunCancelToConversation(source);

        expect(source.messages[1].runActive).to.equal(true);
        expect(source.messages[1].traceEvents).to.equal(undefined);
    });

    it('appends a stopped-turn row when the local copy has no agent row yet', () => {
        const conv = { id: 'c1', cwd: '/tmp', agentId: 'pi', title: 'T', status: 'idle', createdAt: 1, updatedAt: 2,
            messages: [{ id: 'user-1', role: 'user', content: 'hola', createdAt: 1 }] } as unknown as QaapAgentConversationDTO;
        const stopped = appendOptimisticStoppedTurnRow(conv, 5);
        expect(stopped.messages).to.have.length(2);
        expect(stopped.messages[1].role).to.equal('agent');
        expect(stopped.messages[1].traceEvents?.some(e => e.type === 'run_cancelled')).to.equal(true);
    });

    it('leaves a conversation unchanged when its last message is an agent row', () => {
        const conv = { id: 'c1', cwd: '/tmp', agentId: 'pi', title: 'T', status: 'idle', createdAt: 1, updatedAt: 2,
            messages: [{ id: 'user-1', role: 'user', content: 'hola', createdAt: 1 }, { id: 'agent-1', role: 'agent', content: 'ok', createdAt: 2 }] } as unknown as QaapAgentConversationDTO;
        expect(appendOptimisticStoppedTurnRow(conv)).to.equal(conv);
    });
});
