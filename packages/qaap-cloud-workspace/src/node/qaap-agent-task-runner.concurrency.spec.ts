// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

class TestableQaapAgentTaskRunner extends QaapAgentTaskRunner {
    public exposeDrainQueuedTasks(): void {
        this.drainQueuedTasks();
    }
}

describe('QaapAgentTaskRunner concurrency quota', () => {

    it('queues new tasks when the running cap is reached and drains on completion', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const tasks = new Map<string, import('../common/qaap-agent-task').QaapAgentTask>();
        const queuedCreateRequests = new Map<string, import('../common/qaap-agent-task').QaapCreateAgentTaskRequest>();
        let spawned = 0;
        Object.assign(runner, {
            tasks,
            queuedCreateRequests,
            processes: new Map(),
            onDidChangeTaskEmitter: { fire: () => undefined },
            maxConcurrentAgents: () => 2,
            countRunningTasks: () => [...tasks.values()].filter(task => task.state === 'running').length,
            resolveAgentModelForRequest: () => undefined,
            isDirectory: () => true,
            persist: async () => undefined,
            spawnProcessWhenReady: async () => { spawned++; },
        });

        const request = { prompt: 'do work', cwd: '/repo' };
        const first = runner.create(request);
        const second = runner.create(request);
        const third = runner.create(request);

        expect(first.state).to.equal('running');
        expect(second.state).to.equal('running');
        expect(third.state).to.equal('queued');
        expect(spawned).to.equal(2);

        tasks.set(first.id, { ...first, state: 'completed', finishedAt: Date.now() });
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(third.id)?.state).to.equal('running');
        expect(spawned).to.equal(3);
    });

    it('caps concurrent agents per authenticated user without starving other users', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const tasks = new Map<string, import('../common/qaap-agent-task').QaapAgentTask>();
        const queuedCreateRequests = new Map<string, import('../common/qaap-agent-task').QaapCreateAgentTaskRequest>();
        Object.assign(runner, {
            tasks,
            queuedCreateRequests,
            processes: new Map(),
            onDidChangeTaskEmitter: { fire: () => undefined },
            maxConcurrentAgents: () => 10,          // global cap high — not the limiter here
            maxConcurrentAgentsPerUser: () => 2,    // per-user cap is what should bite
            countRunningTasks: () => [...tasks.values()].filter(task => task.state === 'running').length,
            resolveAgentModelForRequest: () => undefined,
            isDirectory: () => true,
            persist: async () => undefined,
            spawnProcessWhenReady: async () => undefined,
        });

        const request = { prompt: 'do work', cwd: '/repo' };
        const a1 = runner.create(request, 'alice');
        const a2 = runner.create(request, 'alice');
        const a3 = runner.create(request, 'alice');
        // alice hits her per-user cap of 2 even though the global cap (10) has plenty of room.
        expect(a1.state).to.equal('running');
        expect(a2.state).to.equal('running');
        expect(a3.state).to.equal('queued');

        // bob is not blocked by alice's backlog — fairness.
        const b1 = runner.create(request, 'bob');
        expect(b1.state).to.equal('running');

        // When one of alice's finishes, her queued task drains in.
        tasks.set(a1.id, { ...a1, state: 'completed', finishedAt: Date.now() });
        runner.exposeDrainQueuedTasks();
        expect(tasks.get(a3.id)?.state).to.equal('running');
    });
});
