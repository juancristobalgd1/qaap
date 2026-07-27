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
import type { QaapAgentConversation, QaapAgentConversationEvent, QaapAgentMessage } from '../common/qaap-agent-conversation';
import type { QaapAgentTask, QaapCreateAgentTaskQaiqModel, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

/**
 * Marker pushed into the same log as the SSE events so the ORDER of "user message frame" vs
 * "agent process spawned" is assertable: the user bubble must reach every open tab before the
 * (potentially slow) spawn, and it must already carry its provenance when it does.
 */
type RecordedEvent = QaapAgentConversationEvent | { readonly type: 'spawn'; readonly taskId: string };

class TestableQaapAgentConversationStore extends QaapAgentConversationStore {
    /** Everything that would have gone out over SSE, in emission order. */
    readonly emitted: RecordedEvent[] = [];

    protected override isDirectory(): boolean {
        return true;
    }

    protected override async persist(): Promise<void> { /* no-op */ }
    protected override async restoreFromDisk(): Promise<void> { /* no-op */ }
    protected override fire(event: QaapAgentConversationEvent): void {
        this.emitted.push(event);
    }
    protected override startTurnWatchdog(): void { /* no-op */ }

    /** The SSE `message` frames carrying the given message id, in emission order. */
    messageFrames(messageId: string): QaapAgentMessage[] {
        return this.emitted
            .filter((event): event is Extract<QaapAgentConversationEvent, { type: 'message' }> => event.type === 'message')
            .filter(event => event.message.id === messageId)
            .map(event => event.message);
    }

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
        turnAgentId: string,
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
                turnAgentId: string,
                startSha?: string,
            ): boolean;
        }).maybeRetryTurnWithFallbackModel(
            conversationId,
            userMessageId,
            agentMessageId,
            task,
            conv,
            agentMessage,
            turnAgentId,
            startSha,
        );
    }
}

/** 'qaiq' is the one built-in agent id that supports a model picker via the Settings BYOK catalog. */
const QAIQ_AGENT_ID = 'qaiq';
/** 'shell' is the canonical agent WITHOUT a model picker: it execs a command, no model runs. */
const SHELL_AGENT_ID = 'shell';

