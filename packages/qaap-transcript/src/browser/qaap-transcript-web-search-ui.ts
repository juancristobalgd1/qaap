// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { TranscriptWebSearchPayload, TranscriptWebSearchSite } from '../common/qaap-transcript-web-search-core';

export const TRANSCRIPT_WEB_SEARCH_CARD_CLASS = 'theia-mobile-agent-web-search';

const SVG_NS = 'http://www.w3.org/2000/svg';
const REVEAL_TIMERS_KEY = '__qaapWebSearchRevealTimers';
/** Stagger so each row shows the spinning globe before the green check. */
const SITE_REVEAL_DISCOVER_BASE_MS = 80;
const SITE_REVEAL_DISCOVER_STEP_MS = 240;
const SITE_REVEAL_LOADING_HOLD_MS = 1200;

const MERIDIANS = {
    L: 'M6.057 11.565 C2.081 11.565 0.371 8.159 0.371 5.964 C0.371 3.642 2.152 0.329 6.05 0.329',
    ML: 'M6.012 11.55 C4.575 10.496 3.333 8.116 3.321 5.964 C3.307 3.399 4.974 0.977 6.012 0.329',
    MR: 'M6.012 11.55 C7.211 10.781 8.715 8.287 8.715 5.964 C8.715 3.399 7.24 1.233 6.012 0.329',
    R: 'M6.012 11.55 C9.677 11.55 11.65 8.487 11.65 5.964 C11.65 3.499 9.748 0.329 6.012 0.329',
} as const;

type RevealHost = HTMLElement & { [REVEAL_TIMERS_KEY]?: number[] };

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function sitesFingerprint(sites: readonly TranscriptWebSearchSite[]): string {
    return sites.map(site => `${site.title}\0${site.url}\0${site.href ?? ''}`).join('\n');
}

function clearRevealTimers(host: HTMLElement): void {
    const timers = (host as RevealHost)[REVEAL_TIMERS_KEY];
    if (!timers) {
        return;
    }
    for (const id of timers) {
        window.clearTimeout(id);
    }
    delete (host as RevealHost)[REVEAL_TIMERS_KEY];
    delete host.dataset.revealing;
}

function bindSiteLink(li: HTMLElement): void {
    if (li.dataset.linkBound === '1') {
        return;
    }
    const href = li.dataset.href?.trim();
    if (!href) {
        return;
    }
    li.dataset.linkBound = '1';
    li.tabIndex = 0;
    li.setAttribute('role', 'link');
    li.addEventListener('click', () => openSite(href));
    li.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openSite(href);
        }
    });
}

function restartGlobeSmil(li: HTMLElement): void {
    const svg = li.querySelector<SVGSVGElement>('.theia-mobile-agent-web-search-globe svg');
    if (!svg) {
        return;
    }
    try {
        svg.setCurrentTime(0);
        svg.unpauseAnimations();
    } catch {
        // SMIL timing API is optional; meridians still animate via <animate>.
    }
}

function setSiteState(li: HTMLElement, state: 'pending' | 'loading' | 'done'): void {
    li.dataset.state = state;
    if (state === 'loading') {
        restartGlobeSmil(li);
    }
    if (state === 'done') {
        bindSiteLink(li);
    }
}

function finalizeSitesDone(host: HTMLElement): void {
    host.querySelectorAll<HTMLElement>('.theia-mobile-agent-web-search-site').forEach(li => {
        setSiteState(li, 'done');
    });
    delete host.dataset.revealing;
    host.dataset.revealed = '1';
}

