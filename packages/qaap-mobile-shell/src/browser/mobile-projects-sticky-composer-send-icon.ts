// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { prefersReducedMotion } from '../common/qaap-prefers-reduced-motion';

/** Matches animate-ui / lucide-motion Send fly-off class on the icon host. */
export const STICKY_COMPOSER_SEND_FLY_CLASS = 'theia-mod-send-fly';

/**
 * Play the paper-plane “send” motion (animate-ui Send spirit) on the sticky
 * composer submit control. No-ops when reduced motion is preferred.
 */
export function playStickyComposerSendFly(root: Element): void {
    if (prefersReducedMotion()) {
        return;
    }
    const host = root.classList.contains('theia-mobile-projects-sticky-composer-send-icon')
        ? root
        : root.querySelector('.theia-mobile-projects-sticky-composer-send-icon');
    if (!(host instanceof HTMLElement)) {
        return;
    }
    host.classList.remove(STICKY_COMPOSER_SEND_FLY_CLASS);
    // Restart CSS animation when re-applied on consecutive sends.
    void host.getBoundingClientRect();
    host.classList.add(STICKY_COMPOSER_SEND_FLY_CLASS);
}

/** Lucide `send` — sticky composer submit glyph (`currentColor`). */
export function createStickyComposerSendIcon(): HTMLElement {
    const host = document.createElement('span');
    host.className = 'theia-mobile-projects-sticky-composer-send-icon';
    host.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    // Clip the fly-off path so the plane disappears outside the icon bounds
    // (same role as animate-ui / lucide-motion `clip` on Send).
    svg.setAttribute('overflow', 'hidden');
    const plane = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    plane.classList.add('theia-mobile-projects-sticky-composer-send-plane');
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    body.setAttribute(
        'd',
        'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
    );
    const seam = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    seam.setAttribute('d', 'm21.854 2.147-10.94 10.939');
    plane.append(body, seam);
    svg.append(plane);
    host.append(svg);
    return host;
}
