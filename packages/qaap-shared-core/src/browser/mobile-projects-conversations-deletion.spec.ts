// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsConversations } from './mobile-projects-conversations';

describe('MobileProjectsConversations optimistic deletion', () => {
    let disableJSDOM: (() => void) | undefined;
    let conversationsCtor: typeof MobileProjectsConversations;

    before(() => {
        disableJSDOM = enableJSDOM();
        conversationsCtor = require('./mobile-projects-conversations').MobileProjectsConversations;
    });

    after(() => disableJSDOM?.());

    const summary: QaapAgentConversationSummaryDTO = {
        id: 'delete-me',
        cwd: '/workspace/project',
        agentId: 'qaiq',
        title: 'Delete me',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 0,
    };

    it('does not let a stale server snapshot resurrect a deleted row', () => {
        const conversations = new conversationsCtor() as MobileProjectsConversations & {
            applyConversationGroups(groups: ReadonlyArray<{
                readonly cwd: string;
                readonly conversations: ReadonlyArray<QaapAgentConversationSummaryDTO>;
            }>): void;
        };
        conversations.recordSnapshot(summary);
        conversations.removeSnapshot(summary.id, summary.cwd);

        conversations.applyConversationGroups([{ cwd: summary.cwd, conversations: [summary] }]);

        expect(conversations.findSummaryById(summary.id)).to.equal(undefined);
    });

    it('restores the row when an optimistic deletion fails', () => {
        const conversations = new conversationsCtor();
        conversations.recordSnapshot(summary);
        conversations.removeSnapshot(summary.id, summary.cwd);

        conversations.restoreSnapshot(summary);

        expect(conversations.findSummaryById(summary.id)).to.deep.equal(summary);
    });
});
