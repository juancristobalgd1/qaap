// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * LobeHub ScrollShadow — soft gradient fade at the top/bottom edges of a
 * scrollable area, painted ONLY when content actually overflows.
 *
 * Mirrors LobeHub's `ScrollShadow` (src/components/ScrollShadow), which uses a
 * scroll listener + ResizeObserver to toggle the fade on/off depending on
 * whether the host is scrolled and whether content overflows the viewport.
 *
 * The previous implementation used a permanent CSS `mask-image` that faded the
 * top/bottom 10px of every scrollable host unconditionally — which dimmed the
 * edges of short content (the common case: a 1-line tool result) and double-
 * masked `<pre>` elements nested inside `.theia-toolCall-error-result`.
 *
 * This hook sets a `data-shadow` attribute on the host element:
 *   'none'   — content fits (no overflow), no fade
 *   'top'    — scrolled to bottom, more content above → fade top edge
 *   'bottom' — scrolled to top, more content below → fade bottom edge
 *   'both'   — middle of scrollable content → fade both edges
 *
 * CSS (qaap-transcript-lobehub.css) gates `mask-image` on these values via the
 * `.qaap-lh-scroll-shadow[data-shadow='...']` selectors, so the fade only
 * appears when there is genuinely more content to scroll to.
 *
 * Usage:
 *   const ref = useScrollShadowRef();
 *   <div ref={ref} className='qaap-lh-thinking-content qaap-lh-scroll-shadow' />
 *
 * Or via the {@link QaapLobehubScrollShadowHost} wrapper for elements emitted
 * from non-hook contexts (e.g. class-method result renderers).
 */

import * as React from '@theia/core/shared/react';

type ShadowState = 'none' | 'top' | 'bottom' | 'both';

const SCROLL_EPSILON = 1;

/**
 * React ref callback that manages the `data-shadow` attribute on a scrollable
 * host. Attach to any element that has `overflow: auto` + a height cap.
 *
 * The callback identity is stable for the lifetime of the component, so it does
 * not force ref detach/reattach on every render (important during streaming).
 */
export const useScrollShadowRef = (): React.RefCallback<HTMLElement> => {
    const elRef = React.useRef<HTMLElement | null>(null);
    const observerRef = React.useRef<ResizeObserver | null>(null);

    const compute = React.useCallback((): ShadowState => {
        const el = elRef.current;
        if (!el) { return 'none'; }
        // If the host can't scroll, there is nothing to fade.
        if (el.scrollHeight <= el.clientHeight + SCROLL_EPSILON) { return 'none'; }
        const atTop = el.scrollTop <= SCROLL_EPSILON;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_EPSILON;
        if (atTop && atBottom) { return 'none'; }
        if (atTop) { return 'bottom'; }
        if (atBottom) { return 'top'; }
        return 'both';
    }, []);

    const apply = React.useCallback(() => {
        const el = elRef.current;
        if (!el) { return; }
        el.setAttribute('data-shadow', compute());
    }, [compute]);

    const onScroll = React.useCallback(() => apply(), [apply]);

    const refCallback = React.useCallback((el: HTMLElement | null) => {
        // Detach from previous element.
        if (elRef.current) {
            elRef.current.removeEventListener('scroll', onScroll);
            observerRef.current?.disconnect();
            observerRef.current = null;
        }
        elRef.current = el;
        if (el) {
            el.setAttribute('data-shadow', 'none');
            el.addEventListener('scroll', onScroll, { passive: true });
            // Observe the host + its children so content growth during
            // streaming re-evaluates the fade without a scroll event.
            // ResizeObserver may be unavailable in some test environments
            // (jsdom) or very old browsers — fall back to scroll-only updates.
            if (typeof ResizeObserver !== 'undefined') {
                const ro = new ResizeObserver(() => apply());
                ro.observe(el);
                Array.from(el.children).forEach(child => ro.observe(child));
                observerRef.current = ro;
            }
            apply();
        }
    }, [onScroll, apply]);

    return refCallback;
};

interface ScrollShadowHostProps {
    className: string;
    children: React.ReactNode;
}

/**
 * Wrapper that renders a `<div>` with the given className and manages the
 * `data-shadow` attribute via {@link useScrollShadowRef}. Use this from
 * non-hook contexts (e.g. class methods that return ReactNode) where a hook
 * cannot be called directly.
 *
 * The `qaap-lh-scroll-shadow` marker class is added automatically so the CSS
 * mask selectors match without the caller having to remember it.
 */
export const QaapLobehubScrollShadowHost: React.FC<ScrollShadowHostProps> = ({ className, children }) => {
    const ref = useScrollShadowRef();
    return <div ref={ref} className={`${className} qaap-lh-scroll-shadow`} data-shadow='none'>{children}</div>;
};
