// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

class TestableQaapAgentConversationStore extends QaapAgentConversationStore {
    protected override isDirectory(): boolean {
        return true;
    }

    protected override async persist(): Promise<void> { /* no-op */ }
    protected override fire(): void { /* no-op */ }
}

describe('QaapAgentConversationStore task ownership', () => {
    it('propagates the conversation owner into the task-runner quota and helper-token lineage', () => {
        let ownerLogin: string | undefined;
        const store = new TestableQaapAgentConversationStore();
        Object.assign(store, {
            streamMetrics: { recordLatencyMark: () => undefined },
            taskRunner: {
                defaultAgent: () => 'shell',
                normalizeAgentId: (agentId: string) => agentId === 'shell' ? 'shell' : undefined,
                create: (request: QaapCreateAgentTaskRequest, owner?: string): QaapAgentTask => {
                    ownerLogin = owner;
                    return {
                        id: 'task-1',
                        title: request.title ?? '',
                        command: request.command ?? '',
                        cwd: request.cwd,
                        state: 'running',
                        createdAt: 1,
                        ownerLogin: owner,
                    };
                },
            },
        });

        store.create({ cwd: '/repo', agent: 'shell', message: 'echo ready' }, 'alice');
        expect(ownerLogin).to.equal('alice');
    });
});
