// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const TASK_TITLE_TEXT_CLASS = 'theia-mobile-projects-task-title-text';
export const TASK_TITLE_OVERFLOW_CLASS = 'theia-mod-title-overflow';

/** Creates the text viewport's animated inner content without changing its accessible name. */
export function createTaskTitleText(title: string): HTMLSpanElement {
    const text = document.createElement('span');
    text.className = TASK_TITLE_TEXT_CLASS;
    text.textContent = title;
    return text;
}

/** Re-measures a title after its row is laid out or its content changes. */
export function refreshTaskTitleMarquee(titleViewport: HTMLElement): void {
    const titleText = titleViewport.querySelector<HTMLElement>(`.${TASK_TITLE_TEXT_CLASS}`);
    if (!titleText) {
        return;
    }

    const overflow = Math.max(0, titleText.scrollWidth - titleViewport.clientWidth);
    if (overflow > 1) {
        titleViewport.classList.add(TASK_TITLE_OVERFLOW_CLASS);
        titleViewport.style.setProperty('--qaap-task-title-overflow', `${Math.ceil(overflow)}px`);
    } else {
        titleViewport.classList.remove(TASK_TITLE_OVERFLOW_CLASS);
        titleViewport.style.removeProperty('--qaap-task-title-overflow');
    }
}

/** Installs the hover/focus measurement used by the sidebar's title marquee. */
export function attachTaskTitleMarquee(row: HTMLElement, titleViewport: HTMLElement): void {
    const scheduleRefresh = (): void => {
        const view = row.ownerDocument.defaultView;
        if (view?.requestAnimationFrame) {
            view.requestAnimationFrame(() => refreshTaskTitleMarquee(titleViewport));
        } else {
            refreshTaskTitleMarquee(titleViewport);
        }
    };

    row.addEventListener('mouseenter', scheduleRefresh);
    row.addEventListener('focusin', scheduleRefresh);
    scheduleRefresh();
}

/** Updates a title while preserving the marquee's measurement hooks. */
export function setTaskTitleText(titleViewport: HTMLElement, title: string): void {
    const titleText = titleViewport.querySelector<HTMLElement>(`.${TASK_TITLE_TEXT_CLASS}`);
    if (titleText) {
        titleText.textContent = title;
    } else {
        titleViewport.textContent = title;
    }
    titleViewport.classList.remove(TASK_TITLE_OVERFLOW_CLASS);
    titleViewport.style.removeProperty('--qaap-task-title-overflow');
}
