// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import type { QaapAgentTask, QaapAgentTaskState } from '../common/qaap-agent-task';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { cancelExtracted, type QaapAgentTaskPauseCause } from './qaap-agent-task-runner-streaming2';
import { expireIdleAgentTask } from './qaap-agent-task-runner-timeline2';
import { notifyCompletionExtracted } from './qaap-agent-task-runner-tool-pills2';

interface PushPayload {
    readonly title: string;
    readonly body: string;
}

interface PauseHarness {
    readonly ctx: QaapAgentTaskRunnerContext;
    readonly pushes: PushPayload[];
    readonly taskPauseCauses: Map<string, QaapAgentTaskPauseCause>;
}

/** A runner context whose finishTask settles the task and fires the push synchronously, like the runner's. */
function pauseHarness(): PauseHarness {
    const task = {
        id: 'paused-task',
        title: 'Refactor billing',
        command: 'refactor billing',
        cwd: '/workspace/repo',
        agentId: 'qaiq',
        state: 'running',
        createdAt: 1,
    } as QaapAgentTask;
    const pushes: PushPayload[] = [];
    const taskPauseCauses = new Map<string, QaapAgentTaskPauseCause>();
    const tasks = new Map<string, QaapAgentTask>([[task.id, task]]);
    const ctx = {
        tasks,
        taskPauseCauses,
        processes: new Map<string, ChildProcess>(),
        stoppingTaskIds: new Set<string>(),
        queuedCreateRequests: new Map(),
        pendingQaiqControlRequests: new Map(),
        webPush: { notify: async (payload: PushPayload) => { pushes.push(payload); } },
        killAgentProcessTree: () => undefined,
        drainQueuedTasks: () => undefined,
        finishTask: (id: string, state: QaapAgentTaskState) => {
            const finished = { ...tasks.get(id)!, state, finishedAt: 2 };
            tasks.set(id, finished);
            void notifyCompletionExtracted(ctx, finished);
            return finished;
        },
    } as unknown as QaapAgentTaskRunnerContext;
    return { ctx, pushes, taskPauseCauses };
}

describe('agent task runner paused-task push copy', () => {
    it('names the task cap for a watchdog max-duration pause, not "without output"', () => {
        const { ctx, pushes, taskPauseCauses } = pauseHarness();

        cancelExtracted(ctx, 'paused-task', { interrupt: true, pauseCause: { cause: 'max_duration', limitMinutes: 180 } });

        expect(ctx.tasks.get('paused-task')?.state).to.equal('interrupted');
        expect(pushes).to.have.length(1);
        expect(pushes[0].title).to.equal('Task paused');
        expect(pushes[0].body).to.contain('Refactor billing was paused.');
        expect(pushes[0].body).to.contain('180-minute task limit');
        expect(pushes[0].body).not.to.contain('without output');
        expect(taskPauseCauses.size).to.equal(0);
    });

    it('names the approval wait in hours for an approval-wait pause', () => {
        const { ctx, pushes } = pauseHarness();

        cancelExtracted(ctx, 'paused-task', { interrupt: true, pauseCause: { cause: 'approval_wait', limitMinutes: 24 * 60 } });

        expect(pushes).to.have.length(1);
        expect(pushes[0].body).to.equal(
            'Refactor billing was paused. Waited 24 hours for your approval. Continue picks it up again.',
        );
    });

    it('uses neutral copy when the pause cause is unknown', () => {
        const { ctx, pushes } = pauseHarness();

        cancelExtracted(ctx, 'paused-task', { interrupt: true });

        expect(pushes).to.have.length(1);
        expect(pushes[0].body).to.equal('Refactor billing was paused. Continue picks it up again.');
    });

    it('keeps the no-output copy for the runner idle timer', () => {
        const { ctx, pushes, taskPauseCauses } = pauseHarness();
        const logStream = {
            write: (_chunk: string, callback?: () => void): boolean => { callback?.(); return true; },
        } as unknown as Parameters<typeof expireIdleAgentTask>[3];

        expireIdleAgentTask(ctx, 'paused-task', { pid: 7 } as ChildProcess, logStream);

        expect(pushes).to.have.length(1);
        expect(pushes[0].body).to.contain('without output');
        expect(taskPauseCauses.size).to.equal(0);
    });
});
