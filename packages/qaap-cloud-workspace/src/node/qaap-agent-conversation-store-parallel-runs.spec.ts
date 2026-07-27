// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import { MAX_CONCURRENT_CONVERSATION_RUNS, QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapAgentTask, QaapAgentTaskDetail } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/** Hands out fake task ids instead of spawning agent CLIs. */
class TestTaskRunner extends QaapAgentTaskRunner {
    readonly createdIds: string[] = [];
    readonly cancelledIds: string[] = [];
    /** Runs while `detail()` is awaited — used to simulate a peer run streaming mid-outcome. */
    onDetailAwaited?: () => void;
    private nextId = 1;

    override async detail(id: string): Promise<QaapAgentTaskDetail | undefined> {
        this.onDetailAwaited?.();
        return { id, state: 'completed', log: 'peer-safe reply' } as unknown as QaapAgentTaskDetail;
    }

    override create(): QaapAgentTask {
        const id = `task-${this.nextId++}`;
        this.createdIds.push(id);
        return { id, state: 'running' } as unknown as QaapAgentTask;
    }

    override cancel(id: string): QaapAgentTask | undefined {
        this.cancelledIds.push(id);
        return undefined;
    }

    override list(): QaapAgentTask[] {
        return [];
    }

    protected override async persist(): Promise<void> {
        /* no-op — keep ~/.qaap/agent-tasks out of the tests */
    }
}

class TestConversationStore extends QaapAgentConversationStore {

    protected override async persist(): Promise<void> {
        /* no-op — keep ~/.qaap/agent-conversations out of the tests */
    }

    protected override async restoreFromDisk(): Promise<void> {
        /* no-op — tests seed conversations directly */
    }

    protected override startTurnWatchdog(): void {
        /* no-op */
    }

    protected override captureGitSha(): string | undefined {
        return undefined;
    }

    protected override computeGitDiffStats(): { added: number; removed: number } | undefined {
        return undefined;
    }

    protected override captureCheckpoint(): undefined {
        return undefined;
    }

    /** Drives the task-outcome path directly (normally invoked by the task runner's events). */
    async settleRun(conversationId: string, userMessageId: string, taskId: string): Promise<void> {
        await (this as unknown as {
            applyTaskOutcome: (c: string, u: string, a: string | undefined, t: QaapAgentTask) => Promise<void>;
        }).applyTaskOutcome(conversationId, userMessageId, undefined, { id: taskId, state: 'completed' } as QaapAgentTask);
    }

    appendPeerMessage(conversationId: string, content: string): void {
        const conversations = (this as unknown as { conversations: Map<string, QaapAgentConversation> }).conversations;
        const conv = conversations.get(conversationId)!;
        conversations.set(conversationId, {
            ...conv,
            messages: [...conv.messages, { id: `peer-${content}`, role: 'agent', content, createdAt: Date.now() }],
        });
    }

    configureForTest(taskRunner: QaapAgentTaskRunner): void {
        (this as unknown as { sseBatcher: QaapAgentConversationSseBatcher }).sseBatcher =
            new QaapAgentConversationSseBatcher(() => { /* ignore SSE fanout in tests */ });
        (this as unknown as { taskRunner: QaapAgentTaskRunner }).taskRunner = taskRunner;
    }

    seed(conv: QaapAgentConversation): void {
        (this as unknown as { conversations: Map<string, QaapAgentConversation> }).conversations.set(conv.id, conv);
    }

    activeTaskIds(conversationId: string): string[] {
        return this.getActiveTaskIdsForConversation(conversationId);
    }

    /** Drives the same settle decision the task-outcome path uses. */
    statusWhenRunSettles(conversationId: string, taskId: string, settled: 'idle' | 'failed'): string {
        return (this as unknown as {
            settleStatusForRun: (c: string, t: string, s: string) => string;
        }).settleStatusForRun(conversationId, taskId, settled);
    }
}

function idleConversation(id: string): QaapAgentConversation {
    const now = Date.now();
    return {
        id,
        cwd: '/tmp/project',
        agentId: 'qaiq',
        title: 'Session',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        messages: [],
    };
}

