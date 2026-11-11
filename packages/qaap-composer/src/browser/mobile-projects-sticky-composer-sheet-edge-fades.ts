// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { attachQaapScrollEdgeFades } from '@theia/qaap-mobile-shell/lib/browser/qaap-scroll-edge-fades';

/** Live edge-fade trackers for sheet lists, keyed by the list element they scroll. */
const sheetListEdgeFades = new Map<HTMLElement, Disposable>();

/**
 * Fades the hidden top/bottom edges of a sheet list (`.theia-mobile-sticky-composer-sheet-list`).
 * Called when the list is built: the helper re-syncs on layout and on child changes, so rows
 * that arrive later (branch lists, streamed results) keep the fades correct. Re-attaching a list
 * replaces its previous tracker.
 * @param list the sheet list scroller.
 */
export function attachSheetListEdgeFades(list: HTMLElement): void {
    detachSheetListEdgeFades(list);
    sheetListEdgeFades.set(list, attachQaapScrollEdgeFades(list));
}

/**
 * Stops tracking one sheet list and removes its fade classes. Used when a list hosts something
 * that scrolls by itself (the model picker owns its own row fades).
 * @param list the sheet list to stop tracking.
 */
export function detachSheetListEdgeFades(list: HTMLElement): void {
    sheetListEdgeFades.get(list)?.dispose();
    sheetListEdgeFades.delete(list);
}

/**
 * Disposes the trackers of every sheet list that is no longer in the document. Call after a sheet
 * closes, once its nodes are removed, so no observer outlives its sheet.
 */
export function pruneDetachedSheetListEdgeFades(): void {
    for (const [list, fades] of [...sheetListEdgeFades.entries()]) {
        if (!list.isConnected) {
            fades.dispose();
            sheetListEdgeFades.delete(list);
        }
    }
}
