// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Single source of truth for positioning the queue-control stack inside the
 * changes-pill-row.  Other contributions (Working pill, Step pill, …) create
 * pill hosts asynchronously; this module exposes one function that finds the
 * best row and moves the queue pill into it, plus a MutationObserver that
 * re-runs the normalization whenever the DOM changes.
 *
 * Callers should NEVER move the queue stack themselves — just call
 * {@link ensureQueueControlInPillRow} after mutating the composer wrap, and
 * {@link ensureQueueControlPositionObserver} once per wrap to catch async
 * pill-host creation.
 */

const QUEUE_CONTROL_SELECTOR = '.theia-mobile-sticky-composer-activity-stack.theia-mod-queue-control';
const WORKING_CONTROL_SELECTOR = '.theia-mobile-sticky-composer-working-control';
const PILL_ROW_SELECTOR = '.theia-mobile-sticky-composer-changes-pill-row';
const PILL_HOST_SELECTOR = '.theia-mobile-sticky-composer-changes-pill-host';
const CARD_SELECTOR = ':scope > .theia-mobile-projects-sticky-composer-card';

/** WeakMap of MutationObservers watching for pill-host creation per wrap. */
const queueControlObservers = new WeakMap<HTMLElement, MutationObserver>();

/**
 * Move the queue-control stack into the best available changes-pill-row so the
 * "N Queued" pill sits on the SAME horizontal line as the Working pill (not
 * stacked above or below it).
 *
 * Priority:
 *  1. The row that already contains the Working control (preferred — both pills
 *     share the same horizontal line in the slider).
 *  2. The first pill host that has a row.
 *  3. Before the composer card (last resort — keeps it visible until a row
 *     appears, at which point the MutationObserver will relocate it).
 */
export function ensureQueueControlInPillRow(wrap: HTMLElement): void {
    const stack = wrap.querySelector<HTMLElement>(QUEUE_CONTROL_SELECTOR);
    if (!stack) {
        return;
    }

    // 1. Prefer the row that contains the Working control.
    const workingControl = wrap.querySelector(WORKING_CONTROL_SELECTOR);
    const workingRow = workingControl?.closest<HTMLElement>(PILL_ROW_SELECTOR);
    if (workingRow && placeAsFirstChild(stack, workingRow)) {
        return;
    }

    // 2. Fallback: first pill host that has a row.
    const pillHosts = Array.from(
        wrap.querySelectorAll<HTMLElement>(PILL_HOST_SELECTOR),
    );
    for (const pillHost of pillHosts) {
        const row = pillHost.querySelector<HTMLElement>(PILL_ROW_SELECTOR);
        if (row && placeAsFirstChild(stack, row)) {
            return;
        }
    }

    // 3. Last resort: before the card.
    const card = wrap.querySelector<HTMLElement>(CARD_SELECTOR);
    if (card && stack.parentElement !== wrap) {
        wrap.insertBefore(stack, card);
    }
}

/**
 * Install a MutationObserver (once per wrap) that re-normalizes the queue
 * control position whenever the DOM changes inside the wrap.  This catches
 * pill hosts created asynchronously by other contributions (Working pill, Step
 * pill, …) that would otherwise leave the queue stack as a loose sibling.
 */
export function ensureQueueControlPositionObserver(wrap: HTMLElement): void {
    if (queueControlObservers.has(wrap)) {
        return;
    }
    const observer = new MutationObserver(() => ensureQueueControlInPillRow(wrap));
    observer.observe(wrap, { childList: true, subtree: true });
    queueControlObservers.set(wrap, observer);
}

/** Move `stack` to the first-child position of `row` if it's not already there. */
function placeAsFirstChild(stack: HTMLElement, row: HTMLElement): boolean {
    if (stack.parentElement === row && row.firstElementChild === stack) {
        return true; // already in position
    }
    row.insertBefore(stack, row.firstChild);
    return true;
}
