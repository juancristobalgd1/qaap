// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** True when the OS requests reduced motion (safe in Node tests: returns false). */
export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Maps a preferred scroll behavior to `auto` when reduced motion is active. */
export function resolveScrollBehavior(
    preferred: ScrollBehavior = 'smooth',
    reducedMotion = prefersReducedMotion(),
): ScrollBehavior {
    return reducedMotion ? 'auto' : preferred;
}

export function scrollElementTo(
    scroller: HTMLElement,
    top: number,
    preferred: ScrollBehavior = 'smooth',
): void {
    scroller.scrollTo({ top, behavior: resolveScrollBehavior(preferred) });
}

/** Scrolls a transcript (or list) host to the latest content. */
export function scrollElementToEnd(
    scroller: HTMLElement,
    preferred: ScrollBehavior = 'auto',
): void {
    scrollElementTo(scroller, scroller.scrollHeight, preferred);
}

/** Re-run scroll-to-end after flex layout settles (avoids empty viewport on first paint). */
export function scrollElementToEndAfterLayout(
    scroller: HTMLElement,
    preferred: ScrollBehavior = 'auto',
): void {
    const snap = (): void => {
        if (scroller.clientHeight <= 0) {
            return;
        }
        scrollElementToEnd(scroller, preferred);
    };
    snap();
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            requestAnimationFrame(snap);
        });
    }
    if (typeof ResizeObserver !== 'undefined') {
        let disconnected = false;
        const observer = new ResizeObserver(() => {
            snap();
            if (!disconnected && scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight) {
                disconnected = true;
                observer.disconnect();
            }
        });
        observer.observe(scroller);
        if (typeof setTimeout === 'function') {
            setTimeout(() => {
                if (!disconnected) {
                    disconnected = true;
                    observer.disconnect();
                }
            }, 2000);
        }
    }
}
