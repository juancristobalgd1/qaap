// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';

/** Where the link menu applies: links inside the chat transcript only. */
export const TRANSCRIPT_LINK_SCOPE_SELECTOR = '.theia-mobile-agent-transcript';
/** How long a finger must rest on a link before the menu opens (Android/iOS long-press feel). */
export const TRANSCRIPT_LINK_LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const MENU_CLASS = 'qaap-transcript-link-menu';

export interface TranscriptLinkContextMenuOptions {
    /** Opens the URL in Qaap's own browser pane; the item is hidden when absent. */
    readonly openInIntegratedBrowser?: (url: string) => void;
    /** Opens the URL in a new tab of the system browser (default: `window.open`). */
    readonly openInSystemBrowser?: (url: string) => void;
    /** Copies the URL (default: the async clipboard API with an execCommand fallback). */
    readonly copyText?: (text: string) => Promise<void>;
    /** Feedback after a copy (e.g. a snackbar). */
    readonly notifyCopied?: () => void;
}

/** The http(s) URL of a transcript link under `target`, if any. */
export function resolveTranscriptLinkUrl(target: EventTarget | null): string | undefined {
    const element = target instanceof Element ? target : (target as Node | null)?.parentElement ?? undefined;
    const anchor = element?.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || !anchor.closest(TRANSCRIPT_LINK_SCOPE_SELECTOR)) {
        return undefined;
    }
    const href = anchor.href;
    return /^https?:\/\//i.test(href) ? href : undefined;
}

async function defaultCopyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        return;
    } catch {
        // Clipboard API unavailable (insecure context, permissions): fall back below.
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
}

/**
 * Right-click (desktop) or long-press (touch) on a transcript link opens a small menu:
 * "Open in integrated browser", "Open in system browser", "Copy Link". Delegated on `root`, so
 * links rendered later (streaming, patches) are covered without per-link wiring.
 */
export function installTranscriptLinkContextMenu(root: Document | HTMLElement, options: TranscriptLinkContextMenuOptions): Disposable {
    let menu: HTMLElement | undefined;
    let pressTimer: number | undefined;
    let pressStart: { x: number; y: number } | undefined;
    let suppressNextClick = false;

    const closeMenu = (): void => {
        menu?.remove();
        menu = undefined;
        document.removeEventListener('pointerdown', onOutsidePointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('scroll', closeMenu, true);
        window.removeEventListener('resize', closeMenu);
    };
    const onOutsidePointerDown = (event: PointerEvent): void => {
        if (menu && event.target instanceof Node && menu.contains(event.target)) {
            return;
        }
        closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu();
        }
    };

    const openMenu = (url: string, x: number, y: number): void => {
        closeMenu();
        const element = document.createElement('div');
        element.className = MENU_CLASS;
        element.setAttribute('role', 'menu');
        const addItem = (label: string, run: () => void): void => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `${MENU_CLASS}-item`;
            item.setAttribute('role', 'menuitem');
            item.textContent = label;
            item.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
                run();
            });
            element.append(item);
        };
        if (options.openInIntegratedBrowser) {
            const open = options.openInIntegratedBrowser;
            addItem(nls.localize('qaap/transcript/linkMenu/openIntegrated', 'Open in integrated browser'), () => open(url));
        }
        addItem(nls.localize('qaap/transcript/linkMenu/openSystem', 'Open in system browser'), () => {
            (options.openInSystemBrowser ?? (target => window.open(target, '_blank', 'noopener,noreferrer')))(url);
        });
        addItem(nls.localize('qaap/transcript/linkMenu/copy', 'Copy Link'), () => {
            void (options.copyText ?? defaultCopyText)(url).then(() => options.notifyCopied?.());
        });
        document.body.append(element);
        // Keep the whole menu on screen: open toward the free side of the pointer.
        const margin = 8;
        const rect = element.getBoundingClientRect();
        const left = Math.min(Math.max(margin, x), window.innerWidth - rect.width - margin);
        const top = y + rect.height + margin > window.innerHeight ? Math.max(margin, y - rect.height) : y;
        element.style.left = `${Math.round(left)}px`;
        element.style.top = `${Math.round(top)}px`;
        menu = element;
        element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
        document.addEventListener('pointerdown', onOutsidePointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('resize', closeMenu);
    };

    const cancelPress = (): void => {
        if (pressTimer !== undefined) {
            window.clearTimeout(pressTimer);
            pressTimer = undefined;
        }
        pressStart = undefined;
    };

    const onContextMenu = (event: Event): void => {
        const mouse = event as MouseEvent;
        const url = resolveTranscriptLinkUrl(mouse.target);
        if (!url) {
            return;
        }
        mouse.preventDefault();
        cancelPress();
        openMenu(url, mouse.clientX, mouse.clientY);
    };
    const onPointerDown = (event: Event): void => {
        const pointer = event as PointerEvent;
        if (pointer.pointerType !== 'touch') {
            return;
        }
        const url = resolveTranscriptLinkUrl(pointer.target);
        if (!url) {
            return;
        }
        cancelPress();
        pressStart = { x: pointer.clientX, y: pointer.clientY };
        pressTimer = window.setTimeout(() => {
            pressTimer = undefined;
            const start = pressStart;
            pressStart = undefined;
            if (!start) {
                return;
            }
            // The finger lifts after this: that click must not also follow the link.
            suppressNextClick = true;
            navigator.vibrate?.(10);
            openMenu(url, start.x, start.y);
        }, TRANSCRIPT_LINK_LONG_PRESS_MS);
    };
    const onPointerMove = (event: Event): void => {
        const pointer = event as PointerEvent;
        if (pressStart && Math.hypot(pointer.clientX - pressStart.x, pointer.clientY - pressStart.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
            cancelPress();
        }
    };
    const onClick = (event: Event): void => {
        if (!suppressNextClick) {
            return;
        }
        suppressNextClick = false;
        if (resolveTranscriptLinkUrl(event.target)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', cancelPress);
    root.addEventListener('pointercancel', cancelPress);
    root.addEventListener('click', onClick, true);
    return Disposable.create(() => {
        cancelPress();
        closeMenu();
        root.removeEventListener('contextmenu', onContextMenu);
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('pointermove', onPointerMove);
        root.removeEventListener('pointerup', cancelPress);
        root.removeEventListener('pointercancel', cancelPress);
        root.removeEventListener('click', onClick, true);
    });
}
