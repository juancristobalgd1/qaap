// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import { resolveAgentTurnFailureMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import type { QaapAgentTask, QaapAgentTaskState } from '../common/qaap-agent-task';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { resumeExtracted } from './qaap-agent-task-runner-streaming2';
import { notifyCompletionExtracted } from './qaap-agent-task-runner-tool-pills2';
import { expireIdleAgentTask } from './qaap-agent-task-runner-timeline2';

/* eslint-disable @typescript-eslint/no-explicit-any */

function idleHarness(state: QaapAgentTaskState, pendingApprovals = 0): {
    readonly ctx: any;
    readonly log: string[];
    readonly killed: unknown[];
    readonly created: Array<Record<string, unknown>>;
} {
    const task: QaapAgentTask = {
        id: 'quiet-task',
        title: 'Add tests',
        command: 'add tests for the store',
        cwd: '/workspace/repo',
        agentId: 'qaiq',
        state,
        createdAt: 1,
    } as QaapAgentTask;
    const log: string[] = [];
    const killed: unknown[] = [];
    const created: Array<Record<string, unknown>> = [];
    const ctx = {
        tasks: new Map<string, QaapAgentTask>([[task.id, task]]),
        pendingQaiqControlRequests: new Map(pendingApprovals ? [[task.id, Array.from({ length: pendingApprovals }, () => ({}))]] : []),
        killAgentProcessTree: (child: unknown) => { killed.push(child); },
        finishTask: (id: string, next: QaapAgentTaskState, exitCode: number | undefined) => {
            const finished = { ...ctx.tasks.get(id)!, state: next, exitCode, finishedAt: 2 };
            ctx.tasks.set(id, finished);
            return finished;
        },
        resumingTaskIds: new Map(),
        resolveTaskAgentId: () => 'qaiq',
        create: (request: Record<string, unknown>) => {
            created.push(request);
            const resumed = { ...task, id: 'resumed-task', state: 'queued' as const, resumedFromTaskId: task.id };
            ctx.tasks.set(resumed.id, resumed);
            return resumed;
        },
    };
    return { ctx, log, killed, created };
}

const child = { pid: 42 } as unknown as ChildProcess;

describe('agent task runner no-output timeout', () => {
    it('stops a silent run as interrupted, not failed, with the log line the turn reason reads', () => {
        const { ctx, log, killed } = idleHarness('running');

        const outcome = expireIdleAgentTask(ctx, 'quiet-task', child, { write: (chunk: string) => log.push(chunk) > 0 });

        expect(outcome).to.equal('interrupted');
        expect(killed).to.deep.equal([child]);
        expect(ctx.tasks.get('quiet-task').state).to.equal('interrupted');
        expect(ctx.tasks.get('quiet-task').exitCode).to.equal(undefined);
        expect(resolveAgentTurnFailureMessage(log.join(''), { state: 'interrupted' }))
            .to.equal('Timed out after 20 minutes without output. Continue to pick up where it left off.');
    });

    it('Continue resumes the timed-out task from its durable request', () => {
        const { ctx, created } = idleHarness('running');
        expireIdleAgentTask(ctx, 'quiet-task', child, { write: () => true });

        const resumed = resumeExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'quiet-task');

        expect(resumed?.id).to.equal('resumed-task');
        expect(created).to.have.length(1);
        expect(created[0]).to.deep.include({ prompt: 'add tests for the store', cwd: '/workspace/repo', resumedFromTaskId: 'quiet-task' });
    });

    it('keeps a run that is waiting on a permission approval', () => {
        const { ctx, killed } = idleHarness('running', 1);

        expect(expireIdleAgentTask(ctx, 'quiet-task', child, { write: () => true })).to.equal('waiting-for-user');
        expect(killed).to.deep.equal([]);
        expect(ctx.tasks.get('quiet-task').state).to.equal('running');
    });

    it('leaves a task that already settled alone', () => {
        const { ctx, killed } = idleHarness('completed');

        expect(expireIdleAgentTask(ctx, 'quiet-task', child, { write: () => true })).to.equal('not-running');
        expect(killed).to.deep.equal([]);
        expect(ctx.tasks.get('quiet-task').state).to.equal('completed');
    });

    it('notifies a paused task, not a failed one', async () => {
        const sent: Array<{ title: string; body: string }> = [];
        const ctx = { webPush: { notify: async (request: { title: string; body: string }) => { sent.push(request); } } };
        const task = { id: 'quiet-task', title: 'Add tests', cwd: '/workspace/repo', state: 'interrupted' } as QaapAgentTask;

        await notifyCompletionExtracted(ctx as unknown as QaapAgentTaskRunnerContext, task);

        expect(sent).to.have.length(1);
        expect(sent[0].title).to.equal('Task paused');
        expect(sent[0].body).to.equal('Add tests timed out without output. Continue to pick up where it left off.');
    });
});
