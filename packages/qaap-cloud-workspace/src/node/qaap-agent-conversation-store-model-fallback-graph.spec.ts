// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Graph-governed twin of the imperative model-fallback branch (ADR-002 piece 2). With
 * `QAAP_TURN_GRAPH=on`, a retriable turn failure must keep every behavioural contract — curated
 * chain order, shared re-spawn ceiling, quota/non-retriable exclusion, degradation on spawn
 * failure — while the decision becomes the run's `retry:model` edge and the tried-model set
 * becomes the durable `fallback.tried` artifact that survives a backend restart.
 */

import { expect } from 'chai';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import {
    QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT,
    QAAP_CHAT_TURN_WORKFLOW_ID,
} from '../common/qaap-chat-turn-workflow';
import { agentModelKey, buildAgentModelFallbackChain } from '../common/qaap-agent-model-fallback';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapAgentTask, QaapCreateAgentTaskQaiqModel, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';

class TestRunStore extends QaapWorkflowRunStore {
    protected override async persist(): Promise<void> { /* in-memory */ }
}

class TestTaskRunner extends QaapAgentTaskRunner {
    readonly created: QaapCreateAgentTaskRequest[] = [];
    throwOnCreate = false;
    seq = 0;

    override create(request: QaapCreateAgentTaskRequest, _ownerLogin?: string): QaapAgentTask {
        if (this.throwOnCreate) {
            throw new Error('runner refused');
        }
        this.created.push(request);
        return { id: `retry-task-${++this.seq}`, agentId: 'qaiq' } as unknown as QaapAgentTask;
    }

    override cancel(): QaapAgentTask | undefined { return undefined; }
    override list(): QaapAgentTask[] { return []; }
    protected override async persist(): Promise<void> { /* no-op */ }
}

class TestConversationStore extends QaapAgentConversationStore {
    protected override async persist(): Promise<void> { /* no-op */ }
    protected override async restoreFromDisk(): Promise<void> { /* seeded directly */ }
    protected override startTurnWatchdog(): void { /* not under test */ }

    protected override buildTaskCreateRequest(conv: QaapAgentConversation): QaapCreateAgentTaskRequest {
        return { cwd: conv.cwd, prompt: 'retry', agent: conv.agentId } as unknown as QaapCreateAgentTaskRequest;
    }

    configureForTest(taskRunner: QaapAgentTaskRunner, runStore: QaapWorkflowRunStore): void {
        (this as unknown as { sseBatcher: QaapAgentConversationSseBatcher }).sseBatcher =
            new QaapAgentConversationSseBatcher(() => { /* ignore SSE */ });
        (this as unknown as { taskRunner: QaapAgentTaskRunner }).taskRunner = taskRunner;
        (this as unknown as { workflowRuns?: QaapWorkflowRunStore }).workflowRuns = runStore;
    }

    seed(conv: QaapAgentConversation): void {
        (this as unknown as { conversations: Map<string, QaapAgentConversation> }).conversations.set(conv.id, conv);
    }

    retryFallback(conversationId: string, userMessageId: string, agentMessageId: string | undefined,
        task: QaapAgentTask, conv: QaapAgentConversation, agentMessage: QaapAgentMessage | undefined): Promise<boolean> {
        return (this as unknown as {
            maybeRetryTurnWithFallback(
                conversationId: string, userMessageId: string, agentMessageId: string | undefined,
                task: QaapAgentTask, conv: QaapAgentConversation, agentMessage: QaapAgentMessage | undefined,
                turnAgentId: string): Promise<boolean>;
        }).maybeRetryTurnWithFallback(conversationId, userMessageId, agentMessageId, task, conv, agentMessage, 'qaiq');
    }

    spendSpawns(rootId: string, count: number): void {
        for (let i = 0; i < count; i++) {
            (this as unknown as { recordLoopSpawn(id: string): void }).recordLoopSpawn(rootId);
        }
    }

    seedTried(rootId: string, keys: readonly string[]): void {
        (this as unknown as { modelFallbackTriedByUserMessage: Map<string, Set<string>> })
            .modelFallbackTriedByUserMessage.set(rootId, new Set(keys));
    }

