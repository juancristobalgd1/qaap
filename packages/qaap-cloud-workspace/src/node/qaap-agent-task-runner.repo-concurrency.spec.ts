// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { MAX_CONCURRENT_AGENTS_PER_REPO_ENV, maxConcurrentAgentsPerRepo } from './qaap-agent-task-runner-utils2';

class TestableRepoCapTaskRunner extends QaapAgentTaskRunner {
    // Concurrency fixtures do not initialize provider discovery or spawn real agents.
    public override resolveAgentId(): string {
        return 'qaiq';
    }

    public exposeDrainQueuedTasks(): void {
        this.drainQueuedTasks();
    }
}

interface RepoCapFixture {
    readonly runner: TestableRepoCapTaskRunner;
    readonly tasks: Map<string, QaapAgentTask>;
    readonly spawnedIds: string[];
}

function createFixture(globalCap = 16): RepoCapFixture {
    const runner = Object.create(TestableRepoCapTaskRunner.prototype) as TestableRepoCapTaskRunner;
    const tasks = new Map<string, QaapAgentTask>();
    const spawnedIds: string[] = [];
    Object.assign(runner, {
        tasks,
        queuedCreateRequests: new Map<string, QaapCreateAgentTaskRequest>(),
        processes: new Map(),
        onDidChangeTaskEmitter: { fire: () => undefined },
        maxConcurrentAgents: () => globalCap,
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

describe('QaapAgentTaskRunner per-repository concurrency cap', () => {
    let previous: string | undefined;

    beforeEach(() => {
        previous = process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV];
    });

    afterEach(() => {
        if (previous === undefined) {
            delete process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV];
        } else {
            process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = previous;
        }
    });

    it('treats unset, zero and invalid values as unlimited', () => {
        delete process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV];
        expect(maxConcurrentAgentsPerRepo()).to.equal(0);
        for (const raw of ['0', '', '  ', '-3', 'nope']) {
            process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = raw;
            expect(maxConcurrentAgentsPerRepo(), raw).to.equal(0);
        }
        process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = ' 3 ';
        expect(maxConcurrentAgentsPerRepo()).to.equal(3);
    });

    it('does not queue by repository when the cap is unset', () => {
        delete process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV];
        const { runner } = createFixture();
        const states = [1, 2, 3, 4].map(() => runner.create({ prompt: 'work', cwd: '/repo-a' }, 'alice').state);
        expect(states).to.deep.equal(['running', 'running', 'running', 'running']);
    });

    it('queues tasks over the repository cap without failing and leaves other repositories alone', () => {
        process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = '2';
        const { runner, spawnedIds } = createFixture();

        const a1 = runner.create({ prompt: 'a1', cwd: '/repo-a' }, 'alice');
        const a2 = runner.create({ prompt: 'a2', cwd: '/repo-a' }, 'bob');
        const a3 = runner.create({ prompt: 'a3', cwd: '/repo-a' }, 'carol');
        const b1 = runner.create({ prompt: 'b1', cwd: '/repo-b' }, 'alice');

        expect([a1.state, a2.state, a3.state, b1.state]).to.deep.equal(['running', 'running', 'queued', 'running']);
        expect(a3.queuePosition).to.equal(1);
        expect(spawnedIds).to.deep.equal([a1.id, a2.id, b1.id]);
        expect(runner.runningTaskCountForRepo('/repo-a')).to.equal(2);
        expect(runner.repoAtConcurrencyCap('/repo-a')).to.equal(true);
        expect(runner.repoAtConcurrencyCap('/repo-b')).to.equal(false);
    });

    it('does not start a queued task when a slot frees in a different repository', () => {
        process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = '1';
        const { runner, tasks } = createFixture();

        runner.create({ prompt: 'a1', cwd: '/repo-a' }, 'alice');
        const a2 = runner.create({ prompt: 'a2', cwd: '/repo-a' }, 'alice');
        const b1 = runner.create({ prompt: 'b1', cwd: '/repo-b' }, 'alice');
        expect(a2.state).to.equal('queued');

        complete(tasks, b1);
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(a2.id)?.state).to.equal('queued');
    });

    it('starts the oldest queued task of a repository once one of its slots frees, in FIFO order', () => {
        process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = '1';
        const { runner, tasks, spawnedIds } = createFixture();

        const a1 = runner.create({ prompt: 'a1', cwd: '/repo-a' }, 'alice');
        const a2 = runner.create({ prompt: 'a2', cwd: '/repo-a' }, 'bob');
        const a3 = runner.create({ prompt: 'a3', cwd: '/repo-a' }, 'alice');
        expect([a2.queuePosition, a3.queuePosition]).to.deep.equal([1, 2]);

        complete(tasks, a1);
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(a2.id)?.state).to.equal('running');
        expect(tasks.get(a2.id)?.queuePosition).to.equal(undefined);
        expect(tasks.get(a3.id)?.state).to.equal('queued');

        complete(tasks, a2);
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(a3.id)?.state).to.equal('running');
        expect(spawnedIds).to.deep.equal([a1.id, a2.id, a3.id]);
    });

    it('lets a later task for a free repository skip ahead of a capped repository', () => {
        process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = '1';
        // Global cap of 2 forces repo-b's task into the global queue behind repo-a's.
        const { runner, tasks } = createFixture(2);

        const a1 = runner.create({ prompt: 'a1', cwd: '/repo-a' }, 'alice');
        const c1 = runner.create({ prompt: 'c1', cwd: '/repo-c' }, 'alice');
        const a2 = runner.create({ prompt: 'a2', cwd: '/repo-a' }, 'alice');
        const b1 = runner.create({ prompt: 'b1', cwd: '/repo-b' }, 'alice');
        expect([a2.state, b1.state]).to.deep.equal(['queued', 'queued']);
        expect(a2.queuePosition! < b1.queuePosition!).to.equal(true);

        // Freeing repo-c's slot must promote repo-b rather than stall on repo-a, still at its cap.
        complete(tasks, c1);
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(b1.id)?.state).to.equal('running');
        expect(tasks.get(a2.id)?.state).to.equal('queued');

        complete(tasks, a1);
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(a2.id)?.state).to.equal('running');
    });

    it('counts a stopping task against its repository until it has exited', () => {
        process.env[MAX_CONCURRENT_AGENTS_PER_REPO_ENV] = '1';
        const { runner, tasks } = createFixture();
        const a1 = runner.create({ prompt: 'a1', cwd: '/repo-a' }, 'alice');
        const a2 = runner.create({ prompt: 'a2', cwd: '/repo-a' }, 'alice');

        tasks.set(a1.id, { ...a1, state: 'cancelled' });
        Object.assign(runner, { stoppingTaskIds: new Set([a1.id]) });
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(a2.id)?.state).to.equal('queued');

        Object.assign(runner, { stoppingTaskIds: new Set() });
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(a2.id)?.state).to.equal('running');
    });
});
