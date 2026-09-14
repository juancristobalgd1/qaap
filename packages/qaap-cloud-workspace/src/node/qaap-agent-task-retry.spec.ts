// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import { retryExtracted } from './qaap-agent-task-runner-streaming2';

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

        const retried = retryExtracted(ctx, original.id);

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

        expect(retryExtracted(ctx, 'running')).to.equal(undefined);
        expect(retryExtracted(ctx, 'blocked')).to.equal(undefined);
        expect(retryExtracted(ctx, 'completed')).to.equal(undefined);
        expect(creates).to.equal(0);
    });
});
