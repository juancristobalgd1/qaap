// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapTodoStepProgress } from '../common/qaap-transcript-todo-step';
import { WORKING_CONTROL_CLASS } from './qaap-sticky-composer-working-agents-popover';

export interface StickyComposerStepPillOptions {
    readonly progress: QaapTodoStepProgress | undefined;
}

export const STEP_PILL_CLASS = 'theia-mobile-sticky-composer-step-pill';
export const STEP_MENU_CLASS = 'theia-mobile-sticky-composer-step-menu';
export const STEP_MENU_LIST_CLASS = 'theia-mobile-sticky-composer-step-menu-list';

/** Same host class as Working-only so both pills share one strip above the card. */
const PILLS_ONLY_HOST_CLASS = 'theia-mod-working-only';
const STEP_PILL_LABEL_CLASS = 'theia-mobile-sticky-composer-step-pill-label';

interface StepMenuSession {
    readonly pill: HTMLButtonElement;
    readonly menu: HTMLElement;
    readonly pinned: boolean;
    readonly cleanup: () => void;
    closeTimer: number | undefined;
}

let activeMenu: StepMenuSession | undefined;

/**
 * Cursor-style "Step X/Y" pill to the right of Working on the sticky composer strip.
 * Hover or click opens a dark to-do checklist popover for the active agent plan.
 */
export function syncStickyComposerStepPill(
    wrap: HTMLElement,
    options: StickyComposerStepPillOptions,
): void {
    const card = wrap.querySelector(':scope > .theia-mobile-projects-sticky-composer-card');
    if (!(card instanceof HTMLElement)) {
        return;
    }

    const progress = options.progress;
    if (!progress) {
        closeStickyComposerStepMenu(true);
        removeStepPills(wrap);
        pruneEmptyPillsOnlyHost(wrap);
        return;
    }

    const row = ensurePillRow(wrap, card);
    if (!row) {
        return;
    }
    upsertStepPillInRow(row, progress);
}

/** Sync the Step pill into every sticky-composer column under the given roots. */
export function syncStickyComposerStepPillInRoots(
    roots: ReadonlyArray<HTMLElement | undefined | null>,
    options: StickyComposerStepPillOptions,
): void {
    for (const root of roots) {
        if (!root?.isConnected) {
            continue;
        }
        const wraps = root.querySelectorAll('.theia-mobile-projects-sticky-composer-inner');
        wraps.forEach(wrap => {
            if (wrap instanceof HTMLElement) {
                syncStickyComposerStepPill(wrap, options);
            }
        });
    }
}

export function closeStickyComposerStepMenu(force = false): void {
    if (!activeMenu) {
        return;
    }
    if (!force && activeMenu.pinned) {
        return;
    }
    const session = activeMenu;
    activeMenu = undefined;
    if (session.closeTimer !== undefined) {
        window.clearTimeout(session.closeTimer);
    }
    session.cleanup();
    session.menu.remove();
    session.pill.setAttribute('aria-expanded', 'false');
    session.pill.classList.remove('theia-mod-active');
}

function ensurePillRow(wrap: HTMLElement, card: HTMLElement): HTMLElement | undefined {
    const changesHost = Array.from(
        wrap.querySelectorAll(':scope > .theia-mobile-sticky-composer-changes-pill-host'),
    ).find(host => !host.classList.contains(PILLS_ONLY_HOST_CLASS));
    if (changesHost instanceof HTMLElement) {
        const row = changesHost.querySelector(':scope .theia-mobile-sticky-composer-changes-pill-row');
        if (row instanceof HTMLElement) {
            return row;
        }
    }

    let host = wrap.querySelector(
        `:scope > .theia-mobile-sticky-composer-changes-pill-host.${PILLS_ONLY_HOST_CLASS}`,
    );
    if (!(host instanceof HTMLElement)) {
        host = createPillsOnlyHost();
        wrap.insertBefore(host, card);
    }
    const row = host.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
    return row instanceof HTMLElement ? row : undefined;
}

function createPillsOnlyHost(): HTMLElement {
    const host = document.createElement('div');
    host.className = `theia-mobile-sticky-composer-changes-pill-host ${PILLS_ONLY_HOST_CLASS}`;
    const section = document.createElement('div');
    section.className = 'theia-mobile-sticky-composer-activity-section theia-mod-files theia-mod-changes-pill';
    const row = document.createElement('div');
    row.className = 'theia-mobile-sticky-composer-changes-pill-row';
    section.append(row);
    host.append(section);
    return host;
}

function upsertStepPillInRow(row: HTMLElement, progress: QaapTodoStepProgress): void {
    const existing = row.querySelector<HTMLButtonElement>(`:scope > .${STEP_PILL_CLASS}`);
    const pill = existing ?? createStepPillButton();
    applyStepPillContent(pill, progress);
    bindStepPillInteractions(pill, progress);
    placeStepPillInRow(row, pill);
}

