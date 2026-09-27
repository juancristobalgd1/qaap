// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Next focus index when moving ↑/↓ through a timeline step list (skips gap rows). */
export function resolveNextTranscriptActivityFocusIndex(
    itemCount: number,
    currentIndex: number,
    direction: 'next' | 'prev',
): number | undefined {
    if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) {
        return undefined;
    }
    const delta = direction === 'next' ? 1 : -1;
    const next = currentIndex + delta;
    if (next < 0 || next >= itemCount) {
        return undefined;
    }
    return next;
}

const TRANSCRIPT_ACTIVITY_KEYBOARD_BOUND = 'data-transcript-activity-keyboard-bound';

/** ArrowUp/ArrowDown moves focus between timeline steps — Cursor trace keyboard parity. */
export function bindTranscriptActivityListKeyboard(list: HTMLOListElement): void {
    if (list.getAttribute(TRANSCRIPT_ACTIVITY_KEYBOARD_BOUND) === '1') {
        return;
    }
    list.setAttribute(TRANSCRIPT_ACTIVITY_KEYBOARD_BOUND, '1');
    list.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const current = target.closest<HTMLElement>('.theia-mobile-agent-activity-item');
        if (!current || !list.contains(current) || current.classList.contains('theia-mod-history-gap')) {
            return;
        }
        const items = [...list.querySelectorAll<HTMLElement>(
            ':scope > .theia-mobile-agent-activity-item:not(.theia-mod-history-gap)',
        )];
        const currentIndex = items.indexOf(current);
        if (currentIndex < 0) {
            return;
        }
        const nextIndex = resolveNextTranscriptActivityFocusIndex(
            items.length,
            currentIndex,
            event.key === 'ArrowDown' ? 'next' : 'prev',
        );
        if (nextIndex === undefined) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const next = items[nextIndex];
        next?.focus({ preventScroll: false });
        next?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
}
