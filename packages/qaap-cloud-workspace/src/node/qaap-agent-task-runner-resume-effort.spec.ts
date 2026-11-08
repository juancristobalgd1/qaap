// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { resumeExtracted, retryExtracted } from './qaap-agent-task-runner-streaming2';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';

/** A task that ended without success, created with `effort` high. */
function finishedTask(id: string, state: 'failed' | 'interrupted'): QaapAgentTask {
    return {
        id,
        agentId: 'claude',
        command: 'fix the build',
        cwd: '/work/app',
        state,
        createdAt: 1,
        effort: 'high',
    } as unknown as QaapAgentTask;
}

/** Only the members retryExtracted and resumeExtracted read; `create` records the rebuilt request. */
function contextWith(task: QaapAgentTask): { ctx: QaapAgentTaskRunnerContext; requests: QaapCreateAgentTaskRequest[] } {
    const requests: QaapCreateAgentTaskRequest[] = [];
    const ctx = {
        tasks: new Map([[task.id, task]]),
        resolveTaskAgentId: () => 'claude',
        create: (request: QaapCreateAgentTaskRequest) => {
            requests.push(request);
            return { id: 'replacement' };
        },
    } as unknown as QaapAgentTaskRunnerContext;
    return { ctx, requests };
}

describe('qaap agent task runner retry and resume keep effort', () => {

    it('retries a failed task with the effort it was created with', () => {
        const { ctx, requests } = contextWith(finishedTask('t-failed', 'failed'));
        retryExtracted(ctx, 't-failed');
        expect(requests).to.have.length(1);
        expect(requests[0].effort).to.equal('high');
    });

    it('resumes an interrupted task with the effort it was created with', () => {
        const { ctx, requests } = contextWith(finishedTask('t-interrupted', 'interrupted'));
        resumeExtracted(ctx, 't-interrupted');
        expect(requests).to.have.length(1);
        expect(requests[0].effort).to.equal('high');
    });

    it('leaves effort unset when the original task had none', () => {
        const task = { ...finishedTask('t-none', 'failed'), effort: undefined } as QaapAgentTask;
        const { ctx, requests } = contextWith(task);
        retryExtracted(ctx, 't-none');
        expect(requests[0].effort).to.equal(undefined);
    });
});