function placeStepPillInRow(row: HTMLElement, pill: HTMLButtonElement): void {
    const working = row.querySelector(`:scope > .${WORKING_CONTROL_CLASS}`)
        ?? row.querySelector(':scope > .theia-mobile-sticky-composer-working-pill');
    if (pill.parentElement === row) {
        if (working && working.nextElementSibling !== pill) {
            working.after(pill);
        }
        return;
    }
    if (working) {
        working.after(pill);
        return;
    }
    row.insertBefore(pill, row.firstChild);
}

function createStepPillButton(): HTMLButtonElement {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = STEP_PILL_CLASS;
    pill.setAttribute('aria-haspopup', 'menu');
    pill.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = STEP_PILL_LABEL_CLASS;
    pill.append(label);
    return pill;
}

function applyStepPillContent(pill: HTMLButtonElement, progress: QaapTodoStepProgress): void {
    const labelEl = pill.querySelector(`.${STEP_PILL_LABEL_CLASS}`);
    const label = nls.localize(
        'qaap/workHubChrome/stepPill',
        'Step {0}/{1}',
        String(progress.current),
        String(progress.total),
    );
    const aria = nls.localize(
        'qaap/workHubChrome/stepPillAria',
        'Agent plan step {0} of {1} — open to-dos',
        String(progress.current),
        String(progress.total),
    );
    if (labelEl) {
        labelEl.textContent = label;
    }
    pill.title = aria;
    pill.setAttribute('aria-label', aria);
    pill.dataset.stepCurrent = String(progress.current);
    pill.dataset.stepTotal = String(progress.total);
}

function bindStepPillInteractions(
    pill: HTMLButtonElement,
    progress: QaapTodoStepProgress,
): void {
    pill.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        if (activeMenu?.pill === pill && activeMenu.pinned) {
            closeStickyComposerStepMenu(true);
            return;
        }
        openStepMenu(pill, progress, true);
    };

    const hoverCapable = typeof window.matchMedia === 'function'
        && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!hoverCapable) {
        pill.onmouseenter = null;
        pill.onmouseleave = null;
        return;
    }
    pill.onmouseenter = () => {
        cancelCloseTimer();
        if (activeMenu?.pill === pill) {
            return;
        }
        openStepMenu(pill, progress, false);
    };
    pill.onmouseleave = () => {
        scheduleCloseIfUnpinned();
    };
}

function openStepMenu(
    pill: HTMLButtonElement,
    progress: QaapTodoStepProgress,
    pinned: boolean,
): void {
    cancelCloseTimer();
    if (activeMenu?.pill === pill) {
        activeMenu = { ...activeMenu, pinned: activeMenu.pinned || pinned };
        pill.setAttribute('aria-expanded', 'true');
        pill.classList.add('theia-mod-active');
        return;
    }
    closeStickyComposerStepMenu(true);

    const menu = renderStepMenu(progress);
    const doc = pill.ownerDocument;
    doc.body.append(menu);
    positionStepMenu(menu, pill);

    const controller = new AbortController();
    const { signal } = controller;
    const onPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node | null;
        if (target && (menu.contains(target) || pill.contains(target))) {
            return;
        }
        closeStickyComposerStepMenu(true);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeStickyComposerStepMenu(true);
            pill.focus();
        }
    };
    const onScrollOrResize = (event: Event): void => {
        if (event.target instanceof Node && menu.contains(event.target)) {
            return;
        }
        closeStickyComposerStepMenu(true);
    };
    const onMenuEnter = (): void => {
        cancelCloseTimer();
    };
    const onMenuLeave = (): void => {
        scheduleCloseIfUnpinned();
    };
    doc.addEventListener('pointerdown', onPointerDown, { capture: true, signal });
    doc.addEventListener('keydown', onKeyDown, { capture: true, signal });
    window.addEventListener('scroll', onScrollOrResize, { capture: true, signal });
    window.addEventListener('resize', onScrollOrResize, { signal });
    menu.addEventListener('mouseenter', onMenuEnter, { signal });
    menu.addEventListener('mouseleave', onMenuLeave, { signal });

    pill.setAttribute('aria-expanded', 'true');
    pill.classList.add('theia-mod-active');
    activeMenu = {
        pill,
        menu,
        pinned,
        closeTimer: undefined,
        cleanup: () => controller.abort(),
    };
}

function scheduleCloseIfUnpinned(): void {
    if (!activeMenu || activeMenu.pinned) {
        return;
    }
    cancelCloseTimer();
    activeMenu.closeTimer = window.setTimeout(() => {
        closeStickyComposerStepMenu(false);
    }, 140);
}

