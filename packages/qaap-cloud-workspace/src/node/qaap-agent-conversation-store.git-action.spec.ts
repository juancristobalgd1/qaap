// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation, QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import { parseComposerGitActionDisplayMarker } from '@theia/qaap-mobile-shell/lib/common/qaap-composer-git-action-display';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

class GitActionStoreHarness extends QaapAgentConversationStore {
    seed(conversation: QaapAgentConversation): void {
        this.conversations.set(conversation.id, conversation);
    }

    protected override async persist(): Promise<void> { }

    protected override fire(_event: QaapAgentConversationEvent): void { }
}

describe('QaapAgentConversationStore git actions', () => {
    let store: GitActionStoreHarness;

    beforeEach(() => {
        store = new GitActionStoreHarness();
        store.seed({
            id: 'conversation-1',
            cwd: '/tmp/project',
            agentId: 'qaiq',
            title: 'UI task',
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messages: [
                { id: 'user-1', role: 'user', content: 'Ship it', createdAt: 1 },
                { id: 'agent-1', role: 'agent', content: 'Done.', createdAt: 2 },
            ],
        });
    });

    it('appends a display-only git action row without starting a turn', () => {
        const next = store.recordGitAction('conversation-1', {
            action: 'commit-push',
            label: 'Commit & Push',
            branch: 'main',
            status: 'completed',
            insertions: 4,
            deletions: 1,
        });
        expect(next?.status).to.equal('idle');
        expect(next?.messages).to.have.length(3);
        const gitRow = next?.messages[2];
        expect(gitRow?.role).to.equal('user');
        const parsed = parseComposerGitActionDisplayMarker(gitRow?.content ?? '');
        expect(parsed).to.deep.include({
            action: 'commit-push',
            label: 'Commit & Push',
            branch: 'main',
            status: 'completed',
            insertions: 4,
            deletions: 1,
        });
    });
});
