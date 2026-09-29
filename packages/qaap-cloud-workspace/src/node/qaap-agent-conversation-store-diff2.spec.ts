// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import { rewindToMessageExtracted } from './qaap-agent-conversation-store-diff2';
import type { QaapGitRunResult } from './qaap-agent-conversation-store-git';

describe('qaap-agent-conversation-store-diff2 rewind', () => {

    const conversation: QaapAgentConversation = {
        id: 'conv-1',
        cwd: '/repo',
        messages: [
            { id: 'u1', role: 'user', content: 'first', createdAt: 1, taskId: 't1' },
            { id: 'a1', role: 'agent', content: 'ok', createdAt: 2 },
            { id: 'u2', role: 'user', content: 'second', createdAt: 3, taskId: 't2' },
        ],
        checkpoints: [{ id: 'c1', messageId: 'u1', label: 'Turn 1', commit: 'abc', ref: 'refs/qaap/1', capturedAt: 1 }],
    } as unknown as QaapAgentConversation;

    function contextWith(repositoryStatus: number): { ctx: QaapAgentConversationStoreContext; cancelled: string[] } {
        const cancelled: string[] = [];
        const ctx = {
            conversations: new Map([[conversation.id, conversation]]),
            taskRunner: { cancel: (taskId: string) => cancelled.push(taskId) },
            agentStreamByTaskId: new Map(),
            agUiStreamByTaskId: new Map(),
            taskToConversation: new Map(),
            runSerializedGit: <T>(_cwd: string, job: () => Promise<T>): Promise<T> => job(),
            mutatingGit: async (): Promise<QaapGitRunResult> => ({ status: repositoryStatus, stdout: '', stderr: '' }),
            captureCheckpoint: async () => undefined,
            fire: () => undefined,
            persist: async () => undefined,
        } as unknown as QaapAgentConversationStoreContext;
        return { ctx, cancelled };
    }

    it('does not cancel running turns when the restore is rejected before any change', async () => {
        const { ctx, cancelled } = contextWith(128);
        let failure: unknown;
        await rewindToMessageExtracted(ctx, conversation.id, 'u2').catch(error => { failure = error; });
        expect(failure).to.be.instanceOf(Error);
        expect(cancelled).to.deep.equal([]);
        expect(ctx.conversations.get(conversation.id)?.messages).to.have.length(3);
    });

    it('cancels the rewound turns once the restore is validated', async () => {
        const { ctx, cancelled } = contextWith(0);
        const next = await rewindToMessageExtracted(ctx, conversation.id, 'u2');
        expect(cancelled).to.deep.equal(['t2']);
        expect(next?.messages.map(message => message.id)).to.deep.equal(['u1', 'a1']);
    });
});
