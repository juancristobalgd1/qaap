// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import {
    AGENT_STOP_GRACE_TIMEOUT_MS,
    DEFAULT_AGENT_STOP_GRACE_TIMEOUT_MS,
    MAX_AGENT_STOP_GRACE_TIMEOUT_MS,
    MIN_AGENT_STOP_GRACE_TIMEOUT_MS,
    QaapAgentTaskRunner,
    resolveAgentStopGraceTimeoutMs,
} from './qaap-agent-task-runner';

interface KillOptions {
    readonly escalateAfterMs?: number;
    readonly onGracePeriodElapsed?: () => void;
}

class TestableQaapAgentTaskRunner extends QaapAgentTaskRunner {
    public exposeFinishTask(id: string, state: 'cancelled' | 'failed'): QaapAgentTask | undefined {
        return this.finishTask(id, state, undefined);
    }

    public exposeKillAgentProcessTree(child: ChildProcess, options: KillOptions): NodeJS.Timeout | undefined {
        return this.killAgentProcessTree(child, options);
    }

    public exposeCountRunningTasks(): number {
        return this.countRunningTasks();
    }

    public exposeRunningTaskCountForOwner(ownerLogin: string): number {
        return this.runningTaskCountForOwner(ownerLogin);
    }

    public exposeDeleteForCwd(cwd: string): number {
        return this.deleteForCwd(cwd);
    }

    public exposeSpawnProcessWhenReady(task: QaapAgentTask, request: QaapCreateAgentTaskRequest): Promise<void> {
        return this.spawnProcessWhenReady(task, request);
    }
}

const runningTask = (id: string, ownerLogin = 'alice'): QaapAgentTask => ({
    id,
    title: 'edit files',
    command: 'qaiq --prompt "do work"',
    cwd: '/repo',
    state: 'running',
    createdAt: 0,
    agentId: 'qaiq',
    ownerLogin,
});

