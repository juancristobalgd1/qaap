// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { MobileWorkHubUnifiedSearchDialog } from './mobile-work-hub-unified-search-dialog';

disableImportJSDOM();

describe('MobileWorkHubUnifiedSearchDialog', () => {

    const registry = { commands: [], recent: [], isVisible: () => true } as unknown as CommandRegistry;

    function create(initialTab?: 'chats' | 'commands'): MobileWorkHubUnifiedSearchDialog {
        return new MobileWorkHubUnifiedSearchDialog(
            registry, [], () => undefined, () => undefined, document.createElement('button'), initialTab);
    }

    function selectedTabs(dialog: MobileWorkHubUnifiedSearchDialog): string[] {
        return Array.from(dialog.node.querySelectorAll('[role="tab"]'))
            .filter(tab => tab.getAttribute('aria-selected') === 'true')
            .map(tab => tab.textContent ?? '');
    }

    it('opens on the Chats tab by default', () => {
        const dialog = create();
        expect(selectedTabs(dialog)).to.deep.equal(['Chats']);
        expect(dialog.node.querySelector('input')?.placeholder).to.equal('Search chats');
    });

    it('respects the Commands initial tab', () => {
        const dialog = create('commands');
        expect(selectedTabs(dialog)).to.deep.equal(['Commands']);
        expect(dialog.node.querySelector('input')?.placeholder).to.equal('Search commands');
    });
});
