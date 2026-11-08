// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import { QAAP_VISUAL_REPAIR_REQUIRED_MARKER } from '@theia/qaap-shared-core/lib/common/qaap-visual-verification';
import { continueVisualRepairLoopExtracted, startVisualRepairProposalExtracted } from './qaap-agent-conversation-store-streaming2';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

const userMessage: QaapAgentMessage = { id: 'u1', role: 'user', content: 'Build the app', createdAt: 1, taskId: 't1' } as QaapAgentMessage;
const evidence = (): QaapAgentMessage => ({
    id: 'a1',
    role: 'agent',
    content: `Failed render\n\n${QAAP_VISUAL_REPAIR_REQUIRED_MARKER}\nFix it.`,
    createdAt: 2,
} as QaapAgentMessage);

function conversation(target: QaapAgentMessage): QaapAgentConversation {
    return {
        id: 'c1',
        cwd: '/repo',
        agentId: 'qaiq',
        title: 'Task',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
        messages: [userMessage, target],
    } as unknown as QaapAgentConversation;
}

interface FakeContext {
    readonly ctx: QaapAgentConversationStoreContext;
    readonly posted: string[];
    readonly conversations: Map<string, QaapAgentConversation>;
}

function fakeContext(initial: QaapAgentConversation): FakeContext {
    const conversations = new Map<string, QaapAgentConversation>([[initial.id, initial]]);
    const posted: string[] = [];
    const ctx = {
        conversations,
        resolveVisualRepairSourceUserMessage: () => userMessage,
        countVisualRepairAttempts: () => 0,
        hasLoopSpawnBudget: () => true,
        recordLoopSpawn: () => undefined,
        buildVisualRepairPrompt: () => 'repair prompt',
        publishFinalizedAgentMessage: () => undefined,
        fire: () => undefined,
        persist: async () => undefined,
        drainPendingMessages: () => undefined,
        postUserMessage: (conversationId: string, content: string) => {
            posted.push(content);
            const conv = conversations.get(conversationId)!;
            const next = { ...conv, status: 'streaming' } as QaapAgentConversation;
            conversations.set(conversationId, next);
            return next;
        },
    } as unknown as QaapAgentConversationStoreContext;
    Object.assign(ctx, {
        continueVisualRepairLoop: (conversationId: string, sourceAgentMessageId: string, options?: { readonly propose?: boolean }) =>
            continueVisualRepairLoopExtracted(ctx, conversationId, sourceAgentMessageId, options),
    });
    return { ctx, posted, conversations };
}

describe('visual repair proposal (store)', () => {
    it('records the offer on the evidence message and starts no repair turn', async () => {
        const { ctx, posted, conversations } = fakeContext(conversation(evidence()));
        const result = await continueVisualRepairLoopExtracted(ctx, 'c1', 'a1', { propose: true });
        expect(posted).to.deep.equal([]);
        const offered = result?.messages.find(message => message.id === 'a1');
        expect(offered?.visualRepairProposedAt).to.be.a('number');
        expect(conversations.get('c1')?.messages.find(message => message.id === 'a1')?.visualRepairProposedAt).to.be.a('number');
    });

    it('does not offer the same proposal twice', async () => {
        const once = conversation({ ...evidence(), visualRepairProposedAt: 9 } as QaapAgentMessage);
        const { ctx, posted } = fakeContext(once);
        await continueVisualRepairLoopExtracted(ctx, 'c1', 'a1', { propose: true });
        expect(posted).to.deep.equal([]);
    });

    it('starts the repair turn only when the user accepted an open proposal', async () => {
        const proposed = conversation({ ...evidence(), visualRepairProposedAt: 9 } as QaapAgentMessage);
        const { ctx, posted } = fakeContext(proposed);
        const started = await startVisualRepairProposalExtracted(ctx, 'c1', 'a1');
        expect(started).to.not.equal(undefined);
        expect(posted).to.deep.equal(['repair prompt']);
    });

    it('refuses to start a repair from evidence without an open proposal', async () => {
        const { ctx, posted } = fakeContext(conversation(evidence()));
        const started = await startVisualRepairProposalExtracted(ctx, 'c1', 'a1');
        expect(started).to.equal(undefined);
        expect(posted).to.deep.equal([]);
    });
});