describe('QaapAgentTaskRunner cancellation', () => {

    it('uses a bounded configurable graceful-stop timeout', () => {
        expect(resolveAgentStopGraceTimeoutMs(undefined)).to.equal(DEFAULT_AGENT_STOP_GRACE_TIMEOUT_MS);
        expect(resolveAgentStopGraceTimeoutMs('invalid')).to.equal(DEFAULT_AGENT_STOP_GRACE_TIMEOUT_MS);
        expect(resolveAgentStopGraceTimeoutMs('250')).to.equal(MIN_AGENT_STOP_GRACE_TIMEOUT_MS);
        expect(resolveAgentStopGraceTimeoutMs('7000')).to.equal(7_000);
        expect(resolveAgentStopGraceTimeoutMs('60000')).to.equal(MAX_AGENT_STOP_GRACE_TIMEOUT_MS);
    });

    it('cancels immediately but releases the concurrency slot only after the grace period', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const task = runningTask('task-1');
        const tasks = new Map([[task.id, task]]);
        const stoppingTaskIds = new Set<string>();
        const child = { pid: 1234 } as ChildProcess;
        let drains = 0;
        let killOptions: KillOptions | undefined;
        Object.assign(runner, {
            tasks,
            processes: new Map([[task.id, child]]),
            stoppingTaskIds,
            queuedCreateRequests: new Map([[task.id, { prompt: 'do work', cwd: '/repo' }]]),
            finishTask: (id: string, state: QaapAgentTask['state']) => {
                const finished = { ...tasks.get(id)!, state, finishedAt: Date.now() };
                tasks.set(id, finished);
                return finished;
            },
            killAgentProcessTree: (_child: ChildProcess, options: KillOptions) => {
                killOptions = options;
                return undefined;
            },
            drainQueuedTasks: () => { drains++; },
        });

        const result = runner.cancel(task.id);

        expect(result?.state).to.equal('cancelled');
        expect(stoppingTaskIds.has(task.id)).to.equal(true);
        expect(killOptions?.escalateAfterMs).to.equal(AGENT_STOP_GRACE_TIMEOUT_MS);
        expect(drains).to.equal(0);

        killOptions?.onGracePeriodElapsed?.();
        expect(stoppingTaskIds.has(task.id)).to.equal(false);
        expect(drains).to.equal(1);
    });

    it('counts stopping process groups against global and per-owner limits', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const task: QaapAgentTask = { ...runningTask('task-1'), state: 'cancelled', finishedAt: Date.now() };
        Object.assign(runner, {
            tasks: new Map([[task.id, task]]),
            stoppingTaskIds: new Set([task.id]),
        });

        expect(runner.exposeCountRunningTasks()).to.equal(1);
        expect(runner.exposeRunningTaskCountForOwner('alice')).to.equal(1);
        expect(runner.exposeRunningTaskCountForOwner('bob')).to.equal(0);
    });

    it('releases a queued cancellation immediately when no process exists', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const task: QaapAgentTask = { ...runningTask('task-1'), state: 'queued' };
        const tasks = new Map([[task.id, task]]);
        let drains = 0;
        Object.assign(runner, {
            tasks,
            processes: new Map(),
            stoppingTaskIds: new Set(),
            queuedCreateRequests: new Map([[task.id, { prompt: 'do work', cwd: '/repo' }]]),
            finishTask: (id: string, state: QaapAgentTask['state']) => {
                const finished = { ...tasks.get(id)!, state, finishedAt: Date.now() };
                tasks.set(id, finished);
                return finished;
            },
            drainQueuedTasks: () => { drains++; },
        });

        expect(runner.cancel(task.id)?.state).to.equal('cancelled');
        expect(drains).to.equal(1);
    });

    it('removes persisted task history and caches for a deleted project', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const projectTask: QaapAgentTask = {
            ...runningTask('project-task'),
            cwd: '/repo/project',
            state: 'completed',
        };
        const nestedTask: QaapAgentTask = {
            ...runningTask('nested-task'),
            cwd: '/repo/project/nested',
            state: 'failed',
        };
        const otherTask: QaapAgentTask = {
            ...runningTask('other-task'),
            cwd: '/repo/project-two',
            state: 'completed',
        };
        const tasks = new Map([
            [projectTask.id, projectTask],
            [nestedTask.id, nestedTask],
            [otherTask.id, otherTask],
        ]);
        const deletedEvents: string[] = [];
        Object.assign(runner, {
            tasks,
            processes: new Map(),
            deletedTaskIds: new Set<string>(),
            queuedCreateRequests: new Map(),
            stdinInteractiveTasks: new Set(),
            stdinPrompts: new Map(),
            pendingQaiqControlRequests: new Map(),
            qaiqStdioTasks: new Set(),
            clearQueuedApprovalTimers: () => undefined,
            logPath: (id: string) => `/tmp/qaap-delete-${id}.log`,
            onDidChangeTaskEmitter: { fire: (event: { type: string; task: QaapAgentTask }) => deletedEvents.push(event.task.id) },
            persist: async () => undefined,
            projectNameCache: new Map([['/repo/project', 'project'], ['/repo/project-two', 'other']]),
            projectInfoCache: new Map([['/repo/project/nested', 'info'], ['/repo/project-two', 'other']]),
            agentInstructionsCache: new Map(),
            repoMapCache: new Map(),
        });

        expect(runner.exposeDeleteForCwd('/repo/project')).to.equal(2);
        expect([...tasks.keys()]).to.deep.equal(['other-task']);
        expect(deletedEvents).to.have.members(['project-task', 'nested-task']);
        expect(runner['projectNameCache'].has('/repo/project')).to.equal(false);
        expect(runner['projectNameCache'].has('/repo/project-two')).to.equal(true);
    });

    it('does not spawn a task cancelled while preference initialization is pending', async () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const task = runningTask('task-1');
        const tasks = new Map([[task.id, task]]);
        let releasePreferences!: () => void;
        const preferenceReady = new Promise<void>(resolve => { releasePreferences = resolve; });
        let spawns = 0;
        Object.assign(runner, {
            tasks,
            preferenceService: { ready: preferenceReady },
            spawnProcess: () => { spawns++; },
        });

        const pending = runner.exposeSpawnProcessWhenReady(task, { prompt: '', cwd: task.cwd });
        tasks.set(task.id, { ...task, state: 'cancelled', finishedAt: Date.now() });
        releasePreferences();
        await pending;

        expect(spawns).to.equal(0);
    });

    it('does not drain from finishTask while a cancelled process is stopping', () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const task = runningTask('task-1');
        let drains = 0;
        Object.assign(runner, {
            tasks: new Map([[task.id, task]]),
            persist: async () => undefined,
            onDidChangeTaskEmitter: { fire: () => undefined },
            notifyCompletion: async () => undefined,
            drainQueuedTasks: () => { drains++; },
        });

        runner.exposeFinishTask(task.id, 'cancelled');
        expect(drains).to.equal(0);
    });

    it('escalates from SIGTERM to SIGKILL and then releases the grace period', async function (): Promise<void> {
        if (globalThis.process.platform === 'win32') {
            this.skip();
        }
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const child = { pid: 44001, kill: () => true } as unknown as ChildProcess;
        const originalKill = globalThis.process.kill;
        const signals: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = [];
        let released = 0;
        globalThis.process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
            signals.push({ pid, signal });
            return true;
        }) as typeof globalThis.process.kill;
        try {
            runner.exposeKillAgentProcessTree(child, {
                escalateAfterMs: 5,
                onGracePeriodElapsed: () => { released++; },
            });
            await new Promise(resolve => setTimeout(resolve, 20));
        } finally {
            globalThis.process.kill = originalKill;
        }

        expect(signals).to.deep.equal([
            { pid: -44001, signal: 'SIGTERM' },
            { pid: -44001, signal: 'SIGKILL' },
        ]);
        expect(released).to.equal(1);
    });
});
