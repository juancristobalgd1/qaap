// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { createComposerWorkspaceSheetNavGroup } from './qaap-sticky-composer-workspace-bar';

describe('workspace sheet tabs', () => {
    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM();
    });

    it('renders Project, Branch and Run in as three tabs with icon and label, the active one pressed', () => {
        const wrap = createComposerWorkspaceSheetNavGroup({ active: 'branch', onSelect: () => undefined } as Parameters<typeof createComposerWorkspaceSheetNavGroup>[0]);
        const bar = wrap.querySelector('.theia-qaap-segmented-bar.theia-mod-composer-workspace-sheet-nav');
        expect(bar).to.not.equal(null);
        const tabs = Array.from(bar!.querySelectorAll<HTMLButtonElement>(':scope > .theia-qaap-segmented-option'));
        expect(tabs).to.have.length(3);
        for (const tab of tabs) {
            expect(tab.querySelector('.codicon')).to.not.equal(null);
            expect(tab.querySelector('.theia-qaap-segmented-option-label')).to.not.equal(null);
        }
        expect(tabs.map(tab => tab.getAttribute('aria-pressed'))).to.deep.equal(['false', 'true', 'false']);
        expect(tabs[1].classList.contains('theia-mod-selected')).to.equal(true);
    });
});
