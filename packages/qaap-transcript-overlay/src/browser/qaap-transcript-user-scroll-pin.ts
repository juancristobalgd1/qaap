// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common';

const USER_WRAP_SELECTOR = '.theia-mobile-agent-transcript-user-wrap';
const USER_BUBBLE_SELECTOR = '.theia-mobile-agent-transcript-msg.theia-mod-user';
const STUCK_WRAP_CLASS = 'theia-mod-sticky-stuck';
const SUPPRESSED_WRAP_CLASS = 'theia-mod-sticky-suppressed';
const JUMP_CLASS = 'theia-mod-scroll-pinned-jump';
const STICKY_COMPACT_CLASS = 'theia-mod-sticky-compact';
const CONTENT_SELECTOR = '.theia-mobile-agent-transcript-content';

function wrapHasStickyVisualState(wrap: HTMLElement): boolean {
    if (wrap.classList.contains(STUCK_WRAP_CLASS) || wrap.classList.contains(SUPPRESSED_WRAP_CLASS)) {
        return true;
    }
    const bubble = wrap.querySelector<HTMLElement>(USER_BUBBLE_SELECTOR);
    if (!bubble) {
        return false;
    }
    return bubble.classList.contains(JUMP_CLASS)
        || bubble.hasAttribute('tabindex')
        || bubble.hasAttribute('title')
        || bubble.hasAttribute('aria-label')
        || Boolean(bubble.querySelector<HTMLElement>(`${CONTENT_SELECTOR}.${STICKY_COMPACT_CLASS}`));
}

function stripTranscriptUserScrollPinVisuals(scroller: HTMLElement): void {
    for (const wrap of scroller.querySelectorAll<HTMLElement>(USER_WRAP_SELECTOR)) {
        if (!wrapHasStickyVisualState(wrap)) {
            continue;
        }
        wrap.classList.remove(STUCK_WRAP_CLASS, SUPPRESSED_WRAP_CLASS);
        wrap.style.removeProperty('min-height');
        wrap.style.removeProperty('z-index');
        const bubble = wrap.querySelector<HTMLElement>(USER_BUBBLE_SELECTOR);
        if (!bubble) {
            continue;
        }
        bubble.classList.remove(JUMP_CLASS);
        bubble.querySelector<HTMLElement>(CONTENT_SELECTOR)?.classList.remove(STICKY_COMPACT_CLASS);
        bubble.removeAttribute('tabindex');
        bubble.removeAttribute('title');
        bubble.removeAttribute('aria-label');
    }
}

/**
 * User-query scroll pin is disabled on mobile. Keep this hook so transcript hosts can
 * strip any legacy sticky classes left by cached bundles or older sessions.
 */
export function attachTranscriptUserScrollPin(scroller: HTMLElement): Disposable {
    stripTranscriptUserScrollPinVisuals(scroller);
    const observer = new MutationObserver(mutations => {
        if (mutations.some(mutation =>
            mutation.type === 'childList'
            || (mutation.type === 'attributes' && mutation.attributeName === 'class'))) {
            stripTranscriptUserScrollPinVisuals(scroller);
        }
    });
    observer.observe(scroller, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
    });
    return Disposable.create(() => observer.disconnect());
}
