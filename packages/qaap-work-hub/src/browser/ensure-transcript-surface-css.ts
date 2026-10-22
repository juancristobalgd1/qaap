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
 * requests it at app start (the Work Hub landing needs it) so those paths find it already applied.
 *
 * The sheets are `?qaap-lazy-boot` imports: they are not part of `bundle.css`, and the login gate
 * attaches them (in this order) together with the bundle stylesheet when it boots into the Work Hub,
 * so the landing finds them applied; otherwise they are attached the first time this runs.
 */
export function ensureTranscriptSurfaceCss(): Promise<void> {
    if (!transcriptSurfaceCss) {
        transcriptSurfaceCss = loadTranscriptSurfaceCss().then(() => {
            transcriptSurfaceCssLoaded = true;
        });
    }
    return transcriptSurfaceCss;
}

let transcriptSurfaceCssLoaded = false;

/** Whether the transcript surface sheets have applied (synchronous check for first-paint gates). */
export function isTranscriptSurfaceCssLoaded(): boolean {
    return transcriptSurfaceCssLoaded;
}

async function loadTranscriptSurfaceCss(): Promise<void> {
    // Same relative order these sheets had when they were eager imports of the Work Hub module
    // (timeline sheets before the conversation / transcript surfaces that refine them).
    await QaapLazyStylesheets.loadModules(
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-timeline-premium.css?qaap-lazy-boot'),
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-live-status.css?qaap-lazy-boot'),
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-goal-loop.css?qaap-lazy-boot'),
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-task-plan.css?qaap-lazy-boot'),
        // Rewind preview dialog: only opened from transcript messages.
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-rewind-preview.css?qaap-lazy-boot'),
        import('../../src/browser/style/mobile-workbench-conversation.css?qaap-lazy-boot'),
        import('@theia/qaap-transcript/src/browser/style/mobile-workbench-transcript.css?qaap-lazy-boot'),
        // Keep the Markdown surface last: it is the single canonical owner of transcript
        // typography, overflow, tables, headings, and rich code block presentation.
        import('@theia/qaap-transcript/src/browser/style/qaap-transcript-markdown.css?qaap-lazy-boot'),
    );
}
