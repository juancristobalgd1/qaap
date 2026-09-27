// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export function renderAgentPickerSkeleton(list: HTMLElement, rowCount = 6): void {
    list.setAttribute('aria-busy', 'true');
    const announcement = document.createElement('span');
    announcement.className = 'theia-qaap-agent-sheet-loading-announcement';
    announcement.setAttribute('role', 'status');
    announcement.textContent = nls.localize(
        'qaap/mobileProjects/stickyComposerLoadingAgentsModels',
        'Loading agents and models',
    );

    const skeleton = document.createElement('div');
    skeleton.className = 'theia-qaap-agent-sheet-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < rowCount; index++) {
        const row = document.createElement('div');
        row.className = 'theia-qaap-agent-sheet-skeleton-row';
        if (index === 0) {
            row.classList.add('theia-mod-selected');
        }
        const avatar = document.createElement('span');
        avatar.className = 'theia-qaap-agent-sheet-skeleton-avatar';
        const text = document.createElement('span');
        text.className = 'theia-qaap-agent-sheet-skeleton-text';
        const chevron = document.createElement('span');
        chevron.className = 'theia-qaap-agent-sheet-skeleton-chevron';
        row.append(avatar, text, chevron);
        skeleton.append(row);
    }
    list.replaceChildren(announcement, skeleton);
}

export function replaceAgentPickerLoading(list: HTMLElement, ...content: Node[]): void {
    list.setAttribute('aria-busy', 'false');
    list.replaceChildren(...content);
}

export function renderAgentPickerLoadError(list: HTMLElement, onRetry: () => void): void {
    list.setAttribute('aria-busy', 'false');
    const error = document.createElement('div');
    error.className = 'theia-qaap-agent-sheet-load-error';
    error.setAttribute('role', 'alert');
    const message = document.createElement('p');
    message.textContent = nls.localize(
        'qaap/mobileProjects/stickyComposerAgentLoadFailed',
        'Agents and models could not be loaded.',
    );
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'theia-qaap-agent-sheet-retry';
    retry.textContent = nls.localize('qaap/mobileProjects/retry', 'Retry');
    retry.addEventListener('click', onRetry);
    error.append(message, retry);
    list.replaceChildren(error);
}

