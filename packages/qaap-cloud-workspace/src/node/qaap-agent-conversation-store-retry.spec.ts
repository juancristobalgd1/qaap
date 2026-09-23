// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task';
import { retryExtracted } from './qaap-agent-conversation-store-render2';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

describe('qaap agent conversation retry', () => {
    it('retries with the failed turn agent and model instead of the current conversation picker', () => {
        const failedModel: QaapCreateAgentTaskQaiqModel = {
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'failed-model',
        };
        const currentModel: QaapCreateAgentTaskQaiqModel = {
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'current-picker-model',
        };
        const conversation: QaapAgentConversation = {
            id: 'conversation-1',
            cwd: '/repo',
            agentId: 'codex',
            agentModel: currentModel,
            title: 'Retry identity',
            status: 'failed',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'user-1',
                role: 'user',
                content: 'Fix the failing test',
                createdAt: 1,
                turnAgentId: 'qaiq',
                turnAgentModel: failedModel,
                error: 'Agent failed (exit 1).',
            }],
        };
        const calls: unknown[][] = [];
        const ctx = {
            conversations: new Map([[conversation.id, conversation]]),
            fire: (): void => undefined,
            postUserMessage: (...args: unknown[]): QaapAgentConversation => {
                calls.push(args);
                return conversation;
            },
        };

        // Narrow unit test: `retryExtracted` only touches these three members, so the fake
        // implements a slice of the context rather than the whole 100+ member surface.
        retryExtracted(ctx as unknown as QaapAgentConversationStoreContext, conversation.id);

        expect(calls).to.have.length(1);
        expect(calls[0][2]).to.equal('qaiq');
        expect(calls[0][3]).to.deep.equal(failedModel);
        expect(calls[0][3]).not.to.deep.equal(currentModel);
    });
});
