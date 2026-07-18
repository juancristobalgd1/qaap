// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { addEventListener, codiconArray } from '@theia/core/lib/browser/widgets/widget';
import { QAAP_PREVIEW_OVERFLOW_MENU_Z_INDEX } from './qaap-preview-overflow-actions';

export type PreviewEditMenuAction = 'annotate' | 'selection';

export interface MountPreviewEditMenuOptions {
    readonly anchor: HTMLElement;
    readonly onSelectSelection: () => void;
    readonly onSelectAnnotate?: () => void;
    readonly onClose: () => void;
}

/** Small anchored dropdown for preview Edit actions (annotate + element selection). */
export function mountPreviewEditMenu(options: MountPreviewEditMenuOptions): { menu: HTMLElement; dispose: () => void } {
    const menu = document.createElement('div');
    menu.className = 'qaap-preview-edit-menu';
    menu.setAttribute('role', 'menu');

    menu.append(createPreviewEditMenuRow(
        nls.localize('qaap/preview/editAnnotate', 'Annotate'),
        'annotate',
        createMessageCirclePlusIcon(),
    ));
    menu.append(createPreviewEditMenuRow(
        nls.localize('qaap/preview/editSelection', 'Selection'),
        'selection',
        'inspect',
    ));

    const activate = (action: PreviewEditMenuAction): void => {
        if (action === 'selection') {
            options.onSelectSelection();
        } else {
            options.onSelectAnnotate?.();
        }
        options.onClose();
    };

    for (const row of menu.querySelectorAll<HTMLButtonElement>('[data-edit-action]')) {
        const actionId = row.getAttribute('data-edit-action') as PreviewEditMenuAction | null;
        if (!actionId) {
            continue;
        }
        const onActivate = (e: Event): void => {
            e.preventDefault();
            e.stopPropagation();
            activate(actionId);
        };
        row.addEventListener('click', onActivate);
        row.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                onActivate(e);
            }
        });
    }

    document.body.append(menu);
    positionPreviewEditMenu(menu, options.anchor);
    menu.style.zIndex = QAAP_PREVIEW_OVERFLOW_MENU_Z_INDEX;

    const closeOnOutside = (e: MouseEvent): void => {
        const target = e.target as Node;
        if (menu.contains(target) || options.anchor.contains(target)) {
            return;
        }
        options.onClose();
    };

    const closeOnEscape = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            options.onClose();
        }
    };

    const dispose = (): void => {
        document.removeEventListener('click', closeOnOutside, true);
        document.removeEventListener('keydown', closeOnEscape, true);
        menu.remove();
    };

    requestAnimationFrame(() => {
        document.addEventListener('click', closeOnOutside, true);
        document.addEventListener('keydown', closeOnEscape, true);
    });

    return { menu, dispose };
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}

/** Lucide `message-circle-plus` — annotate affordance in the Edit menu. */
function createMessageCirclePlusIcon(): HTMLElement {
    const host = document.createElement('span');
    host.className = 'qaap-preview-edit-item-icon qaap-preview-edit-item-icon--svg';
    host.setAttribute('aria-hidden', 'true');
    const svg = svgEl('svg', {
        viewBox: '0 0 24 24',
        width: '14',
        height: '14',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
    });
    svg.append(
        svgEl('path', {
            d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
        }),
        svgEl('path', { d: 'M8 12h8' }),
        svgEl('path', { d: 'M12 8v8' }),
    );
    host.append(svg);
    return host;
}

function createPreviewEditMenuRow(
    label: string,
    action: PreviewEditMenuAction,
    icon: string | HTMLElement,
): HTMLButtonElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'qaap-preview-edit-item';
    row.setAttribute('role', 'menuitem');
    row.setAttribute('data-edit-action', action);
    let iconEl: HTMLElement;
    if (typeof icon === 'string') {
        iconEl = document.createElement('span');
        iconEl.classList.add('qaap-preview-edit-item-icon', ...codiconArray(icon));
        iconEl.setAttribute('aria-hidden', 'true');
    } else {
        iconEl = icon;
    }
    const text = document.createElement('span');
    text.className = 'qaap-preview-edit-item-label';
    text.textContent = label;
    row.append(iconEl, text);
    return row;
}

function positionPreviewEditMenu(menu: HTMLElement, anchor: HTMLElement): void {
    const margin = 8;
    const gap = 4;
    const anchorRect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.visibility = 'hidden';
    menu.style.pointerEvents = 'auto';
    const menuHeight = menu.offsetHeight || 1;
    let top = anchorRect.bottom + gap;
    const maxBottom = window.innerHeight - margin;
    if (top + menuHeight > maxBottom) {
        const aboveTop = anchorRect.top - gap - menuHeight;
        top = aboveTop >= margin ? aboveTop : Math.max(margin, maxBottom - menuHeight);
    }
    let right = window.innerWidth - anchorRect.right;
    right = Math.max(margin, right);
    menu.style.top = `${top}px`;
    menu.style.right = `${right}px`;
    menu.style.left = 'auto';
    menu.style.visibility = '';
}

export interface CreatePreviewEditButtonOptions {
    readonly onSelectSelection: () => void;
    readonly onSelectAnnotate?: () => void;
    readonly toDispose: DisposableCollection;
}

/** Workbench Edit control: opens anchored menu with Annotate and Selection (element picker). */
export function createPreviewEditButton(options: CreatePreviewEditButtonOptions): HTMLButtonElement {
    const editLabel = nls.localize('qaap/preview/edit', 'Edit');

    const button = document.createElement('button');
    button.type = 'button';
    button.title = editLabel;
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.classList.add(
        'theia-mini-browser-workbench-button',
        'qaap-preview-edit-button',
        ...codiconArray('edit'),
    );

    let menuDispose: (() => void) | undefined;

    const closeMenu = (): void => {
        menuDispose?.();
        menuDispose = undefined;
        button.setAttribute('aria-expanded', 'false');
        button.classList.remove('theia-mini-browser-workbench-button--active');
        button.focus();
    };

    const openMenu = (): void => {
        if (menuDispose) {
            closeMenu();
            return;
        }
        const mounted = mountPreviewEditMenu({
            anchor: button,
            onSelectAnnotate: () => options.onSelectAnnotate?.(),
            onSelectSelection: () => options.onSelectSelection(),
            onClose: closeMenu,
        });
        menuDispose = mounted.dispose;
        button.setAttribute('aria-expanded', 'true');
        button.classList.add('theia-mini-browser-workbench-button--active');
    };

    options.toDispose.push(addEventListener(button, 'click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu();
    }));
    options.toDispose.push({ dispose: () => closeMenu() });

    return button;
}
