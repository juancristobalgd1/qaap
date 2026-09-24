// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure DOM helpers extracted from MobileProjectsPanel.

export function createHeaderIdeViewIcon(icon: string): HTMLElement {
    const span = document.createElement('span');
    span.className = `codicon ${icon} theia-mobile-projects-ide-view-picker-icon`;
    span.setAttribute('aria-hidden', 'true');
    return span;
}

export function createHeaderIdeViewChevron(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'codicon codicon-chevron-down theia-mobile-projects-ide-view-picker-chevron';
    span.setAttribute('aria-hidden', 'true');
    return span;
}

export function appendHeaderOverflowSeparator(menu: HTMLElement): void {
    if (!menu.childElementCount) {
        return;
    }
    const separator = document.createElement('div');
    separator.className = 'qaap-work-hub-toolbar-menu-separator';
    separator.setAttribute('role', 'separator');
    menu.append(separator);
}

export function positionHeaderIdeViewPickerMenu(
    menu: HTMLElement | undefined,
    btn: HTMLButtonElement | undefined,
): void {
    if (!menu || !btn || menu.hidden) {
        return;
    }
    const margin = 8;
    const gap = 6;
    const anchor = btn.getBoundingClientRect();
    const menuWidth = Math.max(menu.offsetWidth || menu.scrollWidth, 220);
    let left = anchor.right - menuWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
    menu.style.top = `${Math.round(anchor.bottom + gap)}px`;
    menu.style.left = `${Math.round(left)}px`;
}

export function positionHeaderOverflowMenu(
    menu: HTMLElement | undefined,
    btn: HTMLButtonElement,
): void {
    if (!menu || menu.hidden) {
        return;
    }
    const margin = 8;
    const gap = 6;
    const anchor = btn.getBoundingClientRect();
    const menuWidth = Math.max(menu.offsetWidth || menu.scrollWidth, 220);
    const menuHeight = menu.offsetHeight || menu.scrollHeight;
    let left = anchor.right - menuWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
    const below = anchor.bottom + gap;
    const above = anchor.top - menuHeight - gap;
    const top = below + menuHeight <= window.innerHeight - margin ? below : Math.max(margin, above);
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
}
