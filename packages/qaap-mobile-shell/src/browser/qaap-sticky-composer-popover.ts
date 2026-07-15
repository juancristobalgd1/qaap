// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { matchesMobileNarrowViewport } from '@theia/core/lib/browser/shell/mobile-layout-state';
import {
    QAAP_MOBILE_VIEWPORT_INSET_CHANGE_EVENT,
} from './mobile-keyboard-helper';

export type StickyComposerPopoverAlign = 'start' | 'end';

interface StickyComposerViewportBounds {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

export interface StickyComposerPopoverPositionOptions {
    readonly align?: StickyComposerPopoverAlign;
    readonly minimumWidth?: number;
    readonly onAnchorUnavailable?: () => void;
}

export function shouldUseStickyComposerDesktopPopover(anchor?: HTMLElement): anchor is HTMLElement {
    return !matchesMobileNarrowViewport() && anchor instanceof HTMLElement;
}

function getStickyComposerViewportBounds(): StickyComposerViewportBounds {
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    return {
        top,
        left,
        right: left + (viewport?.width ?? window.innerWidth),
        bottom: top + (viewport?.height ?? window.innerHeight),
    };
}

export function positionStickyComposerPopover(
    popover: HTMLElement,
    anchor: HTMLElement,
    align: StickyComposerPopoverAlign = 'start',
    minimumWidth = 280,
): void {
    const margin = 8;
    const gap = 6;
    const anchorRect = anchor.getBoundingClientRect();
    const viewport = getStickyComposerViewportBounds();
    const popoverWidth = Math.max(popover.offsetWidth, minimumWidth);
    const popoverHeight = popover.offsetHeight;
    let top = anchorRect.bottom + gap;
    const minTop = viewport.top + margin;
    const maxBottom = viewport.bottom - margin;
    if (top + popoverHeight > maxBottom) {
        const aboveTop = anchorRect.top - gap - popoverHeight;
        top = aboveTop >= minTop ? aboveTop : Math.max(minTop, maxBottom - popoverHeight);
    }
    let left = align === 'end' ? anchorRect.right - popoverWidth : anchorRect.left;
    left = Math.max(viewport.left + margin, Math.min(left, viewport.right - popoverWidth - margin));
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
}

export function scheduleStickyComposerPopoverPosition(
    popover: HTMLElement,
    anchor: HTMLElement,
    align: StickyComposerPopoverAlign = 'start',
): void {
    window.requestAnimationFrame(() => positionStickyComposerPopover(popover, anchor, align));
}

function resolveStickyComposerPopoverLayoutHost(anchor: HTMLElement): HTMLElement | undefined {
    const host = anchor.closest('.theia-mobile-projects')
        ?? anchor.closest('.theia-mobile-agent-transcript-root')
        ?? anchor.closest('#theia-app-shell');
    return host instanceof HTMLElement ? host : undefined;
}

export function wireStickyComposerPopoverPosition(
    popover: HTMLElement,
    anchor: HTMLElement,
    options: StickyComposerPopoverPositionOptions = {},
): () => void {
    const controller = new AbortController();
    const { signal } = controller;
    const align = options.align ?? 'start';
    const minimumWidth = options.minimumWidth ?? 280;
    let animationFrame = 0;
    let followupFrame = 0;
    let resizeObserver: ResizeObserver | undefined;
    let layoutObserver: MutationObserver | undefined;

    const position = (): void => {
        const anchorRect = anchor.getBoundingClientRect();
        if (!anchor.isConnected || anchorRect.width <= 0 || anchorRect.height <= 0) {
            // Popover content height changes (e.g. agent-picker skeleton) can briefly report a
            // zero-size anchor rect; retry once before dismissing.
            window.requestAnimationFrame(() => {
                if (!anchor.isConnected) {
                    options.onAnchorUnavailable?.();
                    return;
                }
                const retryRect = anchor.getBoundingClientRect();
                if (retryRect.width <= 0 || retryRect.height <= 0) {
                    options.onAnchorUnavailable?.();
                    return;
                }
                positionStickyComposerPopover(popover, anchor, align, minimumWidth);
            });
            return;
        }
        positionStickyComposerPopover(popover, anchor, align, minimumWidth);
    };
    const schedulePosition = (): void => {
        if (animationFrame) {
            return;
        }
        animationFrame = window.requestAnimationFrame(() => {
            animationFrame = 0;
            followupFrame = window.requestAnimationFrame(() => {
                followupFrame = 0;
                position();
            });
        });
    };

    window.addEventListener('resize', schedulePosition, { signal });
    window.addEventListener('orientationchange', schedulePosition, { signal });
    window.addEventListener('scroll', schedulePosition, { capture: true, signal });
    window.addEventListener(QAAP_MOBILE_VIEWPORT_INSET_CHANGE_EVENT, schedulePosition, { signal });
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', schedulePosition, { signal });
    visualViewport?.addEventListener('scroll', schedulePosition, { signal });
    const virtualKeyboard = (navigator as Navigator & {
        readonly virtualKeyboard?: EventTarget;
    }).virtualKeyboard;
    virtualKeyboard?.addEventListener('geometrychange', schedulePosition, { signal });

    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(schedulePosition);
        resizeObserver.observe(anchor);
        resizeObserver.observe(popover);
        const composer = anchor.closest('.theia-mobile-projects-sticky-composer');
        if (composer) {
            resizeObserver.observe(composer);
        }
        const layoutHost = resolveStickyComposerPopoverLayoutHost(anchor);
        if (layoutHost) {
            resizeObserver.observe(layoutHost);
        }
    }

