// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';

/** Base class that opts a scroller into the edge fade masks (see style/qaap-scroll-edge-fades.css). */
export const QAAP_SCROLL_FADES_CLASS = 'qaap-scroll-fades';
/** Added next to the base class for a horizontal scroller (`axis: 'x'`). */
export const QAAP_SCROLL_FADES_X_CLASS = 'qaap-scroll-fades-x';
/** Set while content is hidden above the viewport (`scrollTop > 0`). */
export const QAAP_SCROLL_FADE_TOP_CLASS = 'qaap-mod-scroll-fade-top';
/** Set while content is hidden below the viewport. */
export const QAAP_SCROLL_FADE_BOTTOM_CLASS = 'qaap-mod-scroll-fade-bottom';
/** Set while content is hidden before the viewport on the left (`scrollLeft > 0`, LTR). */
export const QAAP_SCROLL_FADE_START_CLASS = 'qaap-mod-scroll-fade-start';
/** Set while content is hidden after the viewport on the right. */
export const QAAP_SCROLL_FADE_END_CLASS = 'qaap-mod-scroll-fade-end';

/** Sub-pixel tolerance when deciding whether more content lies past the viewport edge. */
const EDGE_TOLERANCE_PX = 1;

export interface QaapScrollEdgeFadesOptions {
    /** `y` (default): top/bottom fades for a vertical list. `x`: start/end fades for a horizontal rail. */
    readonly axis?: 'x' | 'y';
    /**
     * Element that receives the fade classes (default: the scroller). Pass a wrapper when the scroller
     * is only part of what must be faded, e.g. a textarea drawn over a mirror layer.
     */
    readonly classTarget?: HTMLElement;
}

/** Handle returned by {@link attachQaapScrollEdgeFades}. */
export interface QaapScrollEdgeFades extends Disposable {
    /**
     * Re-syncs the fade classes immediately. Call after writes the helper cannot observe, such as a
     * textarea `value` assignment; scroll, `input`, resize and child-list changes are tracked automatically.
     */
    update(): void;
}

/**
 * Shows a soft fade only on the edge where content is actually hidden: top when scrolled down,
 * bottom when more content lies below (or start/end on the `x` axis). Classes are kept in sync on
 * scroll, on `input` events, on resize and on DOM changes inside the scroller. Works without `ResizeObserver`,
 * `MutationObserver` or `requestAnimationFrame` (updates run synchronously then), so it is safe under jsdom.
 * The classes go on `options.classTarget` (default: the scroller); all tracking stays on the scroller.
 * @param scroller the element that scrolls along the chosen axis.
 * @param options the scroll axis and optional class target; defaults to a vertical fade on the scroller.
 * @returns a handle that stops tracking, removes all fade classes and re-syncs on demand via `update()`.
 */
export function attachQaapScrollEdgeFades(scroller: HTMLElement, options: QaapScrollEdgeFadesOptions = {}): QaapScrollEdgeFades {
    const horizontal = options.axis === 'x';
    const target = options.classTarget ?? scroller;
    const view = scroller.ownerDocument?.defaultView ?? undefined;
    const requestFrame = typeof view?.requestAnimationFrame === 'function'
        ? (callback: () => void): number => view.requestAnimationFrame(callback)
        : undefined;
    const cancelFrame = typeof view?.cancelAnimationFrame === 'function'
        ? (id: number): void => view.cancelAnimationFrame(id)
        : undefined;
    let frame: number | undefined;
    let disposed = false;

    const syncFades = (): void => {
        frame = undefined;
        if (disposed) {
            return;
        }
        if (horizontal) {
            const { scrollLeft, scrollWidth, clientWidth } = scroller;
            target.classList.toggle(QAAP_SCROLL_FADE_START_CLASS, scrollLeft > 0);
            target.classList.toggle(QAAP_SCROLL_FADE_END_CLASS, scrollLeft + clientWidth < scrollWidth - EDGE_TOLERANCE_PX);
            return;
        }
        const { scrollTop, scrollHeight, clientHeight } = scroller;
        target.classList.toggle(QAAP_SCROLL_FADE_TOP_CLASS, scrollTop > 0);
        target.classList.toggle(
            QAAP_SCROLL_FADE_BOTTOM_CLASS,
            scrollTop + clientHeight < scrollHeight - EDGE_TOLERANCE_PX,
        );
    };

    const schedule = (): void => {
        if (disposed || frame !== undefined) {
            return;
        }
        if (requestFrame) {
            frame = requestFrame(syncFades);
        } else {
            syncFades();
        }
    };

    target.classList.add(QAAP_SCROLL_FADES_CLASS);
    if (horizontal) {
        target.classList.add(QAAP_SCROLL_FADES_X_CLASS);
    }
    scroller.addEventListener('scroll', schedule, { passive: true });
    // Typing changes a textarea's content without any child-list mutation, so `input` is tracked explicitly.
    scroller.addEventListener('input', schedule);

    const ResizeObserverCtor = view?.ResizeObserver ?? (typeof ResizeObserver === 'function' ? ResizeObserver : undefined);
    const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(schedule) : undefined;
    resizeObserver?.observe(scroller);

    const MutationObserverCtor = view?.MutationObserver ?? (typeof MutationObserver === 'function' ? MutationObserver : undefined);
    const mutationObserver = MutationObserverCtor ? new MutationObserverCtor(schedule) : undefined;
    mutationObserver?.observe(scroller, { childList: true, subtree: true });

    schedule();

    const handle = Disposable.create(() => {
        disposed = true;
        scroller.removeEventListener('scroll', schedule);
        scroller.removeEventListener('input', schedule);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        if (frame !== undefined) {
            cancelFrame?.(frame);
            frame = undefined;
        }
        target.classList.remove(
            QAAP_SCROLL_FADES_CLASS,
            QAAP_SCROLL_FADES_X_CLASS,
            QAAP_SCROLL_FADE_TOP_CLASS,
            QAAP_SCROLL_FADE_BOTTOM_CLASS,
            QAAP_SCROLL_FADE_START_CLASS,
            QAAP_SCROLL_FADE_END_CLASS,
        );
    });
    return Object.assign(handle, {
        update: (): void => {
            if (!disposed) {
                syncFades();
            }
        },
    });
}