function cancelCloseTimer(): void {
    if (activeMenu?.closeTimer !== undefined) {
        window.clearTimeout(activeMenu.closeTimer);
        activeMenu.closeTimer = undefined;
    }
}

function positionStepMenu(menu: HTMLElement, pill: HTMLButtonElement): void {
    const view = pill.ownerDocument.defaultView ?? window;
    const rect = pill.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    // Measure after append.
    const width = Math.max(menu.offsetWidth, 260);
    const height = Math.max(menu.offsetHeight, 1);
    let left = rect.left;
    left = Math.min(left, view.innerWidth - margin - width);
    left = Math.max(margin, left);
    // Prefer upward: the sticky composer sits at the bottom, so opening below clips.
    const above = rect.top - gap - height;
    const below = rect.bottom + gap;
    let top: number;
    let placement: 'above' | 'below';
    if (above >= margin) {
        top = above;
        placement = 'above';
    } else if (below + height <= view.innerHeight - margin) {
        top = below;
        placement = 'below';
    } else {
        top = Math.max(margin, view.innerHeight - margin - height);
        placement = above > view.innerHeight - below ? 'above' : 'below';
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.minWidth = `${Math.max(width, rect.width)}px`;
    menu.dataset.placement = placement;
}

/** Preserve the Step plan pill across Changes-row remounts (Working transfer companion). */
export function transferStepPillToHost(fromHost: HTMLElement, toHost: HTMLElement): void {
    const fromRow = fromHost.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
    const pill = fromRow?.querySelector(`:scope > .${STEP_PILL_CLASS}`)
        ?? fromHost.querySelector(`.${STEP_PILL_CLASS}`);
    if (!(pill instanceof HTMLButtonElement)) {
        return;
    }
    const toRow = toHost.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
    if (!(toRow instanceof HTMLElement)) {
        return;
    }
    placeStepPillInRow(toRow, pill);
    if (activeMenu?.pill === pill) {
        positionStepMenu(activeMenu.menu, pill);
    }
}

function renderStepMenu(progress: QaapTodoStepProgress): HTMLElement {
    const menu = document.createElement('div');
    menu.className = STEP_MENU_CLASS;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', nls.localize('qaap/workHubChrome/stepMenuAria', 'Agent plan to-dos'));

    const list = document.createElement('ul');
    list.className = STEP_MENU_LIST_CLASS;
    progress.items.forEach((item, index) => {
        const isCurrent = index === progress.current - 1 && item.status !== 'completed';
        const visualStatus = item.status === 'completed'
            ? 'completed'
            : (isCurrent || item.status === 'in_progress')
                ? 'in-progress'
                : 'pending';
        const row = document.createElement('li');
        row.className = `theia-mobile-sticky-composer-step-menu-item theia-mod-${visualStatus}`;
        row.style.setProperty('--i', String(index));
        row.setAttribute('role', 'menuitem');

        const iconWrap = document.createElement('span');
        iconWrap.className = 'theia-mobile-sticky-composer-step-menu-icon';
        iconWrap.setAttribute('aria-hidden', 'true');
        iconWrap.append(
            createDashedIconSvg(visualStatus !== 'completed'),
            createCheckIconSvg(visualStatus === 'completed'),
        );

        const label = document.createElement('span');
        label.className = 'theia-mobile-sticky-composer-step-menu-label';
        label.dataset.label = item.label;
        label.textContent = item.label;

        row.append(iconWrap, label);
        list.append(row);
    });
    menu.append(list);
    return menu;
}

function createDashedIconSvg(on: boolean): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `theia-mobile-sticky-composer-step-menu-glyph${on ? ' theia-mod-on' : ''}`);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '9');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '1.8');
    circle.setAttribute('stroke-dasharray', '1.8 3.6');
    circle.setAttribute('stroke-linecap', 'round');
    svg.append(circle);
    return svg;
}

function createCheckIconSvg(on: boolean): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `theia-mobile-sticky-composer-step-menu-glyph${on ? ' theia-mod-on' : ''}`);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
}

function removeStepPills(root: ParentNode): void {
    root.querySelectorAll(`.${STEP_PILL_CLASS}`).forEach(node => node.remove());
}

function pruneEmptyPillsOnlyHost(wrap: HTMLElement): void {
    const host = wrap.querySelector(
        `:scope > .theia-mobile-sticky-composer-changes-pill-host.${PILLS_ONLY_HOST_CLASS}`,
    );
    if (!(host instanceof HTMLElement)) {
        return;
    }
    const row = host.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
    const hasWorking = !!row?.querySelector(`.${WORKING_CONTROL_CLASS}, .theia-mobile-sticky-composer-working-pill`);
    const hasStep = !!row?.querySelector(`.${STEP_PILL_CLASS}`);
    if (!hasWorking && !hasStep) {
        host.remove();
    }
}
