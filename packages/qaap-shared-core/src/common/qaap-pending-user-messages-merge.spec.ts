// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { mergePendingUserMessagesWithLocalQueue, resolveQueuedFollowUpBaseConversation } from './qaap-pending-user-messages-merge';
import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';

describe('mergePendingUserMessagesWithLocalQueue', () => {
    it('keeps server pending rows and appends local-only drafts', () => {
        const merged = mergePendingUserMessagesWithLocalQueue(
            [{ id: 'srv-1', content: 'first', createdAt: 1 }],
            [
                { draft: 'first', serverPendingId: 'srv-1', serverSynced: true },
                { draft: 'second' },
            ],
        );
        expect(merged.map(item => item.content)).to.deep.equal(['first', 'second']);
        expect(merged[1].id.startsWith('local-queue-')).to.equal(true);
    });

    it('drops stale local-queue rows after the draft leaves the composer queue', () => {
        const merged = mergePendingUserMessagesWithLocalQueue(
            [
                { id: 'srv-1', content: 'keep', createdAt: 1 },
                { id: 'local-queue-0-abc', content: 'gone', createdAt: 2 },
            ],
            [{ draft: 'keep', serverPendingId: 'srv-1' }],
        );
        expect(merged.map(item => item.content)).to.deep.equal(['keep']);
    });

    it('does not duplicate by matching draft content', () => {
        const merged = mergePendingUserMessagesWithLocalQueue(
            [{ id: 'srv-1', content: 'same text', createdAt: 1 }],
            [{ draft: 'same text' }],
        );
        expect(merged).to.have.length(1);
    });
});

describe('resolveQueuedFollowUpBaseConversation', () => {
    const summary = {
        id: 'c1',
        cwd: '/repo',
        agentId: 'qaiq',
        title: 'Task',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 2,
    } as QaapAgentConversationSummaryDTO;

    it('keeps the cached snapshot of the same conversation', () => {
        const cached = { id: 'c1', messages: [{ id: 'm1' }] } as never;
        expect(resolveQueuedFollowUpBaseConversation(cached, summary)).to.equal(cached);
    });

    it('paints over an empty copy of the summary while no snapshot exists yet', () => {
        const base = resolveQueuedFollowUpBaseConversation(undefined, summary);
        expect(base.id).to.equal('c1');
        expect(base.status).to.equal('streaming');
        expect(base.messages).to.deep.equal([]);
    });

    it('does not reuse a snapshot of another conversation', () => {
        const base = resolveQueuedFollowUpBaseConversation({ id: 'other', messages: [] } as never, summary);
        expect(base.id).to.equal('c1');
    });
});
