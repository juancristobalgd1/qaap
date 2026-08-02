// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/**
 * Swipe-to-delete gesture for mobile task/conversation rows.
 *
 * On touch devices (pointer: coarse), swiping a row left reveals a red "Delete"
 * action button behind the row content. Tapping the button triggers the onDelete
 * callback. Swiping right or tapping the row content dismisses the revealed state.
 *
 * This is a progressive enhancement: on desktop (pointer: fine) it is a no-op and
 * the existing card-menu → Delete path remains the primary affordance.
 */

const SWIPE_ACTION_WIDTH = 80; // px revealed action button
const SWIPE_THRESHOLD = SWIPE_ACTION_WIDTH * 0.6; // commit to delete at 60% reveal
const SWIPE_RESISTANCE = 0.5; // rubber-band after full reveal

export interface SwipeToDeleteOptions {
    readonly onDelete: () => void;
    /** Optional confirm callback; if it returns false the delete is cancelled. */
    readonly onConfirm?: () => boolean | Promise<boolean>;
}

/**
 * Attaches swipe-to-delete behavior to a task row. The row must have a single
 * child element that serves as the swipeable content (the task-item button).
 * Returns a dispose function that removes all listeners.
 */
export function attachSwipeToDelete(
    row: HTMLElement,
    options: SwipeToDeleteOptions,
): () => void {
    // Only activate on touch-coarse pointers (mobile). Desktop keeps card-menu.
    if (!window.matchMedia('(pointer: coarse)').matches) {
        return () => { /* no-op on desktop */ };
    }

    const content = row.querySelector<HTMLElement>(':scope > .theia-mobile-projects-task-item');
    if (!content) {
        return () => { /* no content to swipe */ };
    }

    // Build the revealed delete action layer behind the content.
    const actionLayer = document.createElement('div');
    actionLayer.className = 'qaap-swipe-to-delete-action-layer';
    actionLayer.setAttribute('aria-hidden', 'true');
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'qaap-swipe-to-delete-action-btn';
    actionBtn.textContent = nls.localize('qaap/mobileProjects/swipeDelete', 'Delete');
    actionBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        void confirmAndDelete();
    });
    actionLayer.append(actionBtn);
    row.prepend(actionLayer);

    let startX = 0;
    let currentX = 0;
    let dragging = false;
    let revealed = false;

    const reset = (): void => {
        content.style.transition = 'transform 180ms ease-out';
        content.style.transform = 'translateX(0)';
        actionLayer.style.transition = 'opacity 180ms ease-out';
        actionLayer.style.opacity = '0';
        revealed = false;
        row.classList.remove('qaap-mod-swipe-revealed');
        window.setTimeout(() => {
            content.style.transition = '';
            actionLayer.style.transition = '';
        }, 200);
    };

    const reveal = (): void => {
        content.style.transition = 'transform 180ms ease-out';
        content.style.transform = `translateX(-${SWIPE_ACTION_WIDTH}px)`;
        actionLayer.style.transition = 'opacity 180ms ease-out';
        actionLayer.style.opacity = '1';
        revealed = true;
        row.classList.add('qaap-mod-swipe-revealed');
        window.setTimeout(() => {
            content.style.transition = '';
            actionLayer.style.transition = '';
        }, 200);
    };

    const confirmAndDelete = async (): Promise<void> => {
        if (options.onConfirm) {
            const confirmed = await options.onConfirm();
            if (!confirmed) {
                reset();
                return;
            }
        }
        reset();
        options.onDelete();
    };

    const onTouchStart = (ev: TouchEvent): void => {
        if (ev.touches.length !== 1) {
            return;
        }
        // If already revealed, a tap on content should dismiss instead of starting a new swipe.
        if (revealed && ev.target === content) {
            reset();
            return;
        }
        startX = ev.touches[0].clientX;
        currentX = startX;
        dragging = true;
        content.style.transition = 'none';
        actionLayer.style.transition = 'none';
    };

    const onTouchMove = (ev: TouchEvent): void => {
        if (!dragging || ev.touches.length !== 1) {
            return;
        }
        currentX = ev.touches[0].clientX;
        let delta = currentX - startX;
        // Only allow left swipe (negative delta). Right swipe on a revealed row dismisses.
        if (delta > 0) {
            if (revealed) {
                // Dismiss from revealed state.
                delta = Math.min(delta, SWIPE_ACTION_WIDTH);
                content.style.transform = `translateX(${-SWIPE_ACTION_WIDTH + delta}px)`;
                actionLayer.style.opacity = String(1 - delta / SWIPE_ACTION_WIDTH);
            } else {
                // Rubber-band right swipes on a non-revealed row.
                content.style.transform = `translateX(${delta * 0.2}px)`;
            }
            return;
        }
        // Left swipe with resistance after full reveal.
        const clamped = Math.max(delta, -SWIPE_ACTION_WIDTH);
        const extra = delta < -SWIPE_ACTION_WIDTH ? (delta + SWIPE_ACTION_WIDTH) * SWIPE_RESISTANCE : 0;
        content.style.transform = `translateX(${clamped + extra}px)`;
        actionLayer.style.opacity = String(Math.min(1, -delta / SWIPE_ACTION_WIDTH));
    };

    const onTouchEnd = (): void => {
        if (!dragging) {
            return;
        }
        dragging = false;
        const delta = currentX - startX;
        if (delta < -SWIPE_THRESHOLD) {
            reveal();
        } else if (delta > SWIPE_THRESHOLD && revealed) {
            reset();
        } else {
            // Snap back to current stable state.
            if (revealed) {
                reveal();
            } else {
                reset();
            }
        }
    };

    row.addEventListener('touchstart', onTouchStart, { passive: true });
    row.addEventListener('touchmove', onTouchMove, { passive: true });
    row.addEventListener('touchend', onTouchEnd, { passive: true });

    return (): void => {
        row.removeEventListener('touchstart', onTouchStart);
        row.removeEventListener('touchmove', onTouchMove);
        row.removeEventListener('touchend', onTouchEnd);
        actionLayer.remove();
        content.style.transform = '';
        content.style.transition = '';
        row.classList.remove('qaap-mod-swipe-revealed');
    };
}
