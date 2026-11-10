// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { matchesMobileNarrowViewport } from '@theia/core/lib/browser/shell/mobile-layout-state';

/** How long a mouse press must hold before the menu opens (touch uses the shell long-press). */
const QAAP_USER_MESSAGE_MENU_HOLD_MS = 500;
const QAAP_USER_MESSAGE_MENU_MOVE_PX = 10;
const QAAP_USER_MESSAGE_MENU_GAP_PX = 6;
const QAAP_USER_MESSAGE_MENU_EDGE_PX = 8;

/**
 * Narrow-viewport menu for a user message: a long press on the bubble opens a small menu with the
 * message actions (Edit, Copy, Retry, Undo) instead of an inline row that unfolds under the bubble.
 *
 * Touch long-press arrives as a `contextmenu` event (native on Android, synthesized by the mobile
 * shell elsewhere); a mouse press held for {@link QAAP_USER_MESSAGE_MENU_HOLD_MS} and a right click
 * open it too. Each item forwards to the inline action button, which stays in the DOM (hidden on
 * narrow viewports) so its handlers, disabled state and "Copied" feedback have a single owner.
 */
export class QaapTranscriptUserMessageMenu {

    protected holdTimer: number | undefined;
    protected holdStartX = 0;
    protected holdStartY = 0;
    protected suppressNextClick = false;
    protected menu: HTMLElement | undefined;
    protected closeListeners: (() => void)[] = [];

    constructor(
        protected readonly wrap: HTMLElement,
        protected readonly actions: HTMLElement,
    ) { }

    attach(): void {
        this.wrap.addEventListener('contextmenu', this.onContextMenu);
        this.wrap.addEventListener('pointerdown', this.onPointerDown);
        this.wrap.addEventListener('pointermove', this.onPointerMove);
        this.wrap.addEventListener('pointerup', this.cancelHold);
        this.wrap.addEventListener('pointercancel', this.cancelHold);
        this.wrap.addEventListener('pointerleave', this.cancelHold);
        this.wrap.addEventListener('click', this.onClickCapture, true);
    }

    protected isEnabled(): boolean {
        return matchesMobileNarrowViewport() && this.wrap.isConnected;
    }

    protected readonly onContextMenu = (event: MouseEvent): void => {
        if (!this.isEnabled()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.cancelHold();
        this.open();
    };

    protected readonly onPointerDown = (event: PointerEvent): void => {
        // Touch long-press is owned by the shell (synthetic `contextmenu`); here only a held mouse.
        if (event.pointerType !== 'mouse' || event.button !== 0 || !this.isEnabled()) {
            return;
        }
        if ((event.target as Element | null)?.closest?.('a, button, input, textarea')) {
            return;
        }
        this.cancelHold();
        this.holdStartX = event.clientX;
        this.holdStartY = event.clientY;
        this.holdTimer = window.setTimeout(() => {
            this.holdTimer = undefined;
            this.suppressNextClick = true;
            this.open();
        }, QAAP_USER_MESSAGE_MENU_HOLD_MS);
    };

    protected readonly onPointerMove = (event: PointerEvent): void => {
        if (this.holdTimer === undefined) {
            return;
        }
        const dx = event.clientX - this.holdStartX;
        const dy = event.clientY - this.holdStartY;
        if (dx * dx + dy * dy > QAAP_USER_MESSAGE_MENU_MOVE_PX * QAAP_USER_MESSAGE_MENU_MOVE_PX) {
            this.cancelHold();
        }
    };

    protected readonly cancelHold = (): void => {
        if (this.holdTimer !== undefined) {
            window.clearTimeout(this.holdTimer);
            this.holdTimer = undefined;
        }
    };

    /** The mouse release that ends a hold must not also act as a click on the bubble. */
    protected readonly onClickCapture = (event: MouseEvent): void => {
        if (this.suppressNextClick) {
            this.suppressNextClick = false;
            event.preventDefault();
            event.stopPropagation();
        }
    };

    open(): void {
        this.close();
        const doc = this.wrap.ownerDocument;
        const view = doc.defaultView;
        if (!view) {
            return;
        }
        const menu = doc.createElement('div');
        menu.className = 'theia-mobile-agent-transcript-user-menu';
        menu.setAttribute('role', 'menu');
        for (const source of Array.from(this.actions.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-transcript-user-action'))) {
            menu.append(this.createItem(source));
        }
        if (!menu.childElementCount) {
            return;
        }
        doc.body.append(menu);
        this.menu = menu;
        this.wrap.classList.add('theia-mod-menu-open');
        this.position(menu, view);
        (navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate?.(8);

        const onOutside = (event: Event): void => {
            if (!menu.contains(event.target as Node)) {
                this.close();
            }
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                this.close();
            }
        };
        const onViewportChange = (): void => this.close();
        // Defer so the release of the press that opened the menu does not close it.
        const armTimer = view.setTimeout(() => {
            doc.addEventListener('pointerdown', onOutside, true);
        }, 0);
        doc.addEventListener('keydown', onKey, true);
        doc.addEventListener('scroll', onViewportChange, true);
        view.addEventListener('resize', onViewportChange);
        this.closeListeners.push(() => {
            view.clearTimeout(armTimer);
            doc.removeEventListener('pointerdown', onOutside, true);
            doc.removeEventListener('keydown', onKey, true);
            doc.removeEventListener('scroll', onViewportChange, true);
            view.removeEventListener('resize', onViewportChange);
        });
        menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    }

    close(): void {
        for (const dispose of this.closeListeners.splice(0)) {
            dispose();
        }
        this.menu?.remove();
        this.menu = undefined;
        this.wrap.classList.remove('theia-mod-menu-open');
    }

    protected createItem(source: HTMLButtonElement): HTMLButtonElement {
        const doc = this.wrap.ownerDocument;
        const item = doc.createElement('button');
        item.type = 'button';
        item.className = 'theia-mobile-agent-transcript-user-menu-item';
        item.setAttribute('role', 'menuitem');
        item.disabled = source.disabled;
        const label = source.getAttribute('aria-label') ?? source.title;
        const icon = source.querySelector('.codicon');
        if (icon) {
            item.append(icon.cloneNode(true));
        }
        const text = doc.createElement('span');
        text.className = 'theia-mobile-agent-transcript-user-menu-label';
        text.textContent = label;
        item.append(text);
        item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            source.click();
        });
        return item;
    }

    /** Below the bubble, right-aligned with it; above when there is no room underneath. */
    protected position(menu: HTMLElement, view: Window): void {
        const bubble = this.wrap.querySelector<HTMLElement>('.theia-mobile-agent-transcript-msg') ?? this.wrap;
        const anchor = bubble.getBoundingClientRect();
        const box = menu.getBoundingClientRect();
        const viewportWidth = view.innerWidth;
        const viewportHeight = view.visualViewport?.height ?? view.innerHeight;
        let top = anchor.bottom + QAAP_USER_MESSAGE_MENU_GAP_PX;
        if (top + box.height > viewportHeight - QAAP_USER_MESSAGE_MENU_EDGE_PX) {
            top = Math.max(QAAP_USER_MESSAGE_MENU_EDGE_PX, anchor.top - QAAP_USER_MESSAGE_MENU_GAP_PX - box.height);
        }
        const maxLeft = viewportWidth - box.width - QAAP_USER_MESSAGE_MENU_EDGE_PX;
        const left = Math.max(QAAP_USER_MESSAGE_MENU_EDGE_PX, Math.min(anchor.right - box.width, maxLeft));
        menu.style.top = `${Math.round(top)}px`;
        menu.style.left = `${Math.round(left)}px`;
    }
}
