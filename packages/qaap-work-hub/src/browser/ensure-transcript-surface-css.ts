// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapLazyStylesheets } from '@theia/qaap-product-theme/lib/browser/qaap-lazy-stylesheets';

let transcriptSurfaceCss: Promise<void> | undefined;

/**
 * Loads transcript timeline / conversation / Files / transcript styles. Files can mount from Agents Hub
 * or project detail without opening a transcript sheet, so every Files entry path
 * must call this (not only `openTranscriptSheet`). Synchronous renderers (Agents Hub
 * inline transcript) call it fire-and-forget; `QaapLazySurfaceStylesheetsPreload` also
 * warms it once the app is ready and idle so those paths find it already applied.
 *
 * The sheets are `?qaap-lazy` imports: they are not part of `bundle.css` and are
 * attached (in this order) the first time a transcript surface opens.
 */
export function ensureTranscriptSurfaceCss(): Promise<void> {
    if (!transcriptSurfaceCss) {
        transcriptSurfaceCss = loadTranscriptSurfaceCss();
    }
    return transcriptSurfaceCss;
}

async function loadTranscriptSurfaceCss(): Promise<void> {
    // Same relative order these sheets had when they were eager imports of the Work Hub module
    // (timeline sheets before the conversation / transcript surfaces that refine them).
    await QaapLazyStylesheets.loadModules(
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-timeline-premium.css?qaap-lazy'),
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-live-status.css?qaap-lazy'),
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-goal-loop.css?qaap-lazy'),
        import('../../src/browser/style/mobile-workbench-conversation.css?qaap-lazy'),
        import('@theia/qaap-transcript/src/browser/style/mobile-workbench-transcript.css?qaap-lazy'),
        // Keep the Markdown surface last: it is the single canonical owner of transcript
        // typography, overflow, tables, headings, and rich code block presentation.
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-markdown.css?qaap-lazy'),
    );
}
