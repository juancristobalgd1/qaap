// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { buildTaskCreateRequest } from './qaap-agent-conversation-store-helpers2';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { drainQueuedTasksExtracted, restorePersistedIndexExtracted } from './qaap-agent-task-runner-render2';
import { MAX_CONCURRENT_AGENTS_PER_REPO_ENV } from './qaap-agent-task-runner-utils2';

class TestableSharedTreeTaskRunner extends QaapAgentTaskRunner {
    // Fixtures do not initialize provider discovery or spawn real agents.
    public override resolveAgentId(): string {
        return 'qaiq';
    }

    public exposeDrainQueuedTasks(): void {
        this.drainQueuedTasks();
    }
}

interface SharedTreeFixture {
    readonly runner: TestableSharedTreeTaskRunner;
    readonly tasks: Map<string, QaapAgentTask>;
    readonly spawnedIds: string[];
}

function createFixture(): SharedTreeFixture {
    const runner = Object.create(TestableSharedTreeTaskRunner.prototype) as TestableSharedTreeTaskRunner;
    const tasks = new Map<string, QaapAgentTask>();
    const spawnedIds: string[] = [];
    Object.assign(runner, {
        tasks,
        queuedCreateRequests: new Map<string, QaapCreateAgentTaskRequest>(),
        processes: new Map(),
        stoppingTaskIds: new Set<string>(),
        recoveryState: 'ready',
        storageWriteFailed: false,
        onDidChangeTaskEmitter: { fire: () => undefined },
        maxConcurrentAgents: () => 16,
        ownerAtConcurrencyCap: () => false,
        resolveAgentModelForRequest: () => undefined,
        isDirectory: () => true,
        persist: async () => undefined,
        spawnProcessWhenReady: async (task: QaapAgentTask) => { spawnedIds.push(task.id); },
    });
    return { runner, tasks, spawnedIds };
}

function complete(tasks: Map<string, QaapAgentTask>, task: QaapAgentTask): void {
    tasks.set(task.id, { ...tasks.get(task.id)!, state: 'completed', finishedAt: Date.now() });
}

