// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}

function createLucideSvg(paths: string[]): SVGSVGElement {
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
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
        svg.append(svgEl('path', { d }));
    }
    return svg;
}

/** lucide-arrow-up-right — open in new browser tab. */
export function createLucideArrowUpRightIcon(): SVGSVGElement {
    return createLucideSvg([
        'M7 7h10v10',
        'M7 17 17 7',
    ]);
}

/**
 * Filled vertical ellipsis for Work Hub overflow menus.
 * Target: Cursor web sprite `sprites-core-c728a27e.svg#644ce5` (20×20, fill=currentColor).
 * The sprite CDN is auth-gated (public fetch returns HTML); inline filled dots match reference sizing.
 */
export function createWorkHubMoreActionsIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    for (const cy of ['5', '10', '15']) {
        svg.append(svgEl('circle', { cx: '10', cy, r: '1.5' }));
    }
    return svg;
}

/**
 * Cursor-style agents cluster (pyramid of dots) for the Work Hub "N Working" pill.
 * Not decorative: dots are a sequenced skill/loader while agents are working.
 */
export function createWorkHubWorkingAgentsIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add(
        'icon',
        'theia-mobile-projects-working-pill-icon',
        'theia-mod-working-loader',
    );
    // Tip → mid → base: cascade reads as an active loading skill.
    const dots: Array<[number, number]> = [
        [8, 3.25],
        [5.75, 7],
        [10.25, 7],
        [3.5, 10.75],
        [8, 10.75],
        [12.5, 10.75],
    ];
    dots.forEach(([cx, cy], index) => {
        const circle = svgEl('circle', { cx: String(cx), cy: String(cy), r: '1.35' });
        circle.classList.add('qaap-working-loader-dot');
        circle.style.setProperty('--qaap-working-loader-i', String(index));
        svg.append(circle);
    });
    return svg;
}

/** 2×2 four-dot grid for a top-level working agent row in the Working expand panel. */
export function createWorkHubWorkingParentIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add(
        'icon',
        'theia-mobile-sticky-composer-working-agents-parent-icon',
        'theia-mod-working-loader',
    );
    const dots: Array<[number, number]> = [
        [5, 5],
        [11, 5],
        [5, 11],
        [11, 11],
    ];
    dots.forEach(([cx, cy], index) => {
        const circle = svgEl('circle', { cx: String(cx), cy: String(cy), r: '1.45' });
        circle.classList.add('qaap-working-loader-dot');
        circle.style.setProperty('--qaap-working-loader-i', String(index));
        svg.append(circle);
    });
    return svg;
}

/**
 * L-shaped / tree-connector glyph for a nested subagent row in the Working popover.
 * Three dots: vertical stem + rightward foot (Cursor child affordance).
 */
export function createWorkHubWorkingChildIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon', 'theia-mobile-sticky-composer-working-agents-child-icon');
    const dots: Array<[number, number]> = [
        [5, 3.5],
        [5, 8],
        [5, 12.5],
        [10.5, 12.5],
    ];
    for (const [cx, cy] of dots) {
        svg.append(svgEl('circle', { cx: String(cx), cy: String(cy), r: '1.35' }));
    }
    return svg;
}
