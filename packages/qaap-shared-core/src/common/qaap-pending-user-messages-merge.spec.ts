// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { mergePendingUserMessagesWithLocalQueue } from './qaap-pending-user-messages-merge';

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
