// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { createExtracted, retryExtracted, resumeExtracted } from './qaap-agent-task-runner-streaming2';

describe('Qaap standalone task retry', () => {
    it('rebuilds a failed coding task from its durable prompt and preserves its execution context', () => {
        const original = {
            id: 'failed-task',
            title: 'Fix preview',
            command: 'Fix the preview startup failure and run the relevant checks.',
            cwd: '/workspace/repo',
            agentId: 'qaiq',
            state: 'failed' as const,
            createdAt: Date.now(),
            ownerLogin: 'alice',
            agentModel: { provider: 'openai' as const, vendor: 'openai', modelId: 'gpt-test' },
            autoApprove: true,
            readOnlyWorkspace: false,
            externalReview: true,
        };
        let request: Record<string, unknown> | undefined;
        let owner: string | undefined;
        const ctx = {
            tasks: new Map([[original.id, original]]),
            resolveTaskAgentId: () => original.agentId,
            create: (next: Record<string, unknown>, login?: string) => {
                request = next;
                owner = login;
                return { ...original, id: 'retried-task', state: 'queued' as const };
            },
        };

        const retried = retryExtracted(ctx as unknown as QaapAgentTaskRunnerContext, original.id);

        expect(retried?.id).to.equal('retried-task');
        expect(owner).to.equal('alice');
        expect(request).to.deep.include({
            title: original.title,
            prompt: original.command,
            agent: original.agentId,
            cwd: original.cwd,
            agentModel: original.agentModel,
            qaiqModel: original.agentModel,
            autoApprove: true,
            readOnlyWorkspace: false,
            externalReview: true,
        });
    });

    it('does not retry a task that is still running, blocked, or completed', () => {
        let creates = 0;
        const ctx = {
            tasks: new Map([
                ['running', { id: 'running', state: 'running' }],
                ['blocked', { id: 'blocked', state: 'blocked' }],
                ['completed', { id: 'completed', state: 'completed' }],
            ]),
            create: () => { creates++; },
        };

        expect(retryExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'running')).to.equal(undefined);
        expect(retryExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'blocked')).to.equal(undefined);
        expect(retryExtracted(ctx as unknown as QaapAgentTaskRunnerContext, 'completed')).to.equal(undefined);
        expect(creates).to.equal(0);
    });

    it('continues an interrupted task from its durable command', () => {
        const original = {
            id: 'interrupted-task',
            title: 'Recover preview',
            command: 'npm run dev',
            cwd: '/workspace/repo',
            agentId: 'shell',
            state: 'interrupted' as const,
            createdAt: Date.now(),
            ownerLogin: 'alice',
        };
        let request: Record<string, unknown> | undefined;
        const ctx = {
            tasks: new Map<string, any>([[original.id, original]]),
            resumingTaskIds: new Map(),
            resolveTaskAgentId: () => original.agentId,
            create: (next: Record<string, unknown>) => {
                request = next;
                const resumed = { ...original, id: 'resumed-task', state: 'queued' as const, resumedFromTaskId: 'interrupted-task' };
                ctx.tasks.set(resumed.id, resumed);
                return resumed;
            },
        };

        const resumed = resumeExtracted(ctx as unknown as QaapAgentTaskRunnerContext, original.id);

        expect(resumed?.id).to.equal('resumed-task');
        expect(request).to.deep.include({
            title: original.title,
            command: original.command,
            cwd: original.cwd,
            autoApprove: undefined,
            resumedFromTaskId: original.id,
        });
        expect(resumeExtracted(ctx as unknown as QaapAgentTaskRunnerContext, original.id)?.id).to.equal('resumed-task');
    });

    it('returns the existing task for a repeated create clientRequestId', () => {
        const ctx = {
            recoveryState: 'ready',
            storageWriteFailed: false,
            tasks: new Map(),
            clientRequestTaskIds: new Map(),
            processes: new Map(),
            isDirectory: () => true,
            resolveAgentId: () => 'shell',
            normalizeAgentId: () => 'shell',
            extractLastAgentMention: () => undefined,
            countRunningTasks: () => 0,
            maxConcurrentAgents: () => 1,
            ownerAtConcurrencyCap: () => false,
            resolveAgentModelForRequest: () => undefined,
            spawnProcessWhenReady: () => undefined,
            persist: () => Promise.resolve(),
            onDidChangeTaskEmitter: { fire: () => undefined },
        };
        const request = { command: 'echo hello', cwd: '/workspace/repo', clientRequestId: 'submit-1' };

        const first = createExtracted(ctx as unknown as QaapAgentTaskRunnerContext, request, 'alice');
        const second = createExtracted(ctx as unknown as QaapAgentTaskRunnerContext, request, 'alice');

        expect(second).to.equal(first);
        expect(ctx.tasks.size).to.equal(1);
    });
});
