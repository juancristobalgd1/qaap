// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lucide `arrow-up` — sticky composer submit glyph (`currentColor`), as in T3 Code. */
export function createStickyComposerSendIcon(): HTMLElement {
    const host = document.createElement('span');
    host.className = 'theia-mobile-projects-sticky-composer-send-icon';
    host.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    const head = document.createElementNS(SVG_NS, 'path');
    head.setAttribute('d', 'm5 12 7-7 7 7');
    const shaft = document.createElementNS(SVG_NS, 'path');
    shaft.setAttribute('d', 'M12 19V5');
    svg.append(head, shaft);
    host.append(svg);
    return host;
}
