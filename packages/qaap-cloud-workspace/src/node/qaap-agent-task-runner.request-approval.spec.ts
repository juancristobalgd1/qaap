// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';

class TestableQaapAgentTaskRunner extends QaapAgentTaskRunner {
    public override resolveAgentId(): string {
        return 'qaiq';
    }
}

function createRunner(): TestableQaapAgentTaskRunner {
    const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
    Object.assign(runner, {
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
});