    settle(task: QaapAgentTask): void {
        (this as unknown as { settleChatTurnRun(t: QaapAgentTask): void }).settleChatTurnRun(task);
    }
}

const MODEL_ZERO: QaapCreateAgentTaskQaiqModel = { provider: 'openai', vendor: 'openrouter', modelId: 'spec-model-zero' };
const CHAIN = buildAgentModelFallbackChain('qaiq', MODEL_ZERO);

function failedTask(id: string): QaapAgentTask {
    return { id, state: 'failed', agentId: 'qaiq' } as unknown as QaapAgentTask;
}

function retriableConversation(id: string, taskId: string, model: QaapCreateAgentTaskQaiqModel): QaapAgentConversation {
    const now = Date.now();
    return {
        id,
        cwd: '/tmp/project',
        agentId: 'qaiq',
        agentModel: model,
        title: 'Fallback probe',
        status: 'streaming',
        interactionModeId: 'agent',
        createdAt: now - 60_000,
        updatedAt: now,
        messages: [
            { id: `${id}-u1`, role: 'user', content: 'do it', createdAt: now - 60_000, taskId, turnAgentId: 'qaiq', turnAgentModel: model },
            // Empty content → agentTurnHasRetryableEmptyOutput → retriable failed state.
            { id: `${id}-a1`, role: 'agent', content: '', createdAt: now - 59_000, runUserMessageId: `${id}-u1` },
        ],
    };
}

function chatTurnRuns(runs: QaapWorkflowRunStore): QaapPersistedWorkflowRun[] {
    return runs.list(undefined).filter(record => record.def.id === QAAP_CHAT_TURN_WORKFLOW_ID);
}

