// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation, QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import { updateExtracted } from './qaap-agent-conversation-store-streaming2';
import { recordTaskPullRequestExtracted } from './qaap-agent-conversation-store-task-pr';

function fakeContext(conv: QaapAgentConversation): { ctx: QaapAgentConversationStoreContext; fired: QaapAgentConversationEvent[] } {
    const fired: QaapAgentConversationEvent[] = [];
    const conversations = new Map([[conv.id, conv]]);
    const ctx = {
        conversations,
        fire: (event: QaapAgentConversationEvent) => fired.push(event),
        persist: async () => undefined,
        publishFinalizedAgentMessage: () => undefined,
    } as unknown as QaapAgentConversationStoreContext;
    return { ctx, fired };
}

const CONV: QaapAgentConversation = {
    id: 'c1', cwd: '/repo', agentId: 'qaiq', title: 'T', status: 'idle', createdAt: 0, updatedAt: 0,
    messages: [{ id: 'u1', role: 'user', content: 'x', createdAt: 1 }, { id: 'a1', role: 'agent', content: 'done', createdAt: 2 }],
};

describe('task pull request conversation state', () => {

    it('PATCH taskPullRequestEnabled stores the opt-out and clears it again', () => {
        const { ctx, fired } = fakeContext(CONV);
        const off = updateExtracted(ctx, 'c1', { taskPullRequestEnabled: false });
        expect(off?.taskPullRequestEnabled).to.equal(false);
        expect(fired.at(-1)).to.deep.include({ type: 'updated' });
        expect((fired.at(-1) as { conversation: { taskPullRequestEnabled?: boolean } }).conversation.taskPullRequestEnabled).to.equal(false);
        const on = updateExtracted(ctx, 'c1', { taskPullRequestEnabled: true });
        expect(on?.taskPullRequestEnabled).to.equal(undefined);
    });

    it('records the task PR, links the thread and adds a timeline note', () => {
        const { ctx } = fakeContext(CONV);
        const next = recordTaskPullRequestExtracted(ctx, 'c1', {
            owner: 'acme', repo: 'demo', branch: 'qaap/task/c1', state: 'awaiting-consent', updatedAt: 1,
        }, { traceNote: 'PR ready: allow Qaap to open PRs on acme/demo?' });
        expect(next?.taskPullRequest?.state).to.equal('awaiting-consent');
        expect(next?.messages[1].traceEvents?.at(-1)).to.deep.include({ type: 'error', message: 'PR ready: allow Qaap to open PRs on acme/demo?' });
    });
});