/** pending → spinning globe → check, staggered per row (AIcss Web Search). */
function startSiteRevealAnimation(host: HTMLElement): void {
    clearRevealTimers(host);
    const items = Array.from(host.querySelectorAll<HTMLElement>('.theia-mobile-agent-web-search-site'));
    if (items.length === 0) {
        host.dataset.revealed = '1';
        return;
    }
    if (prefersReducedMotion()) {
        finalizeSitesDone(host);
        return;
    }

    host.dataset.revealing = '1';
    delete host.dataset.revealed;
    items.forEach(li => setSiteState(li, 'pending'));

    const timers: number[] = [];
    items.forEach((li, index) => {
        const discoverAt = SITE_REVEAL_DISCOVER_BASE_MS + index * SITE_REVEAL_DISCOVER_STEP_MS;
        const doneAt = discoverAt + SITE_REVEAL_LOADING_HOLD_MS;
        timers.push(window.setTimeout(() => setSiteState(li, 'loading'), discoverAt));
        timers.push(window.setTimeout(() => {
            setSiteState(li, 'done');
            if (index === items.length - 1) {
                delete host.dataset.revealing;
                host.dataset.revealed = '1';
                delete (host as RevealHost)[REVEAL_TIMERS_KEY];
            }
        }, doneAt));
    });
    (host as RevealHost)[REVEAL_TIMERS_KEY] = timers;
}

function createSvg(tag: string): SVGElement {
    return document.createElementNS(SVG_NS, tag);
}

