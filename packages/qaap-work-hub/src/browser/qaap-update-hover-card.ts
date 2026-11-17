// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Information card for the sessions sidebar "Update ready" footer button: rest the pointer on the
// button (or focus it with the keyboard) and a card above it says what clicking does and which builds
// are involved. It never takes focus. Desktop only: touch keeps the button's native `title`.

import { matchesMobileNarrowViewport } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { computeQaapUpdateHoverCardPosition, type QaapUpdateHoverCardModel } from './qaap-update-hover-card-model';

/** Media query of devices whose primary pointer can rest on the button. */
const QAAP_UPDATE_HOVER_CARD_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';

/** How long the pointer (or keyboard focus) rests on the button before the card appears. */
export const QAAP_UPDATE_HOVER_CARD_DELAY_MS = 250;

const CARD_CLASS = 'theia-qaap-update-hover-card';
const CARD_ID = 'theia-qaap-update-hover-card';

/** True when the button should show the card instead of a native `title` tooltip. Safe without `window`. */
export function isQaapUpdateHoverCardSupported(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia(QAAP_UPDATE_HOVER_CARD_MEDIA_QUERY).matches && !matchesMobileNarrowViewport();
}

/** The card of one update button; `resolve` gives its current text (or `undefined` for none). */
export class QaapUpdateHoverCard {

    protected card: HTMLElement | undefined;
    protected pendingTimer: number | undefined;
    protected armed = false;
    /** Window size when the card was armed: only a real size change dismisses it. */
    protected armedViewport: { width: number; height: number } | undefined;

    constructor(
        protected readonly button: HTMLElement,
        protected readonly resolve: () => QaapUpdateHoverCardModel | undefined,
    ) {
        button.addEventListener('pointerenter', event => {
            if (event.pointerType === 'mouse' && isQaapUpdateHoverCardSupported()) {
                this.schedule();
            }
        });
        button.addEventListener('pointerleave', event => {
            if (event.pointerType === 'mouse' && !this.isKeyboardFocused()) {
                this.hide();
            }
        });
        button.addEventListener('pointerdown', () => this.hide(), { capture: true });
        button.addEventListener('click', () => this.hide(), { capture: true });
        button.addEventListener('focus', () => {
            // Only keyboard focus: a mouse click also focuses the button but already dismissed the card.
            if (this.isKeyboardFocused() && isQaapUpdateHoverCardSupported()) {
                this.schedule();
            }
        });
        button.addEventListener('blur', () => this.hide());
    }

    /** Re-renders the shown card (e.g. once the update starts); hides it when there is nothing to say. */
    refresh(): void {
        if (!this.card) {
            return;
        }
        const model = this.resolve();
        if (!model || this.button.hidden || !this.button.isConnected) {
            this.hide();
            return;
        }
        this.show(model);
    }

    hide(): void {
        if (this.pendingTimer !== undefined) {
            window.clearTimeout(this.pendingTimer);
            this.pendingTimer = undefined;
        }
        this.button.removeAttribute('aria-describedby');
        this.removeCard();
        this.unbindGlobalListeners();
    }

    protected isKeyboardFocused(): boolean {
        try {
            return this.button.matches(':focus-visible');
        } catch {
            return false;
        }
    }

    protected schedule(): void {
        if (this.card || this.pendingTimer !== undefined) {
            return;
        }
        this.bindGlobalListeners();
        this.pendingTimer = window.setTimeout(() => {
            this.pendingTimer = undefined;
            const model = this.button.isConnected && !this.button.hidden ? this.resolve() : undefined;
            if (model) {
                this.show(model);
            } else {
                this.hide();
            }
        }, QAAP_UPDATE_HOVER_CARD_DELAY_MS);
    }

    protected show(model: QaapUpdateHoverCardModel): void {
        this.removeCard();
        const card = this.renderCard(model);
        this.card = card;
        const doc = this.button.ownerDocument;
        doc.body.append(card);
        // Top layer when available so the sidebar's stacking context never clips the card.
        try {
            card.showPopover?.();
        } catch {
            // Not supported in this engine: the fixed position and z-index still apply.
        }
        const view = doc.defaultView ?? window;
        const size = card.getBoundingClientRect();
        const position = computeQaapUpdateHoverCardPosition(
            this.button.getBoundingClientRect(),
            { width: size.width, height: size.height },
            { width: view.innerWidth, height: view.innerHeight },
        );
        // Computed position: the only inline style.
        card.style.left = `${position.left}px`;
        card.style.top = `${position.top}px`;
        card.classList.add(`theia-mod-${position.side}`, 'theia-mod-visible');
        this.button.setAttribute('aria-describedby', CARD_ID);
    }

    protected renderCard(model: QaapUpdateHoverCardModel): HTMLElement {
        const card = document.createElement('div');
        card.className = CARD_CLASS;
        card.id = CARD_ID;
        card.setAttribute('role', 'tooltip');
        card.setAttribute('popover', 'manual');
        const title = document.createElement('div');
        title.className = `${CARD_CLASS}-title`;
        title.textContent = model.title;
        card.append(title);
        for (const detail of model.details) {
            const line = document.createElement('div');
            line.className = `${CARD_CLASS}-detail`;
            line.textContent = detail;
            card.append(line);
        }
        return card;
    }

    protected removeCard(): void {
        const card = this.card;
        if (!card) {
            return;
        }
        try {
            card.hidePopover?.();
        } catch {
            // Not shown as a popover: removing it is enough.
        }
        card.remove();
        this.card = undefined;
    }

    protected readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            this.hide();
        }
    };

    protected readonly onDismissingEvent = (): void => {
        this.hide();
    };

    /** Only a scroll that moves the button dismisses the card (the transcript auto-scrolls while streaming). */
    protected readonly onScroll = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof Node) || target.nodeType === Node.DOCUMENT_NODE || target.contains(this.button)) {
            this.hide();
        }
    };

    /** The Work Hub dispatches synthetic `resize` events to relayout panels: only a real size change dismisses. */
    protected readonly onWindowResize = (): void => {
        const armed = this.armedViewport;
        if (!armed || armed.width !== window.innerWidth || armed.height !== window.innerHeight) {
            this.hide();
        }
    };

    protected bindGlobalListeners(): void {
        if (this.armed) {
            return;
        }
        this.armed = true;
        this.armedViewport = { width: window.innerWidth, height: window.innerHeight };
        document.addEventListener('keydown', this.onDocumentKeyDown, true);
        window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
        window.addEventListener('resize', this.onWindowResize);
        window.addEventListener('blur', this.onDismissingEvent);
    }

    protected unbindGlobalListeners(): void {
        if (!this.armed) {
            return;
        }
        this.armed = false;
        this.armedViewport = undefined;
        document.removeEventListener('keydown', this.onDocumentKeyDown, true);
        window.removeEventListener('scroll', this.onScroll, true);
        window.removeEventListener('resize', this.onWindowResize);
        window.removeEventListener('blur', this.onDismissingEvent);
    }
}
