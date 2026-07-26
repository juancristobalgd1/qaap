// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Backend half of the turn-provenance regression guard (commit 8a5e9c286): the
// user message that starts a turn is sealed with turnAgentId/turnAgentModel
// alongside the taskId it already carried, and a turn re-spawned on a fallback
// model (maybeRetryTurnWithFallbackModel) is re-attributed to the model that
// ACTUALLY ran it, not the one originally picked -- this is the exact
// mechanism the mobile-shell provenance badge reads from
// (resolveTurnProvenance -> resolveRunUserMessageId -> userMessage.turnAgentModel).
//
// Uses the same lightweight harness as the neighboring
// qaap-agent-conversation-store-owner.spec.ts / -spawn-budget.spec.ts specs:
// a subclass with disk/SSE/watchdog stubbed out and a fake QaapAgentTaskRunner,
// no Inversify container needed.

import { expect } from 'chai';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import type { QaapAgentTask, QaapCreateAgentTaskQaiqModel, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

class TestableQaapAgentConversationStore extends QaapAgentConversationStore {
    protected override isDirectory(): boolean {
        return true;
    }

    protected override async persist(): Promise<void> { /* no-op */ }
    protected override async restoreFromDisk(): Promise<void> { /* no-op */ }
    protected override fire(): void { /* no-op */ }
    protected override startTurnWatchdog(): void { /* no-op */ }

    seed(conversation: QaapAgentConversation): void {
        this.conversations.set(conversation.id, conversation);
    }

    /** Exposes the protected fallback-retry method the same way the neighboring spawn-budget spec exposes `hasLoopSpawnBudget`. */
    retryWithFallbackModel(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        startSha?: string,
    ): boolean {
        return (this as unknown as {
            maybeRetryTurnWithFallbackModel(
                conversationId: string,
                userMessageId: string,
                agentMessageId: string | undefined,
                task: QaapAgentTask,
                conv: QaapAgentConversation,
                agentMessage: QaapAgentMessage | undefined,
                startSha?: string,
            ): boolean;
        }).maybeRetryTurnWithFallbackModel(conversationId, userMessageId, agentMessageId, task, conv, agentMessage, startSha);
    }
}

/** 'qaiq' is the one built-in agent id that supports a model picker via the Settings BYOK catalog. */
const QAIQ_AGENT_ID = 'qaiq';

function installFakes(
    store: TestableQaapAgentConversationStore,
    createImpl: (request: QaapCreateAgentTaskRequest, owner?: string) => QaapAgentTask,
): void {
    Object.assign(store, {
        streamMetrics: { recordLatencyMark: () => undefined },
        taskRunner: {
            defaultAgent: () => QAIQ_AGENT_ID,
            normalizeAgentId: (agentId: string) => agentId === QAIQ_AGENT_ID ? QAIQ_AGENT_ID : undefined,
            create: createImpl,
            // buildPrompt -> appendTeamDelegation calls this to list delegation targets.
            listAgents: () => [{ id: QAIQ_AGENT_ID, label: 'QAIQ' }],
        },
    });
}

describe('turn-provenance sealing and fallback-model re-attribution (backend half of the badge, #8a5e9c286)', () => {

    it('postUserMessage seals turnAgentId and turnAgentModel on the user message that started the turn', () => {
        const store = new TestableQaapAgentConversationStore();
        const pickedModel: QaapCreateAgentTaskQaiqModel = {
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'anthropic/claude-haiku-4.5',
        };
        installFakes(store, (request, owner) => ({
            id: 'task-1',
            title: request.title ?? '',
            command: request.command ?? '',
            cwd: request.cwd,
            state: 'running',
            createdAt: 1,
            ownerLogin: owner,
            // agentId deliberately undefined: buildAgentCommand resolves it asynchronously, long
            // after this synchronous call returns -- postUserMessage must not depend on it.
        }));

        const conv = store.create({
            cwd: '/repo',
            agent: QAIQ_AGENT_ID,
            message: 'Fix the flaky test',
            agentModel: pickedModel,
        }, 'alice');

        expect(conv.messages, 'exactly one message: the seeded user turn').to.have.length(1);
        const userMessage = conv.messages[0];
        expect(userMessage.role).to.equal('user');
        expect(userMessage.taskId, 'taskId is sealed alongside the provenance fields').to.equal('task-1');
        expect(userMessage.turnAgentId, 'turnAgentId records which agent actually drove the turn').to.equal(QAIQ_AGENT_ID);
        expect(userMessage.turnAgentModel, 'turnAgentModel records the model picked for the turn')
            .to.deep.equal(pickedModel);
    });

    it('a turn retried on a fallback model is attributed to the model that ACTUALLY ran it, not the original pick', () => {
        const store = new TestableQaapAgentConversationStore();
        const originalModel: QaapCreateAgentTaskQaiqModel = {
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'some-vendor/flaky-model',
        };
        let spawnedRequests: QaapCreateAgentTaskRequest[] = [];
        installFakes(store, request => {
            spawnedRequests.push(request);
            return {
                id: `task-${spawnedRequests.length}`,
                title: request.title ?? '',
                command: request.command ?? '',
                cwd: request.cwd,
                state: 'running',
                createdAt: spawnedRequests.length,
            };
        });

        const conversationId = 'conv-1';
        const userMessageId = 'user-1';
        const conv: QaapAgentConversation = {
            id: conversationId,
            cwd: '/repo',
            agentId: QAIQ_AGENT_ID,
            title: 'Flaky turn',
            status: 'streaming',
            createdAt: 0,
            updatedAt: 0,
            agentModel: originalModel,
            qaiqModel: originalModel,
            messages: [
                {
                    id: userMessageId,
                    role: 'user',
                    content: 'Fix the flaky test',
                    createdAt: 0,
                    taskId: 'task-0',
                    turnAgentId: QAIQ_AGENT_ID,
                    turnAgentModel: originalModel,
                },
            ],
        };
        store.seed(conv);

        // agentMessage: undefined + task.state 'failed' => agentTurnHasRetryableEmptyOutput(undefined)
        // is true, which is the simplest real trigger for the retry path (a turn that produced
        // nothing at all before the CLI process died).
        const failedTask: QaapAgentTask = {
            id: 'task-0', title: '', command: '', cwd: '/repo', state: 'failed', createdAt: 0,
        };
        const retried = store.retryWithFallbackModel(conversationId, userMessageId, undefined, failedTask, conv, undefined);
        expect(retried, 'a turn with no output and a failed task must trigger the fallback-model retry').to.equal(true);
        expect(spawnedRequests, 'exactly one fallback re-spawn happened').to.have.length(1);

        const updated = store.get(conversationId)!;
        const updatedUserMessage = updated.messages.find(message => message.id === userMessageId)!;

        // The whole point of the feature: the badge reads turnAgentModel off THIS message, so it
        // must reflect the model that is actually running now, not the one that just failed.
        expect(updatedUserMessage.turnAgentModel, 'turnAgentModel is rewritten to the fallback model that is actually running')
            .to.not.deep.equal(originalModel);
        expect(updatedUserMessage.turnAgentModel?.modelId).to.equal('nvidia/nemotron-3-super-120b-a12b:free');
        expect(updatedUserMessage.turnAgentId, 'turnAgentId is preserved across the retry').to.equal(QAIQ_AGENT_ID);
        expect(updatedUserMessage.taskId, 'taskId now points at the retry task, not the failed one')
            .to.equal(spawnedRequests.length === 1 ? 'task-1' : updatedUserMessage.taskId);
        expect(updated.agentModel, 'the conversation-level model also advances to the fallback')
            .to.deep.equal(updatedUserMessage.turnAgentModel);
    });
});
