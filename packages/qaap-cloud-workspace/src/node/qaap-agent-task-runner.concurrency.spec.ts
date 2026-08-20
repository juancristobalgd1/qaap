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

    public exposeRestorePersistedIndex(stored: unknown): void {
        this.restorePersistedIndex(stored);
    }

    public exposeReleaseVerificationPass(): void {
        this.releaseVerificationPass();
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

    it('uses the signed-in plan concurrent cap when billing peek is warm', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const tasks = new Map<string, import('../common/qaap-agent-task').QaapAgentTask>();
        const queuedCreateRequests = new Map<string, import('../common/qaap-agent-task').QaapCreateAgentTaskRequest>();
        Object.assign(runner, {
            tasks,
            queuedCreateRequests,
            processes: new Map(),
            onDidChangeTaskEmitter: { fire: () => undefined },
            maxConcurrentAgents: () => 16,
            maxConcurrentAgentsPerUser: () => 8,
            countRunningTasks: () => [...tasks.values()].filter(task => task.state === 'running').length,
            resolveAgentModelForRequest: () => undefined,
            isDirectory: () => true,
            persist: async () => undefined,
            spawnProcessWhenReady: async () => undefined,
            billingStore: {
                maxConcurrentAgentsForOwner: (login: string | undefined) => login === 'alice' ? 4 : 2,
                getOrCreateAccount: async () => undefined,
            },
        });

        const request = { prompt: 'do work', cwd: '/repo' };
        expect(runner.create(request, 'alice').state).to.equal('running');
        expect(runner.create(request, 'alice').state).to.equal('running');
        expect(runner.create(request, 'alice').state).to.equal('running');
        expect(runner.create(request, 'alice').state).to.equal('running');
        expect(runner.create(request, 'alice').state).to.equal('queued');
        expect(runner.create(request, 'bob').state).to.equal('running');
        expect(runner.create(request, 'bob').state).to.equal('running');
        expect(runner.create(request, 'bob').state).to.equal('queued');
    });

    it('treats Alice and alice as the same concurrent-agent owner', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const tasks = new Map<string, import('../common/qaap-agent-task').QaapAgentTask>();
        const queuedCreateRequests = new Map<string, import('../common/qaap-agent-task').QaapCreateAgentTaskRequest>();
        Object.assign(runner, {
            tasks,
            queuedCreateRequests,
            processes: new Map(),
            onDidChangeTaskEmitter: { fire: () => undefined },
            maxConcurrentAgents: () => 16,
            maxConcurrentAgentsPerUser: () => 2,
            countRunningTasks: () => [...tasks.values()].filter(task => task.state === 'running').length,
            resolveAgentModelForRequest: () => undefined,
            isDirectory: () => true,
            persist: async () => undefined,
            spawnProcessWhenReady: async () => undefined,
            billingStore: {
                maxConcurrentAgentsForOwner: () => 2,
                getOrCreateAccount: async () => undefined,
            },
        });

        const request = { prompt: 'do work', cwd: '/repo' };
        expect(runner.create(request, 'Alice').state).to.equal('running');
        expect(runner.create(request, 'alice').state).to.equal('running');
        expect(runner.create(request, 'ALICE').state).to.equal('queued');
    });

    it('restores a queued request and can execute it after a backend restart', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const tasks = new Map<string, import('../common/qaap-agent-task').QaapAgentTask>();
        const queuedCreateRequests = new Map<string, import('../common/qaap-agent-task').QaapCreateAgentTaskRequest>();
        let spawned = 0;
        const request = { prompt: 'resume me', cwd: '/repo', agent: 'qaiq' };
        Object.assign(runner, {
            tasks,
            queuedCreateRequests,
            processes: new Map(),
            onDidChangeTaskEmitter: { fire: () => undefined },
            maxConcurrentAgents: () => 1,
            countRunningTasks: () => [...tasks.values()].filter(task => task.state === 'running').length,
            ownerAtConcurrencyCap: () => false,
            persist: async () => undefined,
            spawnProcessWhenReady: async () => { spawned++; },
        });

        runner.exposeRestorePersistedIndex({
            version: 2,
            tasks: [{
                id: 'queued-1',
                title: 'resume me',
                command: 'resume me',
                cwd: '/repo',
                state: 'queued',
                createdAt: 1,
                ownerLogin: 'alice',
            }],
            queuedRequests: { 'queued-1': request },
        });
        runner.exposeDrainQueuedTasks();

        expect(tasks.get('queued-1')?.state).to.equal('running');
        expect(queuedCreateRequests.has('queued-1')).to.equal(false);
        expect(spawned).to.equal(1);
    });

    it('marks a legacy queued task interrupted when its executable request cannot be reconstructed', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const tasks = new Map<string, import('../common/qaap-agent-task').QaapAgentTask>();
        Object.assign(runner, { tasks, queuedCreateRequests: new Map() });

        runner.exposeRestorePersistedIndex([{
            id: 'legacy-queued',
            title: 'legacy',
            command: 'legacy',
            cwd: '/repo',
            state: 'queued',
            createdAt: 1,
        }]);

        expect(tasks.get('legacy-queued')?.state).to.equal('interrupted');
    });

    it('queues the extra verification pass when the verification budget is full (REL-3)', async () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        let verifyCalls = 0;
        let finishState = '';
        Object.assign(runner, {
            activeVerificationPasses: 1,               // already at cap
            verificationPassWaiters: [],
            maxConcurrentVerificationPasses: () => 1,
            tasks: new Map([['t', { id: 't', state: 'running' }]]),
            verifySuccessfulAgentTask: async () => { verifyCalls++; return undefined; },
            reviewSuccessfulAgentTask: async () => undefined,
            finishTask: (_id: string, state: string) => { finishState = state; },
        });

        const pending = (runner as unknown as { finishSuccessfulTaskAfterVerification(task: unknown, code: number): Promise<void> })
            .finishSuccessfulTaskAfterVerification({ id: 't' }, 0);
        await Promise.resolve();
        expect(verifyCalls).to.equal(0);
        expect(finishState).to.equal('');
        runner.exposeReleaseVerificationPass();
        await pending;
        expect(verifyCalls).to.equal(1);
        expect(finishState).to.equal('completed');
    });

    it('runs verification when the budget has room and releases the slot (REL-3)', async () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        let verifyCalls = 0;
        Object.assign(runner, {
            activeVerificationPasses: 0,
            verificationPassWaiters: [],
            maxConcurrentVerificationPasses: () => 2,
            tasks: new Map([['t', { id: 't', state: 'running' }]]),
            verifySuccessfulAgentTask: async () => { verifyCalls++; return undefined; },
            finishTask: () => undefined,
        });

        await (runner as unknown as { finishSuccessfulTaskAfterVerification(task: unknown, code: number): Promise<void> })
            .finishSuccessfulTaskAfterVerification({ id: 't' }, 0);

        expect(verifyCalls).to.equal(1);
        expect((runner as unknown as { activeVerificationPasses: number }).activeVerificationPasses).to.equal(0);
    });
});
