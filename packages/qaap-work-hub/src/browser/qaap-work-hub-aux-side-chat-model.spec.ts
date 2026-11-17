// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildSideChatContextPreamble, composeSideChatPrompt, stripSideChatPreamble } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-side-chat';
import {
    QAAP_WORK_HUB_AUX_PANEL_TAB_KINDS,
    QaapWorkHubAuxPanelModel,
} from './qaap-work-hub-aux-panel-model';
import {
    QAAP_WORK_HUB_SIDE_CHAT_TITLE_LIMIT,
    sideChatTitleFromMessage,
    sideChatToolCallCount,
} from './qaap-work-hub-aux-side-chat-model';

describe('qaap-work-hub-aux-side-chat-model', () => {

    describe('registry', () => {
        it('registers the side chat as a panel-own view after the pull request', () => {
            const kinds = [...QAAP_WORK_HUB_AUX_PANEL_TAB_KINDS];
            expect(kinds).to.include('side-chat');
            expect(kinds.indexOf('side-chat')).to.be.greaterThan(kinds.indexOf('pull-request'));
        });

        it('keeps one side chat tab: a second open focuses the first', () => {
            const model = new QaapWorkHubAuxPanelModel(() => 1);
            const first = model.openView('side-chat');
            const second = model.openView('side-chat');
            expect(second.id).to.equal(first.id);
            expect(model.tabs.filter(tab => tab.kind === 'side-chat')).to.have.length(1);
        });

        it('names a tab at runtime and drops the name when the tab closes', () => {
            const model = new QaapWorkHubAuxPanelModel(() => 1);
            const tab = model.openView('side-chat');
            model.setTabTitle(tab.id, 'Why is the build red?');
            expect(model.tabTitle(tab.id)).to.equal('Why is the build red?');
            model.closeTab(tab.id);
            expect(model.tabTitle(tab.id)).to.be.undefined;
            expect(model.recentlyClosed.map(entry => entry.kind)).to.deep.equal(['side-chat']);
        });

        it('clears a runtime name with undefined so the kind label applies again', () => {
            const model = new QaapWorkHubAuxPanelModel(() => 1);
            const tab = model.openView('side-chat');
            model.setTabTitle(tab.id, 'Title');
            model.setTabTitle(tab.id, undefined);
            expect(model.tabTitle(tab.id)).to.be.undefined;
        });
    });

    describe('sideChatTitleFromMessage', () => {
        it('uses the first message on one line', () => {
            expect(sideChatTitleFromMessage('  Why is\n  the build   red? ')).to.equal('Why is the build red?');
        });

        it('cuts a long message with an ellipsis within the limit', () => {
            const title = sideChatTitleFromMessage('x'.repeat(200))!;
            expect(title.length).to.equal(QAAP_WORK_HUB_SIDE_CHAT_TITLE_LIMIT);
            expect(title.endsWith('…')).to.be.true;
        });

        it('has no title for an empty message', () => {
            expect(sideChatTitleFromMessage('   ')).to.be.undefined;
        });
    });

    describe('stripSideChatPreamble', () => {
        const preamble = buildSideChatContextPreamble({
            title: 'Fix login',
            messages: [{ role: 'user', text: 'Make login work' }, { role: 'agent', text: 'Done' }],
        })!;

        it('returns the user words of a composed first prompt, never the preamble', () => {
            const stored = composeSideChatPrompt('Why red?', preamble, true);
            expect(stripSideChatPreamble(stored)).to.equal('Why red?');
        });

        it('keeps a message without a preamble as it is', () => {
            expect(stripSideChatPreamble('Second question')).to.equal('Second question');
        });
    });

    describe('sideChatToolCallCount', () => {
        it('counts tool calls only', () => {
            expect(sideChatToolCallCount([
                { type: 'thought' }, { type: 'tool_call' }, { type: 'tool_call' },
            ])).to.equal(2);
        });

        it('is zero without trace events', () => {
            expect(sideChatToolCallCount(undefined)).to.equal(0);
        });
    });
});
