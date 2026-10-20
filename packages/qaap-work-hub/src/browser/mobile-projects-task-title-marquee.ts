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

/**
 * Re-measures a title after its row is laid out or its content changes. At rest the title only
 * counts as overflowing when it really is clipped. While the row is hovered or focused, its actions
 * cover the end of the title instead of narrowing it (`--qaap-task-title-hover-reserve` in the
 * sessions sidebar CSS), so the marquee also travels past that patch.
 */
export function refreshTaskTitleMarquee(titleViewport: HTMLElement, options?: { readonly interacting?: boolean }): void {
    const titleText = titleViewport.querySelector<HTMLElement>(`.${TASK_TITLE_TEXT_CLASS}`);
    if (!titleText) {
        return;
    }

    const view = titleViewport.ownerDocument.defaultView;
    const reserve = options?.interacting && view
        ? parseFloat(view.getComputedStyle(titleViewport).getPropertyValue('--qaap-task-title-hover-reserve')) || 0
        : 0;
    const overflow = Math.max(0, titleText.scrollWidth - titleViewport.clientWidth + reserve);
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
    const scheduleRefresh = (interacting: boolean): void => {
        // Update immediately for interaction-driven callers, then measure again after layout settles.
        refreshTaskTitleMarquee(titleViewport, { interacting });
        const view = row.ownerDocument.defaultView;
        if (view?.requestAnimationFrame) {
            view.requestAnimationFrame(() => refreshTaskTitleMarquee(titleViewport, { interacting }));
        } else {
            refreshTaskTitleMarquee(titleViewport, { interacting });
        }
    };

    row.addEventListener('mouseenter', () => scheduleRefresh(true));
    row.addEventListener('focusin', () => scheduleRefresh(true));
    row.addEventListener('mouseleave', () => {
        if (!row.contains(row.ownerDocument.activeElement)) {
            refreshTaskTitleMarquee(titleViewport);
        }
    });
    row.addEventListener('focusout', event => {
        if (!row.contains(event.relatedTarget as Node | null) && !row.matches(':hover')) {
            refreshTaskTitleMarquee(titleViewport);
        }
    });
    scheduleRefresh(false);
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
