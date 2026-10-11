// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

class TestableQaapAgentConversationStore extends QaapAgentConversationStore {
    readonly events: QaapAgentConversationEvent[] = [];

    override isDirectory(): boolean {
        return true;
    }

    override async persist(): Promise<void> { /* no-op */ }
    override fire(event: QaapAgentConversationEvent): void {
        this.events.push(event);
    }
}

function createStore(): TestableQaapAgentConversationStore {
    const store = new TestableQaapAgentConversationStore();
    Object.assign(store, {
        streamMetrics: { recordLatencyMark: () => undefined },
        taskRunner: {
            defaultAgent: () => 'shell',
            normalizeAgentId: (agentId: string) => agentId === 'shell' || agentId === 'codex' ? agentId : undefined,
            create: (request: QaapCreateAgentTaskRequest): QaapAgentTask => ({
                id: 'task-1',
                title: request.title ?? '',
                command: request.command ?? '',
                cwd: request.cwd,
                state: 'running',
                createdAt: 1,
            }),
        },
    });
    return store;
}

/** Sidebar order follows `updatedAt`: opening or leaving a task must not move it to the top. */
describe('QaapAgentConversationStore update ordering', () => {
    it('keeps updatedAt when the composer preferences flushed on task switch are unchanged', () => {
        const store = createStore();
        const created = store.create({ cwd: '/repo', agent: 'shell', message: 'echo ready' }, 'alice');
        const before = store.get(created.id)!.updatedAt;
        const flush = {
            agent: 'shell',
            interactionModeId: '',
            approvalPolicyId: '',
            toolApprovalRules: { shell: false, network: false },
        };
        store.update(created.id, flush);
        store.events.length = 0;

        const next = store.update(created.id, flush);

        expect(next?.updatedAt).to.equal(before);
        expect(store.events.filter(event => event.type === 'updated')).to.have.length(0);
    });

    it('stores changed composer preferences without bumping the task to the top', () => {
        const store = createStore();
        const created = store.create({ cwd: '/repo', agent: 'shell', message: 'echo ready' }, 'alice');
        const before = store.get(created.id)!.updatedAt;

        const next = store.update(created.id, { agent: 'codex', interactionModeId: 'plan' });

        expect(next?.agentId).to.equal('codex');
        expect(next?.interactionModeId).to.equal('plan');
        expect(next?.updatedAt).to.equal(before);
    });

    it('still bumps updatedAt for a real change such as a rename', async () => {
        const store = createStore();
        const created = store.create({ cwd: '/repo', agent: 'shell', message: 'echo ready' }, 'alice');
        const before = store.get(created.id)!.updatedAt;
        await new Promise(resolve => setTimeout(resolve, 5));

        const next = store.update(created.id, { title: 'Renamed' });

        expect(next?.updatedAt).to.be.greaterThan(before);
    });
});
