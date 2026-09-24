// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsConversationsContext } from './mobile-projects-conversations-context';

describe('MobileProjectsConversations live summary refresh', () => {
    let disableJSDOM: (() => void) | undefined;
    let conversationsCtor: typeof MobileProjectsConversations;
    let streaming: typeof import('./mobile-projects-conversations-streaming');

    before(() => {
        disableJSDOM = enableJSDOM();
        conversationsCtor = require('./mobile-projects-conversations').MobileProjectsConversations;
        streaming = require('./mobile-projects-conversations-streaming');
    });

    after(() => disableJSDOM?.());

    const summary: QaapAgentConversationSummaryDTO = {
        id: 'live-1',
        cwd: '/workspace/project',
        agentId: 'qaiq',
        title: 'Live',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 1,
        lastMessageRole: 'user',
    };

    it('updates the row preview from a live message (excerpt helper is in scope)', () => {
        const conversations = new conversationsCtor();
        conversations.recordSnapshot(summary);

        streaming.refreshSummaryFromLiveMessageExtracted(conversations as MobileProjectsConversationsContext, {
            type: 'message',
            conversationId: summary.id,
            cwd: summary.cwd,
            message: { id: 'm1', role: 'agent', content: '  hello   world  ', createdAt: 5 },
        });

        const updated = conversations.findSummaryById(summary.id);
        expect(updated?.lastMessagePreview).to.equal('hello world');
        expect(updated?.messageCount).to.equal(2);
    });

    it('reads JSON through the file service (bufferToString helper is in scope)', async () => {
        const conversations = new conversationsCtor();
        (conversations as unknown as { fileService: unknown }).fileService = {
            readFile: async () => ({ value: { toString: () => '{"ok":true}' } }),
        };
        const URI = require('@theia/core/lib/common/uri').default;
        const result = await conversations.readJson<{ ok: boolean }>(new URI('file:///tmp/session.json'));
        expect(result).to.deep.equal({ ok: true });
    });
});
