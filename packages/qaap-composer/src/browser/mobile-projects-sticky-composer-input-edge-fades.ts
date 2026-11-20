// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { attachQaapScrollEdgeFades, type QaapScrollEdgeFades } from '@theia/qaap-mobile-shell/lib/browser/qaap-scroll-edge-fades';

/** Class of the editor wrapper that holds both the sticky composer textarea and its highlight mirror. */
const STICKY_COMPOSER_EDITOR_CLASS = 'theia-mobile-projects-sticky-composer-input-editor';

/** Live edge-fade trackers for sticky composer textareas, keyed by the textarea they scroll. */
const composerInputEdgeFades = new Map<HTMLTextAreaElement, QaapScrollEdgeFades>();

/**
 * Fades the hidden top/bottom edges of the sticky composer textarea. The fade classes go on the
 * editor wrapper (not the textarea) so the mask also covers the highlight mirror that paints the
 * visible text; the textarea text itself is transparent. Re-attaching a textarea replaces its tracker.
 * Trackers of textareas that left the document (earlier composer renders) are disposed on each attach.
 * @param input the sticky composer textarea.
 * @returns the fade handle; call `update()` after programmatic `value` writes, dispose it to stop tracking.
 */
export function attachStickyComposerInputEdgeFades(input: HTMLTextAreaElement): QaapScrollEdgeFades {
    pruneDetachedStickyComposerInputEdgeFades();
    composerInputEdgeFades.get(input)?.dispose();
    const editor = input.closest<HTMLElement>(`.${STICKY_COMPOSER_EDITOR_CLASS}`) ?? input.parentElement ?? undefined;
    const fades = attachQaapScrollEdgeFades(input, { classTarget: editor });
    composerInputEdgeFades.set(input, fades);
    return fades;
}

/**
 * Disposes the trackers of every composer textarea that is no longer in the document, so no
 * observer outlives the composer render that created it.
 */
export function pruneDetachedStickyComposerInputEdgeFades(): void {
    for (const [input, fades] of [...composerInputEdgeFades.entries()]) {
        if (!input.isConnected) {
            fades.dispose();
            composerInputEdgeFades.delete(input);
        }
    }
}
