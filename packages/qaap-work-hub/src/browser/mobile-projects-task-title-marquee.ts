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
    const overflow = Math.max(0, measureTaskTitleTextWidth(titleText) - titleViewport.clientWidth + reserve);
    if (overflow > 1) {
        titleViewport.classList.add(TASK_TITLE_OVERFLOW_CLASS);
        titleViewport.style.setProperty('--qaap-task-title-overflow', `${Math.ceil(overflow)}px`);
    } else {
        titleViewport.classList.remove(TASK_TITLE_OVERFLOW_CLASS);
        titleViewport.style.removeProperty('--qaap-task-title-overflow');
    }
}

/**
 * Width of the title's glyphs. The text element is a full-width block, so `scrollWidth` reports
 * the row width for a short title; adding the hover reserve to that made every short title
 * scroll. Only a clipped title reports its real width there, so measure the glyphs otherwise.
 */
function measureTaskTitleTextWidth(titleText: HTMLElement): number {
    const scrollWidth = titleText.scrollWidth;
    if (scrollWidth > titleText.clientWidth + 1) {
        return scrollWidth;
    }
    const range = titleText.ownerDocument.createRange?.();
    if (range && typeof range.getBoundingClientRect === 'function') {
        range.selectNodeContents(titleText);
        const width = range.getBoundingClientRect().width;
        range.detach();
        if (width > 0) {
            return width;
        }
    }
    return scrollWidth;
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

/** Whether the title's row is hovered or holds focus (the marquee then includes the hover reserve). */
function isTitleRowInUse(titleViewport: HTMLElement): boolean {
    const row = titleViewport.closest<HTMLElement>('.theia-mobile-projects-task-row') ?? titleViewport.parentElement;
    if (!row) {
        return false;
    }
    return row.matches(':hover') || row.contains(row.ownerDocument.activeElement);
}

/**
 * Updates a title while preserving the marquee's measurement hooks, and re-measures it: a title
 * renamed (or streamed) while its row is hovered keeps the hover reserve instead of dropping back
 * to the resting measurement until the pointer leaves and re-enters.
 */
export function setTaskTitleText(titleViewport: HTMLElement, title: string): void {
    const titleText = titleViewport.querySelector<HTMLElement>(`.${TASK_TITLE_TEXT_CLASS}`);
    if (titleText) {
        titleText.textContent = title;
    } else {
        titleViewport.textContent = title;
    }
    refreshTaskTitleMarquee(titleViewport, { interacting: isTitleRowInUse(titleViewport) });
}