function createSearchIcon(): SVGElement {
    const svg = createSvg('svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = createSvg('path');
    path.setAttribute('d', 'm21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z');
    svg.append(path);
    return svg;
}

function createCaretIcon(): SVGElement {
    const svg = createSvg('svg');
    svg.setAttribute('width', '10');
    svg.setAttribute('height', '10');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = createSvg('path');
    path.setAttribute('d', 'm4.5 15.75 7.5-7.5 7.5 7.5');
    svg.append(path);
    return svg;
}

function createArrowUpIcon(): SVGElement {
    const svg = createSvg('svg');
    svg.setAttribute('width', '10');
    svg.setAttribute('height', '10');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = createSvg('path');
    path.setAttribute('d', 'M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18');
    svg.append(path);
    return svg;
}

function createDotsIcon(): SVGElement {
    const svg = createSvg('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const circle = createSvg('circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '9');
    circle.setAttribute('stroke-width', '1.8');
    circle.setAttribute('stroke-dasharray', '1.8 3.6');
    circle.setAttribute('stroke-linecap', 'round');
    svg.append(circle);
    return svg;
}

function createCheckIcon(): SVGElement {
    const svg = createSvg('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = createSvg('path');
    path.setAttribute('d', 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z');
    svg.append(path);
    return svg;
}

function createGlobeIcon(): SVGElement {
    const svg = createSvg('svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '0.85');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.overflow = 'visible';

    const circle = createSvg('circle');
    circle.setAttribute('cx', '6');
    circle.setAttribute('cy', '6');
    circle.setAttribute('r', '5.7');
    circle.setAttribute('opacity', '0.9');
    svg.append(circle);

    const equator = createSvg('line');
    equator.setAttribute('x1', '0.3');
    equator.setAttribute('y1', '6');
    equator.setAttribute('x2', '11.7');
    equator.setAttribute('y2', '6');
    equator.setAttribute('opacity', '0.9');
    svg.append(equator);

    const values = [MERIDIANS.L, MERIDIANS.ML, MERIDIANS.MR, MERIDIANS.R, MERIDIANS.L].join(';');
    for (const begin of ['0s', '-1.2s', '-2.4s', '-3.6s', '-4.8s', '-6s']) {
        const path = createSvg('path');
        path.setAttribute('d', MERIDIANS.L);
        path.setAttribute('opacity', '0');

        const animateD = createSvg('animate');
        animateD.setAttribute('attributeName', 'd');
        animateD.setAttribute('dur', '7.2s');
        animateD.setAttribute('begin', begin);
        animateD.setAttribute('repeatCount', 'indefinite');
        animateD.setAttribute('calcMode', 'spline');
        animateD.setAttribute('keyTimes', '0;0.25;0.5;0.75;1');
        animateD.setAttribute('keySplines', '0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1');
        animateD.setAttribute('values', values);

        const animateOpacity = createSvg('animate');
        animateOpacity.setAttribute('attributeName', 'opacity');
        animateOpacity.setAttribute('dur', '7.2s');
        animateOpacity.setAttribute('begin', begin);
        animateOpacity.setAttribute('repeatCount', 'indefinite');
        animateOpacity.setAttribute('calcMode', 'linear');
        animateOpacity.setAttribute('keyTimes', '0;0.05;0.7;0.75;1');
        animateOpacity.setAttribute('values', '0;0.9;0.9;0;0');

        path.append(animateD, animateOpacity);
        svg.append(path);
    }
    return svg;
}

function openSite(href: string): void {
    window.open(href, '_blank', 'noopener,noreferrer');
}

function createSiteRow(site: TranscriptWebSearchSite, state: string, index: number): HTMLElement {
    const li = document.createElement('li');
    li.className = 'theia-mobile-agent-web-search-site';
    li.dataset.state = state;
    li.dataset.url = site.url;
    if (site.href) {
        li.dataset.href = site.href;
    }
    li.style.animationDelay = `${Math.min(index, 8) * 40}ms`;

    const bullet = document.createElement('span');
    bullet.className = 'theia-mobile-agent-web-search-bullet';
    bullet.setAttribute('aria-hidden', 'true');

    const dots = document.createElement('span');
    dots.className = 'theia-mobile-agent-web-search-dots';
    dots.append(createDotsIcon());

    const globe = document.createElement('span');
    globe.className = 'theia-mobile-agent-web-search-globe';
    globe.append(createGlobeIcon());

    const check = document.createElement('span');
    check.className = 'theia-mobile-agent-web-search-check';
    check.append(createCheckIcon());

    bullet.append(dots, globe, check);

    const title = document.createElement('span');
    title.className = 'theia-mobile-agent-web-search-title';
    title.textContent = site.title;

    const sep = document.createElement('span');
    sep.className = 'theia-mobile-agent-web-search-sep';
    sep.textContent = '·';
    sep.setAttribute('aria-hidden', 'true');

    const url = document.createElement('span');
    url.className = 'theia-mobile-agent-web-search-url';
    url.textContent = site.url;

    const arrow = document.createElement('span');
    arrow.className = 'theia-mobile-agent-web-search-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.append(createArrowUpIcon());

    li.append(bullet, title, sep, url, arrow);

    if (state === 'done') {
        bindSiteLink(li);
    }
    return li;
}

function syncLabel(host: HTMLElement, payload: TranscriptWebSearchPayload): void {
    const shimmer = host.querySelector<HTMLElement>('.theia-mobile-agent-web-search-shimmer');
    const quote = host.querySelector<HTMLElement>('.theia-mobile-agent-web-search-quote');
    if (!shimmer || !quote) {
        return;
    }
    const verb = payload.done
        ? nls.localize('qaap/mobileProjects/transcriptWebSearchSearched', 'Searched')
        : nls.localize('qaap/mobileProjects/transcriptWebSearchSearching', 'Searching');
    const query = payload.query.trim();
    shimmer.classList.toggle('theia-mod-done', payload.done);
    const verbNode = shimmer.firstChild;
    if (verbNode && verbNode.nodeType === Node.TEXT_NODE) {
        verbNode.textContent = query ? `${verb} ` : verb;
    } else {
        shimmer.insertBefore(document.createTextNode(query ? `${verb} ` : verb), quote);
    }
    quote.textContent = query ? `\u201C${query}\u201D` : '';
    quote.hidden = !query;
}

function syncSiteList(host: HTMLElement, payload: TranscriptWebSearchPayload): void {
    const list = host.querySelector<HTMLElement>('.theia-mobile-agent-web-search-list');
    const results = host.querySelector<HTMLElement>('.theia-mobile-agent-web-search-results');
    if (!list) {
        return;
    }
    const fingerprint = sitesFingerprint(payload.sites);
    const sameSites = host.dataset.sitesFp === fingerprint && list.children.length === payload.sites.length;

    if (results) {
        results.hidden = payload.sites.length === 0;
    }

    if (payload.sites.length === 0) {
        clearRevealTimers(host);
        list.replaceChildren();
        delete host.dataset.sitesFp;
        delete host.dataset.revealed;
        return;
    }

    // Keep an in-flight globe→check reveal; avoid replaceChildren wiping SMIL mid-spin.
    if (sameSites && (host.dataset.revealing === '1' || (payload.done && host.dataset.revealed === '1'))) {
        return;
    }

    if (sameSites && !payload.done) {
        payload.sites.forEach((_, index) => {
            const li = list.children[index] as HTMLElement | undefined;
            if (!li) {
                return;
            }
            const state = payload.siteStates[index] ?? 'pending';
            setSiteState(li, state);
        });
        return;
    }

    clearRevealTimers(host);
    host.dataset.sitesFp = fingerprint;
    delete host.dataset.revealed;

    const animateReveal = payload.done && !prefersReducedMotion();
    list.replaceChildren();
    payload.sites.forEach((site, index) => {
        const state = animateReveal
            ? 'pending'
            : (payload.siteStates[index] ?? (payload.done ? 'done' : 'pending'));
        list.append(createSiteRow(site, state, index));
    });

    if (animateReveal) {
        startSiteRevealAnimation(host);
    } else if (payload.done) {
        host.dataset.revealed = '1';
    }
}

export function createTranscriptWebSearchCard(
    payload: TranscriptWebSearchPayload,
    options?: { readonly open?: boolean },
): HTMLElement {
    const root = document.createElement('div');
    root.className = TRANSCRIPT_WEB_SEARCH_CARD_CLASS;
    root.dataset.state = payload.done ? 'done' : 'loading';

    const row = document.createElement('div');
    row.className = 'theia-mobile-agent-web-search-row';
    row.append(createSearchIcon());

    const label = document.createElement('span');
    label.className = 'theia-mobile-agent-web-search-label';

    const shimmer = document.createElement('span');
    shimmer.className = 'theia-mobile-agent-web-search-shimmer';
    if (payload.done) {
        shimmer.classList.add('theia-mod-done');
    }
    const verb = payload.done
        ? nls.localize('qaap/mobileProjects/transcriptWebSearchSearched', 'Searched')
        : nls.localize('qaap/mobileProjects/transcriptWebSearchSearching', 'Searching');
    const query = payload.query.trim();
    shimmer.append(document.createTextNode(query ? `${verb} ` : verb));
    const quote = document.createElement('span');
    quote.className = 'theia-mobile-agent-web-search-quote';
    quote.textContent = query ? `\u201C${query}\u201D` : '';
    quote.hidden = !query;
    shimmer.append(quote);

    const open = options?.open ?? true;
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'theia-mobile-agent-web-search-chevron';
    chevron.setAttribute('aria-label', nls.localize(
        'qaap/mobileProjects/transcriptWebSearchToggle',
        'Toggle search results',
    ));
    chevron.setAttribute('aria-expanded', open ? 'true' : 'false');
    chevron.append(createCaretIcon());

    label.append(shimmer, chevron);
    row.append(label);

    const collapsible = document.createElement('div');
    collapsible.className = 'theia-mobile-agent-web-search-collapsible';
    if (!open) {
        collapsible.classList.add('theia-mod-collapsed');
    }

    const inner = document.createElement('div');
    inner.className = 'theia-mobile-agent-web-search-collapsible-inner';

    const results = document.createElement('div');
    results.className = 'theia-mobile-agent-web-search-results';

    const rail = document.createElement('span');
    rail.className = 'theia-mobile-agent-web-search-rail';
    rail.setAttribute('aria-hidden', 'true');

    const list = document.createElement('ul');
    list.className = 'theia-mobile-agent-web-search-list';

    results.append(rail, list);
    results.hidden = true;
    inner.append(results);
    collapsible.append(inner);
    root.append(row, collapsible);

    chevron.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const collapsed = collapsible.classList.toggle('theia-mod-collapsed');
        chevron.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });

    syncSiteList(root, payload);
    return root;
}

export function patchTranscriptWebSearchCard(host: HTMLElement, payload: TranscriptWebSearchPayload): boolean {
    if (!host.classList.contains(TRANSCRIPT_WEB_SEARCH_CARD_CLASS)) {
        return false;
    }
    host.dataset.state = payload.done ? 'done' : 'loading';
    syncLabel(host, payload);
    syncSiteList(host, payload);
    return true;
}
