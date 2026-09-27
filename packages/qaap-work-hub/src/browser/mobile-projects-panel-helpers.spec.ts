// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { renderHeaderOverflowMenuItems } from './mobile-projects-panel-helpers';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('renderHeaderOverflowMenuItems', () => {

    useSuiteJSDOM();

    it('keeps empty-chat actions visible while disabling conversation-only copy', () => {
        const menu = document.createElement('div');
        renderHeaderOverflowMenuItems(menu, {
            closeHeaderOverflowMenu: () => undefined,
            openHeaderNewChat: () => undefined,
            isHeaderNewChatVisible: () => true,
            openWorkHubSessionsSidebar: () => undefined,
            copyActiveConversationToClipboard: async () => undefined,
            isCopyConversationEnabled: () => false,
            openAiConfigurationSheet: () => undefined,
            appendHeaderOverflowSeparator: () => undefined,
            isHeaderOverflowMenuItemVisible: () => true,
            isHeaderOverflowMenuItemEnabled: () => true,
            commands: { executeCommand: () => undefined },
        });

        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.qaap-work-hub-toolbar-menu-item'));
        expect(items.map(item => item.textContent?.trim())).to.include.members([
            'New Chat',
            'Show Chats',
            'Copy full conversation',
            'AI Settings',
        ]);
        const copy = items.find(item => item.textContent?.includes('Copy full conversation'));
        expect(copy?.disabled).to.equal(true);
        expect(copy?.getAttribute('aria-disabled')).to.equal('true');
    });
});
