// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
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

    it('hides older failed duplicates when a newer non-failed run shares the title and hideSupersededBySuccess is set', () => {
        const rows = [
            summary({ id: 'fail-old', title: 'De que va esta app', updatedAt: 10, createdAt: 10 }),
            summary({ id: 'ok-new', status: 'idle', title: 'De que va esta app', updatedAt: 20, createdAt: 20 }),
            summary({ id: 'fail-newer', title: 'Other task', updatedAt: 30, createdAt: 30 }),
            // An older successful chat that later got a follow-up (updatedAt=50) must NOT hide a newer failed run.
            summary({ id: 'ok-older', status: 'idle', title: 'Other task', updatedAt: 50, createdAt: 10 }),
        ];
        const result = collapseOlderFailedDuplicateTitles(rows, { hideSupersededBySuccess: true });
        expect(result.conversations.map(row => row.id)).to.deep.equal(['ok-new', 'fail-newer', 'ok-older']);
        expect(result.hiddenFailedByKeptId.size).to.equal(0);

        // A failed row that is currently open (keepIds) stays visible even when a newer success exists.
        const keepingOpen = collapseOlderFailedDuplicateTitles(rows, {
            hideSupersededBySuccess: true,
            keepIds: new Set(['fail-old']),
        });
        expect(keepingOpen.conversations.map(row => row.id)).to.deep.equal(['fail-old', 'ok-new', 'fail-newer', 'ok-older']);
    });
});
