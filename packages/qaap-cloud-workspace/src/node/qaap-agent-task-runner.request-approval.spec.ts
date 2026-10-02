// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';

class TestableQaapAgentTaskRunner extends QaapAgentTaskRunner {
    public agentIdForTest = 'qaiq';

    public override resolveAgentId(): string {
        return this.agentIdForTest;
    }
}

function createRunner(agentId = 'qaiq'): TestableQaapAgentTaskRunner {
    const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
    Object.assign(runner, {
        agentIdForTest: agentId,
        tasks: new Map<string, QaapAgentTask>(),
        queuedCreateRequests: new Map(),
        processes: new Map(),
        maxConcurrentAgents: () => 4,
        ownerAtConcurrencyCap: () => false,
        resolveAgentModelForRequest: () => undefined,
        isDirectory: () => true,
        persist: async () => undefined,
        spawnProcessWhenReady: async () => undefined,
        onDidChangeTaskEmitter: { fire: () => undefined },
    });
    return runner;
}

describe('QaapAgentTaskRunner request-approval policy', () => {

    it('keeps "Request approval" tasks interactive even when autoApprove is omitted or stale', () => {
        const runner = createRunner();
        const base: QaapCreateAgentTaskRequest = { command: 'echo test', cwd: '/repo', approvalPolicyId: 'request-approval' };
        expect(runner.create(base, 'alice').autoApprove).to.equal(false);
        expect(runner.create({ ...base, autoApprove: true }, 'alice').autoApprove).to.equal(false);
    });

    it('leaves other policies on the explicit/default auto-approve resolution', () => {
        const runner = createRunner();
        expect(runner.create({ command: 'echo test', cwd: '/repo', approvalPolicyId: 'approve-for-me' }, 'alice').autoApprove).to.equal(true);
        expect(runner.create({ command: 'echo test', cwd: '/repo', autoApprove: false }, 'alice').autoApprove).to.equal(false);
    });

    it('derives read-only enforcement from Plan mode even when the caller omits readOnlyWorkspace', () => {
        const task = createRunner().create({
            prompt: 'Summarize this project',
            cwd: '/repo',
            interactionModeId: 'plan',
            approvalPolicyId: 'full-access',
            autoApprove: true,
        }, 'alice');

        expect(task.readOnlyWorkspace).to.equal(true);
    });

    it('rejects shell tasks in Plan mode before they are stored or spawned', () => {
        const runner = createRunner();

        expect(() => runner.create({ command: 'ls -la', cwd: '/repo', interactionModeId: 'plan' }, 'alice'))
            .to.throw(/Plan mode does not allow shell tasks/);
        expect(runner.tasks.size).to.equal(0);
    });

    it('rejects Plan mode when the selected backend has no verified read-only controls', () => {
        const runner = createRunner('grok');

        expect(() => runner.create({ prompt: 'Summarize this project', cwd: '/repo', interactionModeId: 'plan' }, 'alice'))
            .to.throw(/cannot be restricted to read-only access/);
        expect(runner.tasks.size).to.equal(0);
    });
});
