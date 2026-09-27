// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export const COMPOSER_BRANCH_SHEET_ROW_SELECTOR = '.theia-mobile-sticky-composer-sheet-branch-row';

export interface ComposerBranchSheetRowOptions {
    readonly branch: string;
    readonly selected: boolean;
    /** When true, the delete action is omitted (e.g. currently checked-out branch). */
    readonly deleteDisabled?: boolean;
    readonly onSelect: () => void;
    readonly onCopy: () => void | Promise<void>;
    readonly onDelete: () => void | Promise<void>;
}

export function findComposerBranchSheetRow(list: HTMLElement, branch: string): HTMLElement | undefined {
    return [...list.querySelectorAll<HTMLElement>(COMPOSER_BRANCH_SHEET_ROW_SELECTOR)]
        .find(row => row.dataset.branchName === branch);
}

export function indexComposerBranchSheetRow(list: HTMLElement, branch: string): number {
    return [...list.querySelectorAll<HTMLElement>(COMPOSER_BRANCH_SHEET_ROW_SELECTOR)]
        .findIndex(row => row.dataset.branchName === branch);
}

let openBranchMenu: {
    readonly menu: HTMLElement;
    readonly menuBtn: HTMLButtonElement;
    readonly row: HTMLElement;
    readonly onDismiss: () => void;
} | undefined;

export function closeComposerBranchSheetMenu(): void {
    if (!openBranchMenu) {
        return;
    }
    const { menu, menuBtn, row, onDismiss } = openBranchMenu;
    menu.hidden = true;
    menu.classList.remove('theia-mod-open', 'theia-mod-floating');
    menu.style.top = '';
    menu.style.left = '';
    if (row.contains(menu)) {
        row.append(menu);
    }
    menuBtn.setAttribute('aria-expanded', 'false');
    row.classList.remove('theia-mod-menu-open');
    document.removeEventListener('pointerdown', onDismiss, true);
    window.removeEventListener('resize', onDismiss);
    openBranchMenu = undefined;
}

function positionComposerBranchSheetMenu(menu: HTMLElement, anchor: HTMLElement): void {
    const margin = 8;
    const gap = 4;
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = Math.max(menu.offsetWidth, 180);
    const menuHeight = menu.offsetHeight;
    let top = anchorRect.bottom + gap;
    const maxBottom = window.innerHeight - margin;
    if (top + menuHeight > maxBottom) {
        const aboveTop = anchorRect.top - gap - menuHeight;
        top = aboveTop >= margin ? aboveTop : Math.max(margin, maxBottom - menuHeight);
    }
    let left = anchorRect.right - menuWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.zIndex = '14050';
}

function toggleComposerBranchSheetMenu(
    row: HTMLElement,
    menu: HTMLElement,
    menuBtn: HTMLButtonElement,
): void {
    if (openBranchMenu?.menu === menu) {
        closeComposerBranchSheetMenu();
        return;
    }
    closeComposerBranchSheetMenu();
    const onDismiss = (event?: Event): void => {
        if (event instanceof PointerEvent) {
            const target = event.target;
            if (target instanceof Node && (menu.contains(target) || menuBtn.contains(target))) {
                return;
            }
        }
        closeComposerBranchSheetMenu();
    };
    openBranchMenu = { menu, menuBtn, row, onDismiss };
    menu.hidden = false;
    menu.classList.add('theia-mod-open', 'theia-mod-floating');
    document.body.append(menu);
    menuBtn.setAttribute('aria-expanded', 'true');
    row.classList.add('theia-mod-menu-open');
    window.requestAnimationFrame(() => {
        if (openBranchMenu?.menu === menu) {
            positionComposerBranchSheetMenu(menu, menuBtn);
        }
    });
    document.addEventListener('pointerdown', onDismiss, true);
    window.addEventListener('resize', onDismiss);
}

function appendComposerBranchSheetMenuItem(
    menu: HTMLElement,
    options: {
        readonly label: string;
        readonly iconClass: string;
        readonly danger?: boolean;
        readonly onSelect: () => void | Promise<void>;
    },
): void {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theia-mobile-sticky-composer-sheet-branch-menu-item';
    if (options.danger) {
        item.classList.add('theia-mod-danger');
    }
    item.setAttribute('role', 'menuitem');
    const icon = document.createElement('span');
    icon.className = `codicon ${options.iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = options.label;
    item.append(icon, label);
    item.addEventListener('click', event => {
        event.stopPropagation();
        closeComposerBranchSheetMenu();
        void options.onSelect();
    });
    menu.append(item);
}

export async function copyComposerBranchName(branch: string): Promise<boolean> {
    const text = branch.trim();
    if (!text) {
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

export function createComposerBranchSheetRow(options: ComposerBranchSheetRowOptions): HTMLElement {
    const row = document.createElement('div');
    row.className = 'theia-mobile-sticky-composer-sheet-branch-row';
    row.dataset.branchName = options.branch;
    if (options.selected) {
        row.classList.add('theia-mod-selected');
    }

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'theia-mobile-sticky-composer-sheet-option theia-mod-branch-select';
    const content = document.createElement('span');
    content.className = 'theia-mobile-sticky-composer-sheet-option-content';
    const label = document.createElement('span');
    label.className = 'theia-mobile-sticky-composer-sheet-option-label';
    label.textContent = options.branch;
    content.append(label);
    if (options.selected) {
        const check = document.createElement('span');
        check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
        check.setAttribute('aria-hidden', 'true');
        content.append(check);
    }
    selectBtn.append(content);
    selectBtn.addEventListener('click', () => options.onSelect());

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'theia-mobile-sticky-composer-sheet-branch-menu-btn';
    menuBtn.setAttribute(
        'aria-label',
        nls.localize('qaap/composerWorkspace/branchMenuAria', 'Branch actions for {0}', options.branch),
    );
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    const menuIcon = document.createElement('span');
    menuIcon.className = 'codicon codicon-kebab-vertical';
    menuIcon.setAttribute('aria-hidden', 'true');
    menuBtn.append(menuIcon);

    const menu = document.createElement('div');
    menu.className = 'theia-mobile-sticky-composer-sheet-branch-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    appendComposerBranchSheetMenuItem(menu, {
        label: nls.localize('qaap/composerWorkspace/branchCopyName', 'Copy branch name'),
        iconClass: 'codicon-copy',
        onSelect: options.onCopy,
    });
    if (!options.deleteDisabled) {
        appendComposerBranchSheetMenuItem(menu, {
            label: nls.localize('qaap/composerWorkspace/branchDelete', 'Delete branch'),
            iconClass: 'codicon-trash',
            danger: true,
            onSelect: options.onDelete,
        });
    }

    menuBtn.addEventListener('click', event => {
        event.stopPropagation();
        toggleComposerBranchSheetMenu(row, menu, menuBtn);
    });
    menuBtn.addEventListener('keydown', event => event.stopPropagation());

    row.append(selectBtn, menuBtn, menu);
    return row;
}
