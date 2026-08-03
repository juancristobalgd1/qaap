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
