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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import {
    QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT,
    QAAP_CHAT_TURN_WORKFLOW_ID,
    buildChatTurnWorkflow,
} from '../common/qaap-chat-turn-workflow';
import { agentModelKey, buildAgentModelFallbackChain } from '../common/qaap-agent-model-fallback';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type {
    QaapAgentTask,
    QaapAgentTaskDetail,
    QaapCreateAgentTaskQaiqModel,
    QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';

class TestRunStore extends QaapWorkflowRunStore {
    persistCalls = 0;
    failNextPersist = false;

    protected override async persist(): Promise<void> {
        this.persistCalls++;
        if (this.failNextPersist) {
            this.failNextPersist = false;
            throw new Error('simulated ledger write failure');
        }
    }
}

class DiskRunStore extends QaapWorkflowRunStore {
    constructor(protected readonly directory: string) { super(); }
    initialize(): void { this.init(); }
    protected override storeDirectory(): string { return this.directory; }
}

class TestTaskRunner extends QaapAgentTaskRunner {
    readonly created: QaapCreateAgentTaskRequest[] = [];
    readonly detailLogs = new Map<string, string>();
    throwOnCreate = false;
    onCreate?: () => void;
    seq = 0;

    override create(request: QaapCreateAgentTaskRequest, _ownerLogin?: string): QaapAgentTask {
        if (this.throwOnCreate) {
            throw new Error('runner refused');
        }
        this.onCreate?.();
        this.created.push(request);
        return { id: `retry-task-${++this.seq}`, agentId: 'qaiq' } as unknown as QaapAgentTask;
    }

    override async detail(id: string): Promise<QaapAgentTaskDetail | undefined> {
        const log = this.detailLogs.get(id);
        return log === undefined ? undefined : {
            id,
            title: 'terminal probe',
            command: 'agent probe',
            cwd: '/tmp/project',
            state: 'completed',
            createdAt: 1,
            log,
        };
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

    govern(taskId: string, runId: string, nodeId = 'turn'): void {
        (this as unknown as {
            chatTurnRunByTask: Map<string, { runId: string; ownerLogin?: string; nodeId: string }>;
        }).chatTurnRunByTask.set(taskId, { runId, nodeId });
    }

    terminal(
        task: QaapAgentTask,
        ref: { conversationId: string; userMessageId: string; agentMessageId?: string; turnAgentId: string },
    ): void {
        (this as unknown as { taskToConversation: Map<string, typeof ref> }).taskToConversation.set(task.id, ref);
        this.onTaskChanged({ type: 'completed', task });
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

async function flushAsyncWork(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
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
        expect(CHAIN.length, 'curated openrouter fallback chain').to.equal(4);
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
        let ledgerAtSpawn: { readonly persists: number; readonly trace: readonly string[]; readonly tried?: string } | undefined;
        runner.onCreate = () => {
            const record = chatTurnRuns(runStore)[0];
            ledgerAtSpawn = {
                persists: runStore.persistCalls,
                trace: record?.trace.map(entry => entry.outcome) ?? [],
                tried: record?.artifacts[QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT],
            };
        };

        const handled = await store.retryFallback('f1', 'f1-u1', 'f1-a1', failedTask('task-old'), conv, agentMessage);

        expect(handled).to.be.true;
        expect(runner.created).to.have.length(1);
        expect(ledgerAtSpawn?.persists).to.be.greaterThan(1);
        expect(ledgerAtSpawn?.trace).to.deep.equal(['retry:model']);
        expect(JSON.parse(ledgerAtSpawn?.tried ?? '[]')).to.include(agentModelKey(CHAIN[1]));
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

    it('remembers tried models after reopening the run index from disk', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-fallback-restart-'));
        try {
            const durableRuns = new DiskRunStore(directory);
            durableRuns.initialize();
            const firstStore = new TestConversationStore();
            firstStore.configureForTest(new TestTaskRunner(), durableRuns);
            const conv = retriableConversation('f5', 'task-old', MODEL_ZERO);
            firstStore.seed(conv);
            await firstStore.retryFallback('f5', 'f5-u1', 'f5-a1', failedTask('task-old'), conv, conv.messages[1]);

            // Backend restart: both stores are new objects and the run index is parsed from disk.
            const reopenedRuns = new DiskRunStore(directory);
            reopenedRuns.initialize();
            const rebooted = new TestConversationStore();
            rebooted.configureForTest(new TestTaskRunner(), reopenedRuns);
            const convAfter = retriableConversation('f5', 'retry-task-1', CHAIN[1]);
            rebooted.seed(convAfter);

            const handled = await rebooted.retryFallback(
                'f5', 'f5-u1', 'f5-a1', failedTask('retry-task-1'), convAfter, convAfter.messages[1],
            );

            expect(handled).to.be.true;
            const user = rebooted.get('f5')!.messages.find(m => m.role === 'user')!;
            // The on-disk artifact vetoes CHAIN[1] even though this process never saw it fail.
            expect(agentModelKey(user.turnAgentModel)).to.equal(agentModelKey(CHAIN[2]));
            expect(chatTurnRuns(reopenedRuns)[0].run.visits['turn-fallback']).to.equal(2);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('reconstructs the shared ceiling from graph fallbacks plus persisted auto-continues', async () => {
        const now = Date.now();
        const conv: QaapAgentConversation = {
            ...retriableConversation('f7', 'task-old', CHAIN[2]),
            messages: [
                { id: 'f7-root', role: 'user', content: 'do it', createdAt: now - 90_000 },
                { id: 'f7-u1', role: 'user', content: 'continue', createdAt: now - 60_000, autoContinueRootMessageId: 'f7-root' },
                {
                    id: 'f7-u2', role: 'user', content: 'continue again', createdAt: now - 30_000,
                    taskId: 'task-old', turnAgentId: 'qaiq', turnAgentModel: CHAIN[2], autoContinueRootMessageId: 'f7-root',
                },
                { id: 'f7-a1', role: 'agent', content: '', createdAt: now - 29_000, runUserMessageId: 'f7-u2' },
            ],
        };
        store.seed(conv);
        const adopted = await runStore.adoptRun(buildChatTurnWorkflow(), {
            cwd: conv.cwd,
            inputs: { conversationId: conv.id, rootUserMessageId: 'f7-root' },
            seedNodeId: 'turn',
            seedVisits: 1,
        });
        let advanced = await runStore.report(undefined, adopted.run.id, 'turn', 'retry:model', undefined, {
            key: QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT,
            value: JSON.stringify([agentModelKey(MODEL_ZERO), agentModelKey(CHAIN[1])]),
        });
        advanced = await runStore.report(undefined, adopted.run.id, advanced.dispatch[0], 'retry:model', undefined, {
            key: QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT,
            value: JSON.stringify([agentModelKey(MODEL_ZERO), agentModelKey(CHAIN[1]), agentModelKey(CHAIN[2])]),
        });
        expect(advanced.record.trace).to.have.length(2);

        const handled = await store.retryFallback('f7', 'f7-u2', 'f7-a1', failedTask('task-old'), conv, conv.messages[3]);

        // Two persisted continues + two retry:model edges already spent the global ceiling of four.
        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
        expect(chatTurnRuns(runStore)[0].trace).to.have.length(2);
    });

    it('keeps the old task claim and degrades imperatively when the retry edge cannot persist', async () => {
        const conv = retriableConversation('f8', 'task-old', MODEL_ZERO);
        store.seed(conv);
        const adopted = await runStore.adoptRun(buildChatTurnWorkflow(), {
            cwd: conv.cwd,
            inputs: { conversationId: conv.id, rootUserMessageId: 'f8-u1' },
            seedNodeId: 'turn',
            seedVisits: 1,
            deadExternalId: 'task-old',
        });
        store.govern('task-old', adopted.run.id);
        runStore.failNextPersist = true;

        const handled = await store.retryFallback('f8', 'f8-u1', 'f8-a1', failedTask('task-old'), conv, conv.messages[1]);
        store.settle(failedTask('task-old'));
        await flushAsyncWork();

        expect(handled).to.be.true;
        expect(runner.created).to.have.length(1);
        const record = chatTurnRuns(runStore)[0];
        expect(record.run.status).to.equal('failed');
        expect(record.trace.map(entry => entry.outcome)).to.deep.equal(['fail']);
    });

    it('settles an exit-0 quota failure as failed after transcript classification', async () => {
        const base = retriableConversation('f9', 'task-quota', MODEL_ZERO);
        const conv: QaapAgentConversation = {
            ...base,
            agentId: 'antigravity',
            messages: base.messages.map(message => message.role === 'user'
                ? { ...message, turnAgentId: 'antigravity' }
                : message),
        };
        store.seed(conv);
        const adopted = await runStore.adoptRun(buildChatTurnWorkflow(), {
            cwd: conv.cwd,
            inputs: { conversationId: conv.id, rootUserMessageId: 'f9-u1' },
            seedNodeId: 'turn',
            seedVisits: 1,
            deadExternalId: 'task-quota',
        });
        store.govern('task-quota', adopted.run.id);
        runner.detailLogs.set(
            'task-quota',
            'Error: Individual quota reached. Please upgrade your subscription. Resets in 54h.',
        );
        store.terminal(
            { id: 'task-quota', state: 'completed', exitCode: 0, agentId: 'antigravity' } as unknown as QaapAgentTask,
            { conversationId: conv.id, userMessageId: 'f9-u1', agentMessageId: 'f9-a1', turnAgentId: 'antigravity' },
        );
        await flushAsyncWork();

        expect(store.get('f9')?.status).to.equal('failed');
        const record = chatTurnRuns(runStore)[0];
        expect(record.run.status).to.equal('failed');
        expect(record.run.bindings).to.have.property('turn.failed');
        expect(record.trace.map(entry => entry.outcome)).to.deep.equal(['fail']);
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