    if (typeof MutationObserver !== 'undefined') {
        layoutObserver = new MutationObserver(schedulePosition);
        layoutObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class'],
        });
        const layoutHost = resolveStickyComposerPopoverLayoutHost(anchor);
        if (layoutHost) {
            layoutObserver.observe(layoutHost, {
                attributes: true,
                attributeFilter: ['class', 'style'],
            });
        }
        if (document.documentElement !== layoutHost) {
            layoutObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['class', 'style'],
            });
        }
    }

    schedulePosition();
    return () => {
        controller.abort();
        resizeObserver?.disconnect();
        layoutObserver?.disconnect();
        if (animationFrame) {
            window.cancelAnimationFrame(animationFrame);
        }
        if (followupFrame) {
            window.cancelAnimationFrame(followupFrame);
        }
    };
}

export function wireStickyComposerPopoverDismiss(
    popover: HTMLElement,
    anchor: HTMLElement,
    onClose: () => void,
    align: StickyComposerPopoverAlign = 'start',
): () => void {
    const controller = new AbortController();
    const { signal } = controller;
    const onPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node | null;
        if (target && (popover.contains(target) || anchor.contains(target))) {
            return;
        }
        onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            anchor.focus();
        }
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true, signal });
    document.addEventListener('keydown', onKeyDown, { capture: true, signal });
    const stopPositioning = wireStickyComposerPopoverPosition(popover, anchor, {
        align,
        onAnchorUnavailable: onClose,
    });
    return () => {
        controller.abort();
        stopPositioning();
    };
}

export function markStickyComposerPopoverAnchor(anchor: HTMLElement, open: boolean): void {
    anchor.setAttribute('aria-expanded', open ? 'true' : 'false');
    anchor.classList.toggle('theia-mod-active', open);
}

export function mountStickyComposerSheetPopover(
    panel: HTMLElement,
    options: {
        readonly anchor: HTMLElement;
        readonly onClose: () => void;
        readonly align?: StickyComposerPopoverAlign;
        readonly transcriptOverlay?: boolean;
        readonly modifierClasses?: readonly string[];
    },
): { readonly root: HTMLElement; readonly cleanup: () => void } {
    const popover = document.createElement('div');
    popover.className = options.transcriptOverlay
        ? 'qaap-sticky-composer-sheet-popover theia-mod-transcript-overlay'
        : 'qaap-sticky-composer-sheet-popover';
    for (const modifierClass of options.modifierClasses ?? []) {
        popover.classList.add(modifierClass);
        panel.classList.add(modifierClass);
    }
    popover.setAttribute('role', 'dialog');
    popover.append(panel);
    markStickyComposerPopoverAnchor(options.anchor, true);
    const align = options.align ?? 'start';
    const cleanup = wireStickyComposerPopoverDismiss(popover, options.anchor, options.onClose, align);
    return { root: popover, cleanup };
}

export function mountStickyComposerBottomSheet(
    panel: HTMLElement,
    options: {
        readonly sheetClassName: string;
        readonly onClose: () => void;
    },
): HTMLElement {
    const sheet = document.createElement('div');
    sheet.className = options.sheetClassName;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    const backdrop = document.createElement('div');
    backdrop.className = 'theia-mobile-sticky-composer-sheet-backdrop';
    backdrop.addEventListener('click', options.onClose);
    sheet.append(backdrop, panel);
    return sheet;
}
