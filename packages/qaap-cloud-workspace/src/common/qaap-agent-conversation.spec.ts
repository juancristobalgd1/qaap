// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    conversationNeedsVisualVerificationEvidence,
    resolveEffectiveConversationStatus,
    toConversationSummary,
} from './qaap-agent-conversation';
import type { QaapAgentConversation } from './qaap-agent-conversation';

function conversation(partial: Partial<QaapAgentConversation> & Pick<QaapAgentConversation, 'status'>): QaapAgentConversation {
    return {
        id: 'conv-1',
        cwd: '/workspace',
        agentId: 'codex',
        title: 'Test',
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        ...partial,
    };
}

describe('resolveEffectiveConversationStatus', () => {
    it('keeps streaming while a turn is in flight', () => {
        expect(resolveEffectiveConversationStatus(conversation({ status: 'streaming' }))).to.equal('streaming');
    });

    it('reports failed when a user turn still carries an error', () => {
        const status = resolveEffectiveConversationStatus(conversation({
            status: 'idle',
            messages: [{
                id: 'u1',
                role: 'user',
                content: 'fix it',
                createdAt: 1,
                error: 'Agent failed (exit 1).',
            }],
        }));
        expect(status).to.equal('failed');
    });

    it('surfaces failed in list summaries even when stored status was cleared', () => {
        const summary = toConversationSummary(conversation({
            status: 'idle',
            messages: [
                {
                    id: 'u1',
                    role: 'user',
                    content: 'fix it',
                    createdAt: 1,
                    error: 'Agent failed (exit 1).',
                },
                {
                    id: 'a1',
                    role: 'agent',
                    content: 'log tail',
                    createdAt: 2,
                },
            ],
        }));
        expect(summary.status).to.equal('failed');
    });
});

describe('visualVerificationPending summary flag', () => {
    const uiTurn = (agentContent: string): QaapAgentConversation => conversation({
        status: 'idle',
        messages: [
            { id: 'u1', role: 'user', content: 'Improve the dashboard page layout', createdAt: 1 },
            { id: 'a1', role: 'agent', content: agentContent, createdAt: 2 },
        ],
    });

    it('is set once a UI turn settles without evidence', () => {
        const summary = toConversationSummary(uiTurn('Done, the layout is updated.'));
        expect(summary.visualVerificationPending).to.equal(true);
    });

    it('clears once the reply carries the verification marker', () => {
        const summary = toConversationSummary(uiTurn('Done.\n\n---\n\n[QAAP visual verification]\nEvidence attached.'));
        expect(summary.visualVerificationPending).to.equal(undefined);
    });

    it('is not set while the turn is still streaming', () => {
        const conv = { ...uiTurn('working…'), status: 'streaming' as const };
        expect(conversationNeedsVisualVerificationEvidence(conv)).to.equal(false);
    });

    it('survives a historical message error that keeps the effective status failed', () => {
        const conv = conversation({
            status: 'idle',
            messages: [
                { id: 'u0', role: 'user', content: 'try something', createdAt: 1, error: 'Agent failed (exit 1).' },
                { id: 'u1', role: 'user', content: 'Improve the dashboard page layout', createdAt: 2 },
                { id: 'a1', role: 'agent', content: 'Done, the layout is updated.', createdAt: 3 },
            ],
        });
        const summary = toConversationSummary(conv);
        expect(summary.status).to.equal('failed');
        expect(summary.visualVerificationPending).to.equal(true);
    });

    it('is not set for turns without any UI signal', () => {
        const conv = conversation({
            status: 'idle',
            messages: [
                { id: 'u1', role: 'user', content: 'Summarize the README', createdAt: 1 },
                { id: 'a1', role: 'agent', content: 'Here is the summary.', createdAt: 2 },
            ],
        });
        expect(conversationNeedsVisualVerificationEvidence(conv)).to.equal(false);
    });
});
