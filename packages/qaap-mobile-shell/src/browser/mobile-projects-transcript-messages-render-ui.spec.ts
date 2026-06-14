// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';
import {
    clearAgentTranscriptEmptyState,
    MobileProjectsTranscriptMessagesRenderUi,
} from './mobile-projects-transcript-messages-render-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';

describe('mobile-projects-transcript-messages-render-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('clearAgentTranscriptEmptyState removes idle quick actions chrome', () => {
        const messageHost = document.createElement('div');
        messageHost.className = 'theia-mobile-agent-transcript theia-mod-empty-chat';
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-agent-transcript-empty';
        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agent-transcript-empty-actions';
        empty.append(actions);
        messageHost.append(empty);

        clearAgentTranscriptEmptyState(messageHost);

        expect(messageHost.classList.contains('theia-mod-empty-chat')).to.equal(false);
        expect(messageHost.querySelector('.theia-mobile-agent-transcript-empty-actions')).to.equal(null);
    });

    it('tryPatchStreamingTranscriptMessages clears empty quick actions before appending agent rows', () => {
        const messageHost = document.createElement('div');
        messageHost.className = 'theia-mobile-agent-transcript theia-mod-empty-chat';
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-agent-transcript-empty';
        empty.append(Object.assign(document.createElement('div'), { className: 'theia-mobile-agent-transcript-empty-actions' }));
        messageHost.append(empty);

        const userRow = document.createElement('div');
        userRow.className = 'theia-mobile-agent-transcript-msg theia-mod-user';
        messageHost.append(userRow);
        messageHost.scrollTo = () => undefined;
        Object.defineProperty(messageHost, 'scrollTop', { value: 0, writable: true });
        Object.defineProperty(messageHost, 'clientHeight', { value: 100 });
        Object.defineProperty(messageHost, 'scrollHeight', { value: 100 });

        const baseConversation: QaapAgentConversationDTO = {
            id: 'conv-1',
            cwd: '/tmp/demo',
            agentId: 'task',
            title: 'Fix login',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'user-1',
                role: 'user',
                content: 'Fix login',
                createdAt: 1,
            }],
        };
        const nextConversation: QaapAgentConversationDTO = {
            ...baseConversation,
            messages: [
                ...baseConversation.messages,
                {
                    id: 'agent-1',
                    role: 'agent',
                    content: 'I will inspect the repository structure.',
                    createdAt: 2,
                },
            ],
        };

        const host = {
            transcriptUi: {
                shouldVirtualize: () => false,
                activeList: undefined,
            },
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptLastConv: baseConversation,
            transcriptLastRenderedConversationId: baseConversation.id,
            transcriptLastRenderedMessageId: 'user-1',
            transcriptHeaderUi: {
                refreshTranscriptExecutionChrome: () => undefined,
            },
        } as unknown as MobileProjectsTranscriptMessagesHost;

        const renderUi = new MobileProjectsTranscriptMessagesRenderUi(
            host,
            {
                shouldEmbedAgentsHubRecentsInWorkspaceTranscript: () => false,
                renderTeamSectionInTranscript: () => undefined,
                renderInlineApproval: () => undefined,
            } as unknown as import('./work-hub-transcript-bridge').WorkHubTranscriptBridge,
            {
                renderTranscriptStreamingMarkdown: () => undefined,
                renderTranscriptMarkdown: () => undefined,
                settleTranscriptStreamingContent: () => undefined,
            } as never,
            {} as never,
            {
                createTranscriptAgentSegmentsRow: () => {
                    const row = document.createElement('div');
                    row.className = 'theia-mobile-agent-transcript-msg theia-mod-agent';
                    return row;
                },
                createTranscriptStreamingActivityRow: () => document.createElement('div'),
            } as never,
            {
                renderTranscriptRichContent: () => undefined,
            } as never,
        );

        const patched = renderUi.tryPatchStreamingTranscriptMessages(messageHost, nextConversation);

        expect(patched).to.equal(true);
        expect(messageHost.querySelector('.theia-mobile-agent-transcript-empty-actions')).to.equal(null);
        expect(messageHost.querySelector('.theia-mobile-agent-transcript-msg.theia-mod-agent')).to.not.equal(null);
    });
});
