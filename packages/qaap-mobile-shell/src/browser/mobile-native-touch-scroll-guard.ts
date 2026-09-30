// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';

const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/;

function canScrollVertically(element: Element): boolean {
    return element.scrollHeight > element.clientHeight + 1
        && SCROLLABLE_OVERFLOW.test(getComputedStyle(element).overflowY);
}

function canScrollHorizontally(element: Element): boolean {
    return element.scrollWidth > element.clientWidth + 1
        && SCROLLABLE_OVERFLOW.test(getComputedStyle(element).overflowX);
}

/**
 * Nearest ancestor of `target` (inclusive) that can actually pan natively, stopping
 * before `<body>` (which the mobile shell locks with `overflow: hidden`).
 */
export function findNativeTouchScrollHost(target: EventTarget | null): Element | undefined {
    let element = target instanceof Element ? target : target instanceof Node ? target.parentElement : undefined;
    while (element && element !== document.body && element !== document.documentElement) {
        if (canScrollVertically(element) || canScrollHorizontally(element)) {
            return element;
        }
        element = element.parentElement;
    }
    return undefined;
}

/**
 * Keeps native touch scroll alive on nested scroll hosts.
 *
 * Upstream `FrontendApplication` registers a non-passive document-level
 * `touchmove` listener that calls `preventDefault()` on every move (so the IDE
 * does not rubber-band with the text on iPad). Since native nested scroll
 * replaced the JS fallback on modern engines, that listener cancels every pan
 * in the sidebar, lists, sheets and trees. This guard runs on `<html>` in the
 * bubble phase — after every element-level handler, just before the event
 * reaches `document` — and stops propagation for single-finger moves that start
 * inside a host that can scroll, unless a handler already claimed the gesture.
 * Moves outside a scroll host (and pinches) still reach the upstream listener.
 */
export function installMobileNativeTouchScrollGuard(): Disposable {
    const root = document.documentElement;
    let scrollHost: Element | undefined;
    const onTouchStart = (event: TouchEvent): void => {
        scrollHost = event.touches.length === 1 ? findNativeTouchScrollHost(event.target) : undefined;
    };
    const onTouchMove = (event: TouchEvent): void => {
        if (!scrollHost || event.defaultPrevented || event.touches.length !== 1 || !scrollHost.isConnected) {
            return;
        }
        event.stopPropagation();
    };
    const onTouchEnd = (event: TouchEvent): void => {
        if (event.touches.length === 0) {
            scrollHost = undefined;
        }
    };
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return Disposable.create(() => {
        root.removeEventListener('touchstart', onTouchStart);
        root.removeEventListener('touchmove', onTouchMove);
        root.removeEventListener('touchend', onTouchEnd);
        root.removeEventListener('touchcancel', onTouchEnd);
        scrollHost = undefined;
    });
}
