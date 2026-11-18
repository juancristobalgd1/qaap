// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import {
    attachQaapScrollEdgeFades,
    type QaapScrollEdgeFades,
} from '@theia/qaap-mobile-shell/lib/browser/qaap-scroll-edge-fades';

/** Scroll body of a Theia dialog: `.dialogOverlay > .dialogBlock > .dialogContent`. */
const DIALOG_BODY_SELECTOR = ':scope > .dialogBlock > .dialogContent';

/**
 * Puts the shared scroll-edge fades on the scrollable body of every open dialog, so a dialog shows
 * a top fade when scrolled down and a bottom fade while more content lies below. Dialogs keep no
 * fade code of their own: the fade classes come from `attachQaapScrollEdgeFades()`.
 *
 * Theia attaches each dialog overlay directly to `document.body`, so observing its direct children
 * finds new and removed dialogs without a subtree scan. Handles of removed bodies are disposed on
 * the next change.
 */
@injectable()
export class QaapWorkHubDialogScrollFadesContribution implements FrontendApplicationContribution {

    protected readonly fades = new Map<HTMLElement, QaapScrollEdgeFades>();
    protected observer: MutationObserver | undefined;

    onStart(_app: FrontendApplication): void {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
            return;
        }
        this.sync();
        this.observer = new MutationObserver(() => this.sync());
        this.observer.observe(document.body, { childList: true });
    }

    onStop(_app: FrontendApplication): void {
        this.observer?.disconnect();
        this.observer = undefined;
        for (const handle of this.fades.values()) {
            handle.dispose();
        }
        this.fades.clear();
    }

    /** Disposes the fades of removed dialog bodies, then attaches fades to the open ones. */
    protected sync(): void {
        for (const [body, handle] of this.fades) {
            if (!body.isConnected) {
                handle.dispose();
                this.fades.delete(body);
            }
        }
        for (const child of Array.from(document.body.children)) {
            if (!(child instanceof HTMLElement) || !child.classList.contains('dialogOverlay')) {
                continue;
            }
            const body = child.querySelector<HTMLElement>(DIALOG_BODY_SELECTOR);
            if (body && !this.fades.has(body)) {
                this.fades.set(body, attachQaapScrollEdgeFades(body));
            }
        }
    }
}
