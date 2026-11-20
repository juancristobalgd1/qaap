// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { conversationToSummary, type QaapAgentConversationDTO } from './qaap-agent-conversation-client';

/** The client summary must carry the backend's settled task totals, not numbers parsed from message text. */
describe('conversationToSummary task totals', () => {
    const base = {
        id: 'conversation-1',
        cwd: '/workspace/project',
        agentId: 'codex',
        title: 'Todo app',
        status: 'idle',
        createdAt: 1,
        updatedAt: 10,
        messages: [
            { id: 'u1', role: 'user', content: 'build it', createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'Done. 2 files changed, 185 insertions(+), 0 deletions(-)', createdAt: 5 },
        ],
        checkpoints: [
            { id: 'c0', messageId: 'u1', label: 'Before', commit: 'base0', ref: 'refs/qaap/x', capturedAt: 1, kind: 'pre-turn' },
        ],
    } as unknown as QaapAgentConversationDTO;

    it('uses the settled backend totals over a count parsed from the agent text', () => {
        const summary = conversationToSummary({ ...base, gitDiffAdded: 196, gitDiffRemoved: 0 });
        expect(summary.linesAdded).to.equal(196);
        expect(summary.linesRemoved).to.equal(0);
    });

    it('falls back to the text-parsed count only when the backend has no settled totals', () => {
        const summary = conversationToSummary(base);
        expect(summary.linesAdded).to.equal(185);
    });

    it('names the task baseline, so the live Changes total can be matched to this task', () => {
        expect(conversationToSummary({ ...base, gitDiffAdded: 196 }).baselineCommit).to.equal('base0');
        expect(conversationToSummary(base).baselineCommit).to.equal('base0');
    });
});
