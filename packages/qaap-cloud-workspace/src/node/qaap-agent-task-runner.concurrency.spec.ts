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
});
