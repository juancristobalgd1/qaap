// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';
import { collapseOlderFailedDuplicateTitles } from './qaap-failed-duplicate-collapse';

const summary = (
    overrides: Partial<QaapAgentConversationSummaryDTO>,
): QaapAgentConversationSummaryDTO => ({
    id: 'c1',
    title: 'Find and fix a bug',
    status: 'failed',
    createdAt: 1,
    updatedAt: 1,
    messageCount: 2,
    agentId: 'qaiq',
    cwd: '/repo',
    ...overrides,
} as QaapAgentConversationSummaryDTO);

describe('collapseOlderFailedDuplicateTitles', () => {
    it('keeps the newest failed run per title and hides older siblings', () => {
        const rows = [
            summary({ id: 'old', updatedAt: 10, createdAt: 10 }),
            summary({ id: 'new', updatedAt: 30, createdAt: 30 }),
            summary({ id: 'mid', updatedAt: 20, createdAt: 20 }),
            summary({ id: 'ok', status: 'idle', title: 'Find and fix a bug', updatedAt: 40 }),
        ];
        const result = collapseOlderFailedDuplicateTitles(rows);
        expect(result.conversations.map(row => row.id)).to.deep.equal(['new', 'ok']);
        expect(result.hiddenFailedByKeptId.get('new')).to.equal(2);
        expect(result.hiddenFailedByKeptId.has('ok')).to.equal(false);
    });

    it('leaves unique failed titles untouched', () => {
        const rows = [
            summary({ id: 'a', title: 'One' }),
            summary({ id: 'b', title: 'Two' }),
        ];
        const result = collapseOlderFailedDuplicateTitles(rows);
        expect(result.conversations.map(row => row.id)).to.deep.equal(['a', 'b']);
        expect(result.hiddenFailedByKeptId.size).to.equal(0);
    });
});
