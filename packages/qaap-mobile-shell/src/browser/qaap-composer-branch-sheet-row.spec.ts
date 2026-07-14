// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import {
    closeComposerBranchSheetMenu,
    copyComposerBranchName,
    createComposerBranchSheetRow,
} from './qaap-composer-branch-sheet-row';

describe('qaap-composer-branch-sheet-row', () => {

    beforeEach(() => {
        document.body.replaceChildren();
        closeComposerBranchSheetMenu();
        const raf = (callback: FrameRequestCallback): number => setTimeout(() => callback(performance.now()), 0) as unknown as number;
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);
        Object.assign(navigator, {
            clipboard: {
                writeText: async (text: string) => {
                    (navigator.clipboard as { lastText?: string }).lastText = text;
                },
            },
        });
    });

    it('renders branch label and a kebab menu button per row', () => {
        const row = createComposerBranchSheetRow({
            branch: 'work/jc-2026-07-14-work-hub-chrome',
            selected: true,
            onSelect: () => undefined,
            onCopy: () => undefined,
            onDelete: () => undefined,
        });
        document.body.append(row);

        expect(row.querySelector('.theia-mobile-sticky-composer-sheet-option-label')?.textContent)
            .to.equal('work/jc-2026-07-14-work-hub-chrome');
        expect(row.querySelector('.theia-mobile-sticky-composer-sheet-branch-menu-btn')).to.not.equal(null);
        expect(row.querySelector('.codicon-check')).to.not.equal(null);
    });

    it('does not trigger branch select when opening the menu', () => {
        let selected = false;
        const row = createComposerBranchSheetRow({
            branch: 'feature/menu',
            selected: false,
            onSelect: () => { selected = true; },
            onCopy: () => undefined,
            onDelete: () => undefined,
        });
        document.body.append(row);
        const menuBtn = row.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-branch-menu-btn');
        menuBtn?.click();
        expect(selected).to.equal(false);
    });

    it('copies the branch name via clipboard API', async () => {
        const copied = await copyComposerBranchName('work/test-branch');
        expect(copied).to.equal(true);
        expect((navigator.clipboard as { lastText?: string }).lastText).to.equal('work/test-branch');
    });
});