describe('QaapAgentConversationStore model fallback via the chat-turn graph (QAAP_TURN_GRAPH=on)', () => {
    const ENV = ['QAAP_TURN_GRAPH', 'QAAP_AUTO_RESUME_TURNS', 'QAAP_MAX_RESTART_RESUMES'] as const;
    const saved: Record<string, string | undefined> = {};
    let runner: TestTaskRunner;
    let runStore: TestRunStore;
    let store: TestConversationStore;

    before(() => {
        // The curated openrouter fallback chain is this spec's substrate; if the catalog ever
        // empties, the twin must be revisited rather than silently passing on nothing.
        expect(CHAIN.length, 'curated openrouter fallback chain').to.be.greaterThan(1);
    });

    beforeEach(() => {
        ENV.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
        process.env.QAAP_TURN_GRAPH = 'on';
        runner = new TestTaskRunner();
        runStore = new TestRunStore();
        store = new TestConversationStore();
        store.configureForTest(runner, runStore);
    });
    afterEach(() => ENV.forEach(k => { if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; } }));

    it('retries a retriable failure as a retry:model transition with a lazily adopted run', async () => {
        const conv = retriableConversation('f1', 'task-old', MODEL_ZERO);
        store.seed(conv);
        const agentMessage = conv.messages.find(m => m.role === 'agent');

        const handled = await store.retryFallback('f1', 'f1-u1', 'f1-a1', failedTask('task-old'), conv, agentMessage);

        expect(handled).to.be.true;
        expect(runner.created).to.have.length(1);
        // Conversation data plane, exactly like the imperative branch:
        const next = store.get('f1')!;
        expect(next.status).to.equal('streaming');
        const user = next.messages.find(m => m.role === 'user')!;
        expect(user.taskId).to.equal('retry-task-1');
        expect(user.error).to.equal(undefined);
        expect(agentModelKey(user.turnAgentModel)).to.equal(agentModelKey(CHAIN[1]));
        expect(next.messages.some(m => m.id === 'f1-a1')).to.be.false;
        // Run ledger: lazily adopted, retry edge walked, tried-set persisted as artifact.
        const record = chatTurnRuns(runStore)[0];
        expect(record.run.status).to.equal('running');
        expect(record.run.active).to.deep.equal(['turn-fallback']);
        expect(record.run.visits['turn-fallback']).to.equal(1);
        expect(record.trace.map(entry => entry.outcome)).to.deep.equal(['retry:model']);
        expect(record.dispatched['turn-fallback']?.externalId).to.equal('retry-task-1');
        const tried = JSON.parse(record.artifacts[QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT]);
        expect(tried).to.include(agentModelKey(MODEL_ZERO));
        expect(tried).to.include(agentModelKey(CHAIN[1]));
    });

    it('does not retry a non-retriable failure and creates no run', async () => {
        const conv = retriableConversation('f2', 'task-old', MODEL_ZERO);
        // A substantive answer: not empty output, not a model/tool failure → not retriable.
        conv.messages[1] = { ...conv.messages[1], content: 'Here is a full explanation of the change.' };
        store.seed(conv);

        const handled = await store.retryFallback('f2', 'f2-u1', 'f2-a1', failedTask('task-old'), conv, conv.messages[1]);

        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
        expect(chatTurnRuns(runStore)).to.have.length(0);
    });

    it('honors the shared re-spawn ceiling before touching the graph', async () => {
        const conv = retriableConversation('f3', 'task-old', MODEL_ZERO);
        store.seed(conv);
        store.spendSpawns('f3-u1', 4);

        const handled = await store.retryFallback('f3', 'f3-u1', 'f3-a1', failedTask('task-old'), conv, conv.messages[1]);

        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
        expect(chatTurnRuns(runStore)).to.have.length(0);
    });

    it('gives up without a run once the curated chain is exhausted', async () => {
        const conv = retriableConversation('f4', 'task-old', MODEL_ZERO);
        store.seed(conv);
        store.seedTried('f4-u1', CHAIN.map(model => agentModelKey(model)!));

        const handled = await store.retryFallback('f4', 'f4-u1', 'f4-a1', failedTask('task-old'), conv, conv.messages[1]);

        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
        expect(chatTurnRuns(runStore)).to.have.length(0);
    });

    it('remembers tried models across a backend restart through the run artifact', async () => {
        const conv = retriableConversation('f5', 'task-old', MODEL_ZERO);
        store.seed(conv);
        await store.retryFallback('f5', 'f5-u1', 'f5-a1', failedTask('task-old'), conv, conv.messages[1]);

        // "Restart": a fresh store sharing the same durable run store — the in-memory tried map
        // is gone, exactly what loses the imperative branch its memory today.
        const rebooted = new TestConversationStore();
        rebooted.configureForTest(new TestTaskRunner(), runStore);
        const convAfter = retriableConversation('f5', 'retry-task-1', CHAIN[1]);
        rebooted.seed(convAfter);

        const handled = await rebooted.retryFallback('f5', 'f5-u1', 'f5-a1', failedTask('retry-task-1'), convAfter, convAfter.messages[1]);

        const record = chatTurnRuns(runStore)[0];
        if (CHAIN.length > 2) {
            expect(handled).to.be.true;
            const user = rebooted.get('f5')!.messages.find(m => m.role === 'user')!;
            // The durable artifact vetoes CHAIN[1] even though this process never saw it fail.
            expect(agentModelKey(user.turnAgentModel)).to.equal(agentModelKey(CHAIN[2]));
            expect(record.run.visits['turn-fallback']).to.equal(2);
        } else {
            // A two-model catalog is exhausted after one retry — the artifact is what says so.
            expect(handled).to.be.false;
        }
    });

    it('steals the deferred settle on retry, then settles the retried task normally', async () => {
        const conv = retriableConversation('f6', 'task-old', MODEL_ZERO);
        store.seed(conv);
        await store.retryFallback('f6', 'f6-u1', 'f6-a1', failedTask('task-old'), conv, conv.messages[1]);

        // The old task's deferred settle finds its claim stolen: the run must stay running.
        store.settle(failedTask('task-old'));
        let record = chatTurnRuns(runStore)[0];
        expect(record.run.status).to.equal('running');

        // The retried task's terminal settles the run through its own edge.
        store.settle({ id: 'retry-task-1', state: 'completed' } as unknown as QaapAgentTask);
        await new Promise(resolve => setImmediate(resolve));
        record = chatTurnRuns(runStore)[0];
        expect(record.run.status).to.equal('succeeded');
        expect(record.run.bindings).to.have.property('turn.delivered');
        expect(record.trace.map(entry => entry.outcome)).to.deep.equal(['retry:model', 'success']);
    });
});
