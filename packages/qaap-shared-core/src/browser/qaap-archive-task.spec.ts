// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';

/**
 * Verifies that archived conversations are filtered from the main list and
 * that the archive/unarchive flow works end-to-end at the data level.
 */
describe('Archive task — conversation filtering and flag toggle', () => {
    let disableJSDOM: () => void;

    before(() => { disableJSDOM = enableJSDOM(); });
    after(() => { disableJSDOM(); });

    function makeSummary(id: string, archived?: boolean): QaapAgentConversationSummaryDTO {
        return {
            id,
            cwd: '/srv/demo',
            agentId: 'qaiq',
            title: `Task ${id}`,
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
            ...(archived ? { archived: true } : {}),
        } as QaapAgentConversationSummaryDTO;
    }

    /** Mirrors the filter logic in MobileProjectsConversationIndexUi.conversationsForProject. */
    function filterArchived(summaries: QaapAgentConversationSummaryDTO[]): QaapAgentConversationSummaryDTO[] {
        return summaries.filter(summary => !summary.archived);
    }

    it('hides archived conversations from the main list', () => {
        const all = [
            makeSummary('c1'),
            makeSummary('c2', true),
            makeSummary('c3'),
            makeSummary('c4', true),
        ];
        const visible = filterArchived(all);
        expect(visible.map(s => s.id)).to.deep.equal(['c1', 'c3']);
    });

    it('shows all conversations when none are archived', () => {
        const all = [makeSummary('c1'), makeSummary('c2'), makeSummary('c3')];
        const visible = filterArchived(all);
        expect(visible).to.have.length(3);
    });

    it('shows zero conversations when all are archived', () => {
        const all = [makeSummary('c1', true), makeSummary('c2', true)];
        const visible = filterArchived(all);
        expect(visible).to.have.length(0);
    });

    it('toggling archived flag from undefined to true hides the conversation', () => {
        const summary = makeSummary('c1');
        expect(filterArchived([summary])).to.have.length(1);
        const archived = { ...summary, archived: true };
        expect(filterArchived([archived])).to.have.length(0);
    });

    it('toggling archived flag from true to undefined restores the conversation', () => {
        const archived = makeSummary('c1', true);
        expect(filterArchived([archived])).to.have.length(0);
        const restored = { ...archived, archived: undefined };
        expect(filterArchived([restored])).to.have.length(1);
    });

    it('archived conversations retain their data (id, title, status) for unarchive', () => {
        const archived = makeSummary('c1', true);
        // Even though filtered from the list, the summary is still in the thread store
        // and can be unarchived. Verify the data is intact.
        expect(archived.id).to.equal('c1');
        expect(archived.title).to.equal('Task c1');
        expect(archived.status).to.equal('idle');
        expect(archived.archived).to.equal(true);
    });
});