function installFakes(
    store: TestableQaapAgentConversationStore,
    createImpl: (request: QaapCreateAgentTaskRequest, owner?: string) => QaapAgentTask,
): void {
    Object.assign(store, {
        streamMetrics: { recordLatencyMark: () => undefined },
        taskRunner: {
            defaultAgent: () => QAIQ_AGENT_ID,
            normalizeAgentId: (agentId: string) => {
                const normalized = agentId?.toLowerCase();
                return normalized === QAIQ_AGENT_ID || normalized === SHELL_AGENT_ID ? normalized : undefined;
            },
            create: (request: QaapCreateAgentTaskRequest, owner?: string) => {
                const task = createImpl(request, owner);
                store.emitted.push({ type: 'spawn', taskId: task.id });
                return task;
            },
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
        const retried = store.retryWithFallbackModel(
            conversationId,
            userMessageId,
            undefined,
            failedTask,
            conv,
            undefined,
            QAIQ_AGENT_ID,
        );
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
            .to.equal('task-1');
        expect(updated.agentModel, 'the conversation-level model also advances to the fallback')
            .to.deep.equal(updatedUserMessage.turnAgentModel);

        // ...and the re-attribution has to LEAVE the backend. The `updated` summary carries no
        // messages (toConversationSummary), so a tab that is not the one polling would keep
        // badging the failed model forever unless the re-sealed user message is emitted too.
        const frames = store.messageFrames(userMessageId);
        expect(frames, 'the re-sealed user message is pushed over SSE, not just mutated in memory')
            .to.have.length(1);
        expect(frames[0].turnAgentModel, 'the emitted frame carries the fallback model')
            .to.deep.equal(updatedUserMessage.turnAgentModel);
        expect(frames[0].turnAgentId, 'the emitted frame keeps the agent attribution').to.equal(QAIQ_AGENT_ID);
    });

    it('retries the owning turn when a peer agent changed the picker and appended the tail', () => {
        const store = new TestableQaapAgentConversationStore();
        const originalModel: QaapCreateAgentTaskQaiqModel = {
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'some-vendor/flaky-model',
        };
        const spawnedRequests: QaapCreateAgentTaskRequest[] = [];
        installFakes(store, request => {
            spawnedRequests.push(request);
            return {
                id: 'fallback-task',
                title: request.title ?? '',
                command: request.command ?? '',
                cwd: request.cwd,
                state: 'running',
                createdAt: 3,
            };
        });
        const conv: QaapAgentConversation = {
            id: 'interleaved',
            cwd: '/repo',
            agentId: SHELL_AGENT_ID,
            title: 'Interleaved retry',
            status: 'streaming',
            createdAt: 0,
            updatedAt: 2,
            agentModel: originalModel,
            qaiqModel: originalModel,
            messages: [
                {
                    id: 'qaiq-user',
                    role: 'user',
                    content: 'Fix the flaky test',
                    createdAt: 0,
                    taskId: 'failed-task',
                    turnAgentId: QAIQ_AGENT_ID,
                    turnAgentModel: originalModel,
                },
                {
                    id: 'shell-user',
                    role: 'user',
                    content: 'git status',
                    createdAt: 1,
                    taskId: 'shell-task',
                    turnAgentId: SHELL_AGENT_ID,
                },
                {
                    id: 'shell-agent',
                    role: 'agent',
                    content: 'working tree clean',
                    createdAt: 2,
                    runUserMessageId: 'shell-user',
                    runActive: true,
                },
            ],
        };
        store.seed(conv);

        const retried = store.retryWithFallbackModel(
            conv.id,
            'qaiq-user',
            undefined,
            { id: 'failed-task', title: '', command: '', cwd: conv.cwd, state: 'failed', createdAt: 0 },
            conv,
            undefined,
            QAIQ_AGENT_ID,
        );

        expect(retried).to.equal(true);
        expect(spawnedRequests).to.have.length(1);
        expect(spawnedRequests[0].agent).to.equal(QAIQ_AGENT_ID);
        expect(spawnedRequests[0].prompt).to.match(/latest user message:[\s\S]*Fix the flaky test/i);
        expect(store.get(conv.id)?.agentId, 'the peer-selected conversation picker remains shell').to.equal(SHELL_AGENT_ID);
        expect(store.get(conv.id)?.messages.find(message => message.id === 'qaiq-user')?.turnAgentModel)
            .to.not.deep.equal(originalModel);
    });

    it('emits the user-message frame ALREADY sealed, and before the agent process is spawned', () => {
        const store = new TestableQaapAgentConversationStore();
        const pickedModel: QaapCreateAgentTaskQaiqModel = {
            provider: 'anthropic',
            vendor: 'anthropic',
            modelId: 'claude-4-sonnet',
        };
        installFakes(store, request => ({
            id: 'task-1',
            title: request.title ?? '',
            command: request.command ?? '',
            cwd: request.cwd,
            state: 'running',
            createdAt: 1,
        }));

        const conv = store.create({
            cwd: '/repo',
            agent: QAIQ_AGENT_ID,
            message: 'Fix the flaky test',
            agentModel: pickedModel,
        }, 'alice');
        const userMessageId = conv.messages[0].id;

        // 1. Provenance travels on the wire, not only in the HTTP response of the POST. Every other
        //    open tab only ever sees these frames.
        const frames = store.messageFrames(userMessageId);
        expect(frames, 'the user turn is announced over SSE').to.have.length.greaterThan(0);
        expect(frames[0].turnAgentId, 'the FIRST frame is already sealed with the agent').to.equal(QAIQ_AGENT_ID);
        expect(frames[0].turnAgentModel, 'the FIRST frame is already sealed with the model').to.deep.equal(pickedModel);

        // 2. ...without paying for it in perceived latency: the bubble is announced before the
        //    (potentially slow) agent spawn, never after it.
        const firstFrameIndex = store.emitted.findIndex(
            event => event.type === 'message' && event.message.id === userMessageId,
        );
        const spawnIndex = store.emitted.findIndex(event => event.type === 'spawn');
        expect(spawnIndex, 'the fake runner recorded the spawn').to.be.greaterThan(-1);
        expect(firstFrameIndex, 'the user bubble is emitted BEFORE the agent process is spawned')
            .to.be.lessThan(spawnIndex);

        // 3. And no client-visible churn: the common path emits the user row exactly once, so a
        //    replace-by-id merge (QaapThreadStore.appendLiveMessage) can never un-seal the badge.
        expect(frames, 'exactly one user-message frame on the happy path').to.have.length(1);
    });

    it('seals no model when the turn is taken by an agent that has no model picker', () => {
        const store = new TestableQaapAgentConversationStore();
        const pickedModel: QaapCreateAgentTaskQaiqModel = {
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
        };
        installFakes(store, request => ({
            id: 'task-1',
            title: request.title ?? '',
            command: request.command ?? '',
            cwd: request.cwd,
            state: 'running',
            createdAt: 1,
        }));

        // A model-picking conversation (the model is pinned on the conversation) that receives a
        // '@shell' turn: the shell agent execs a command, no model of ours runs it. Sealing the
        // conversation model here would badge the exec with a model that never executed.
        const conversationId = 'conv-shell';
        store.seed({
            id: conversationId,
            cwd: '/repo',
            agentId: QAIQ_AGENT_ID,
            title: 'Mixed session',
            status: 'idle',
            createdAt: 0,
            updatedAt: 0,
            agentModel: pickedModel,
            qaiqModel: pickedModel,
            messages: [],
        });

        const next = store.postUserMessage(conversationId, '@shell ls -la');
        const userMessage = next.messages[next.messages.length - 1];
        expect(userMessage.turnAgentId, 'the shell agent took the turn').to.equal(SHELL_AGENT_ID);
        expect(userMessage.turnAgentModel, 'no model is sealed for an agent without a model picker')
            .to.equal(undefined);
        expect(store.messageFrames(userMessage.id)[0]?.turnAgentModel, 'and the SSE frame does not carry one either')
            .to.equal(undefined);
        expect(next.agentModel, 'the conversation keeps its pinned model for the next qaiq turn')
            .to.deep.equal(pickedModel);
    });
});