describe('QaapAgentTaskRunner shared working tree admission', () => {
    let previous: string | undefined;

    beforeEach(() => {
        previous = process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV];
        delete process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV];
    });

    afterEach(() => {
        if (previous === undefined) {
            delete process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV];
        } else {
            process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = previous;
        }
    });

    it('queues a second shared-tree task of the same owner in the same cwd until the first one ends', () => {
        const { runner, tasks, spawnedIds } = createFixture();
        const first = runner.create({ prompt: 'levanta la app', cwd: '/repo-a' }, 'alice');
        const second = runner.create({ prompt: 'levanta la app otra vez', cwd: '/repo-a' }, 'alice');
        const third = runner.create({ prompt: 'tercera', cwd: '/repo-a' }, 'alice');

        expect([first.state, second.state, third.state]).to.deep.equal(['running', 'queued', 'queued']);
        expect(second.queuePosition).to.equal(1);
        expect(third.queuePosition).to.equal(2);
        expect(first.sharedWorkingTree).to.equal(true);
        expect(spawnedIds).to.deep.equal([first.id]);

        complete(tasks, first);
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(second.id)?.state).to.equal('running');
        expect(tasks.get(second.id)?.queuePosition).to.equal(undefined);
        expect(tasks.get(third.id)?.state).to.equal('queued');
        expect(spawnedIds).to.deep.equal([first.id, second.id]);

        complete(tasks, second);
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(third.id)?.state).to.equal('running');
        expect(spawnedIds).to.deep.equal([first.id, second.id, third.id]);
    });

    it('never queues tasks that run in their own worktree (Parallel, fork, isolated threads)', () => {
        const { runner } = createFixture();
        const a = runner.create({ prompt: 'a', cwd: '/repo-a', ownWorkingTree: true }, 'alice');
        const b = runner.create({ prompt: 'b', cwd: '/repo-a', ownWorkingTree: true }, 'alice');
        expect([a.state, b.state]).to.deep.equal(['running', 'running']);
        expect(a.sharedWorkingTree).to.equal(false);
        expect(b.sharedWorkingTree).to.equal(false);
    });

    it('does not block a shared-tree task behind a running own-worktree task of the same owner', () => {
        const { runner } = createFixture();
        const own = runner.create({ prompt: 'own', cwd: '/repo-a', ownWorkingTree: true }, 'alice');
        const shared = runner.create({ prompt: 'shared', cwd: '/repo-a' }, 'alice');
        expect([own.state, shared.state]).to.deep.equal(['running', 'running']);
    });

    it('does not block another owner or another repository', () => {
        const { runner } = createFixture();
        const aliceA = runner.create({ prompt: 'a', cwd: '/repo-a' }, 'alice');
        const bobA = runner.create({ prompt: 'b', cwd: '/repo-a' }, 'bob');
        const aliceB = runner.create({ prompt: 'c', cwd: '/repo-b' }, 'alice');
        expect([aliceA.state, bobA.state, aliceB.state]).to.deep.equal(['running', 'running', 'running']);
    });

    it('keeps a queued shared task waiting while its owner still has a stopping shared task in that cwd', () => {
        const { runner, tasks } = createFixture();
        const first = runner.create({ prompt: 'first', cwd: '/repo-a' }, 'alice');
        const second = runner.create({ prompt: 'second', cwd: '/repo-a' }, 'alice');

        tasks.set(first.id, { ...first, state: 'cancelled' });
        Object.assign(runner, { stoppingTaskIds: new Set([first.id]) });
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(second.id)?.state).to.equal('queued');

        Object.assign(runner, { stoppingTaskIds: new Set() });
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(second.id)?.state).to.equal('running');
    });

    it('restores the queue after a backend restart with the same order and still serializes it', () => {
        const { runner, tasks, spawnedIds } = createFixture();
        const running: QaapAgentTask = {
            id: 'task-a', agentId: 'qaiq', title: 'a', command: 'a', cwd: '/repo-a', state: 'running', createdAt: 1, startedAt: 1,
            ownerLogin: 'alice', sharedWorkingTree: true,
        };
        const queued = (id: string, position: number): QaapAgentTask => ({
            id, agentId: 'qaiq', title: id, command: id, cwd: '/repo-a', state: 'queued', createdAt: position + 1,
            queuePosition: position, ownerLogin: 'alice', sharedWorkingTree: true,
        });
        const stored = {
            version: 2,
            tasks: [queued('task-c', 2), running, queued('task-b', 1)],
            queuedRequests: {
                'task-b': { prompt: 'b', cwd: '/repo-a', agent: 'qaiq' },
                'task-c': { prompt: 'c', cwd: '/repo-a', agent: 'qaiq' },
            },
        };
        restorePersistedIndexExtracted(runner as unknown as Parameters<typeof restorePersistedIndexExtracted>[0], stored);
        // The task that was running when the backend died is interrupted, so it no longer holds the tree.
        expect(tasks.get('task-a')?.state).to.equal('interrupted');

        drainQueuedTasksExtracted(runner as unknown as Parameters<typeof drainQueuedTasksExtracted>[0]);
        expect(spawnedIds).to.deep.equal(['task-b']);
        expect(tasks.get('task-b')?.state).to.equal('running');
        expect(tasks.get('task-c')?.state).to.equal('queued');

        complete(tasks, tasks.get('task-b')!);
        drainQueuedTasksExtracted(runner as unknown as Parameters<typeof drainQueuedTasksExtracted>[0]);
        expect(spawnedIds).to.deep.equal(['task-b', 'task-c']);
    });
});

describe('buildTaskCreateRequest working tree ownership', () => {
    const deps = { stripLeadingAgentMention: (content: string) => content, buildPrompt: (_conv: unknown, agent: string) => `prompt for ${agent}` };
    const conversation = (worktreeBranch?: string): QaapAgentConversation => ({
        id: 'conv-1', cwd: '/repo-a', agentId: 'qaiq', title: 't', status: 'idle', createdAt: 1, updatedAt: 1,
        messages: [{ id: 'm1', role: 'user', content: 'levanta la app', createdAt: 1 } as unknown as QaapAgentConversation['messages'][number]],
        ...(worktreeBranch ? { worktreeBranch } : {}),
    } as unknown as QaapAgentConversation);

    it('marks a thread with its own worktree as not sharing the working tree', () => {
        const request = buildTaskCreateRequest(conversation('qaap/worktree/1'), 'qaiq', undefined, 'm1', deps);
        expect(request.ownWorkingTree).to.equal(true);
    });

    it('leaves a shared-tree thread (no worktree branch) without the flag, so it is serialized', () => {
        const request = buildTaskCreateRequest(conversation(), 'qaiq', undefined, 'm1', deps);
        expect(request.ownWorkingTree).to.equal(undefined);
    });
});