describe('QaapAgentConversationStore in-session parallel runs', () => {

    function createStore(): { store: TestConversationStore; runner: TestTaskRunner } {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        store.seed(idleConversation('c1'));
        return { store, runner };
    }

    it('spawns a peer run instead of rejecting or cancelling the turn in flight', () => {
        const { store, runner } = createStore();

        store.postUserMessage('c1', 'first');
        const afterSecond = store.postUserMessage('c1', 'second');

        expect(runner.createdIds).to.deep.equal(['task-1', 'task-2']);
        // The first run is never cancelled to make room for the second.
        expect(runner.cancelledIds).to.deep.equal([]);
        expect(store.activeTaskIds('c1')).to.have.length(2);
        expect(afterSecond.status).to.equal('streaming');
        expect(afterSecond.messages.filter(m => m.role === 'user').map(m => m.content)).to.deep.equal(['first', 'second']);
    });

    it('gives each peer run its own user message and task', () => {
        const { store } = createStore();

        store.postUserMessage('c1', 'first');
        const conv = store.postUserMessage('c1', 'second');

        const taskIds = conv.messages.filter(m => m.role === 'user').map(m => m.taskId);
        expect(taskIds).to.deep.equal(['task-1', 'task-2']);
    });

    it('uses the optimistic client message id to make a retried submit idempotent', () => {
        const { store, runner } = createStore();
        const internal = { clientMessageId: 'pending-user-123' };

        store.postUserMessage(
            'c1', 'como estas?', undefined, undefined, undefined, undefined, undefined, undefined, undefined, internal,
        );
        const retried = store.postUserMessage(
            'c1', 'como estas?', undefined, undefined, undefined, undefined, undefined, undefined, undefined, internal,
        );

        expect(runner.createdIds).to.deep.equal(['task-1']);
        expect(retried.messages.filter(message => message.role === 'user')).to.have.length(1);
        expect(retried.messages.find(message => message.role === 'user')?.clientMessageId)
            .to.equal('pending-user-123');
    });

    it('caps how many agents may share one session', () => {
        const { store } = createStore();
        for (let i = 0; i < MAX_CONCURRENT_CONVERSATION_RUNS; i++) {
            store.postUserMessage('c1', `run ${i}`);
        }

        expect(() => store.postUserMessage('c1', 'one too many')).to.throw(/agent runs in progress/);
        expect(store.activeTaskIds('c1')).to.have.length(MAX_CONCURRENT_CONVERSATION_RUNS);
    });

    it('keeps the session streaming until the LAST peer run settles', () => {
        const { store } = createStore();
        store.postUserMessage('c1', 'first');
        store.postUserMessage('c1', 'second');

        // task-1 finishing while task-2 still runs must not switch the session off.
        expect(store.statusWhenRunSettles('c1', 'task-1', 'idle')).to.equal('streaming');
        // A run that dies does not fail the whole session either.
        expect(store.statusWhenRunSettles('c1', 'task-1', 'failed')).to.equal('streaming');
    });

    it('recovers a stale streaming conversation that has no live run', () => {
        const { store, runner } = createStore();
        store.seed({ ...idleConversation('c2'), status: 'streaming' });

        const conv = store.postUserMessage('c2', 'after a backend restart');

        expect(conv.status).to.equal('streaming');
        expect(runner.cancelledIds).to.deep.equal([]);
        expect(store.activeTaskIds('c2')).to.deep.equal(['task-1']);
    });

    it('does not drop what a peer run streamed while a settling run awaited its task detail', async () => {
        const { store, runner } = createStore();
        store.postUserMessage('c1', 'first');
        const conv = store.postUserMessage('c1', 'second');
        const secondUserMessageId = conv.messages.filter(m => m.role === 'user')[1].id;
        // The peer keeps streaming into the same conversation record mid-outcome. Deriving the
        // write-back from the pre-await snapshot would clobber this message.
        runner.onDetailAwaited = () => store.appendPeerMessage('c1', 'peer output');

        await store.settleRun('c1', secondUserMessageId, 'task-2');

        const contents = store.get('c1')!.messages.map(m => m.content);
        expect(contents).to.include('peer output');
    });

    it('stops ONE run by its user message and leaves the peer working', () => {
        const { store, runner } = createStore();
        store.postUserMessage('c1', 'first');
        const conv = store.postUserMessage('c1', 'second');
        const firstUserMessageId = conv.messages.filter(m => m.role === 'user')[0].id;

        const after = store.cancelRun('c1', firstUserMessageId);

        expect(runner.cancelledIds).to.deep.equal(['task-1']);
        // The peer keeps the session alive — a per-run stop is not a session stop.
        expect(after?.status).to.equal('streaming');
        expect(store.activeTaskIds('c1')).to.deep.equal(['task-2']);
    });

    it('leaves the session idle when the run stopped was the last one', () => {
        const { store } = createStore();
        const conv = store.postUserMessage('c1', 'only');
        const userMessageId = conv.messages.filter(m => m.role === 'user')[0].id;

        const after = store.cancelRun('c1', userMessageId);

        expect(after?.status).to.equal('idle');
        expect(store.activeTaskIds('c1')).to.deep.equal([]);
    });

    it('stop cancels every run in the session, not just the newest', () => {
        const { store, runner } = createStore();
        store.postUserMessage('c1', 'first');
        store.postUserMessage('c1', 'second');

        const cancelled = store.cancel('c1');

        expect(runner.cancelledIds).to.have.members(['task-1', 'task-2']);
        expect(cancelled?.status).to.equal('idle');
    });
});
