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
    findComposerBranchSheetRow,
} from './qaap-composer-branch-sheet-row';

describe('qaap-composer-branch-sheet-row', () => {

    beforeEach(() => {
        document.body.replaceChildren();
        closeComposerBranchSheetMenu();
        if (typeof PointerEvent === 'undefined') {
            class PointerEventPolyfill extends MouseEvent {
                constructor(type: string, eventInitDict?: MouseEventInit) {
                    super(type, eventInitDict);
                }
            }
            (globalThis as typeof globalThis & { PointerEvent: typeof PointerEvent }).PointerEvent =
                PointerEventPolyfill as unknown as typeof PointerEvent;
        }
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

    it('keeps branch action menus hidden until the kebab button is clicked', () => {
        const row = createComposerBranchSheetRow({
            branch: 'feature/hidden-menu',
            selected: false,
            onSelect: () => undefined,
            onCopy: () => undefined,
            onDelete: () => undefined,
        });
        document.body.append(row);
        const menu = row.querySelector<HTMLElement>('.theia-mobile-sticky-composer-sheet-branch-menu');
        expect(menu?.hidden).to.equal(true);
        expect(menu?.classList.contains('theia-mod-open')).to.equal(false);
    });

    it('opens only one branch menu at a time and closes on outside click', () => {
        const rowA = createComposerBranchSheetRow({
            branch: 'feature/a',
            selected: false,
            onSelect: () => undefined,
            onCopy: () => undefined,
            onDelete: () => undefined,
        });
        const rowB = createComposerBranchSheetRow({
            branch: 'feature/b',
            selected: false,
            onSelect: () => undefined,
            onCopy: () => undefined,
            onDelete: () => undefined,
        });
        document.body.append(rowA, rowB);
        const menuBtnA = rowA.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-branch-menu-btn');
        const menuBtnB = rowB.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-branch-menu-btn');
        const menuA = rowA.querySelector<HTMLElement>('.theia-mobile-sticky-composer-sheet-branch-menu');
        const menuB = rowB.querySelector<HTMLElement>('.theia-mobile-sticky-composer-sheet-branch-menu');

        menuBtnA?.click();
        expect(menuA?.hidden).to.equal(false);
        expect(menuA?.classList.contains('theia-mod-open')).to.equal(true);
        expect(menuB?.hidden).to.equal(true);

        menuBtnB?.click();
        expect(menuA?.hidden).to.equal(true);
        expect(menuB?.hidden).to.equal(false);

        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        expect(menuB?.hidden).to.equal(true);
        expect(menuB?.classList.contains('theia-mod-open')).to.equal(false);
    });

    it('copies the branch name via clipboard API', async () => {
        const copied = await copyComposerBranchName('work/test-branch');
        expect(copied).to.equal(true);
        expect((navigator.clipboard as { lastText?: string }).lastText).to.equal('work/test-branch');
    });

    it('omits delete for the currently selected branch', async () => {
        const row = createComposerBranchSheetRow({
            branch: 'main',
            selected: true,
            deleteDisabled: true,
            onSelect: () => undefined,
            onCopy: () => undefined,
            onDelete: () => undefined,
        });
        document.body.append(row);
        const menuBtn = row.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-branch-menu-btn');
        menuBtn?.click();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        const menu = document.body.querySelector('.theia-mobile-sticky-composer-sheet-branch-menu');
        const labels = [...menu?.querySelectorAll('.theia-mobile-sticky-composer-sheet-branch-menu-item') ?? []]
            .map(item => item.textContent?.trim());
        expect(labels).to.deep.equal(['Copy branch name']);
    });

    it('invokes onDelete and closes the menu when delete is chosen', async () => {
        let deleted = false;
        const row = createComposerBranchSheetRow({
            branch: 'feature/delete-me',
            selected: false,
            onSelect: () => undefined,
            onCopy: () => undefined,
            onDelete: () => { deleted = true; },
        });
        document.body.append(row);
        const menuBtn = row.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-branch-menu-btn');
        menuBtn?.click();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        const deleteItem = [...document.body.querySelectorAll<HTMLButtonElement>('.theia-mobile-sticky-composer-sheet-branch-menu-item')]
            .find(item => item.textContent?.includes('Delete branch'));
        deleteItem?.click();
        expect(deleted).to.equal(true);
        expect(document.body.querySelector('.theia-mobile-sticky-composer-sheet-branch-menu[hidden]')).to.not.equal(null);
    });

    it('finds branch rows by branch name', () => {
        const list = document.createElement('div');
        list.append(
            createComposerBranchSheetRow({
                branch: 'feature/a',
                selected: false,
                onSelect: () => undefined,
                onCopy: () => undefined,
                onDelete: () => undefined,
            }),
            createComposerBranchSheetRow({
                branch: 'feature/b',
                selected: false,
                onSelect: () => undefined,
                onCopy: () => undefined,
                onDelete: () => undefined,
            }),
        );
        expect(findComposerBranchSheetRow(list, 'feature/b')?.dataset.branchName).to.equal('feature/b');
        expect(findComposerBranchSheetRow(list, 'missing')).to.equal(undefined);
    });
});
