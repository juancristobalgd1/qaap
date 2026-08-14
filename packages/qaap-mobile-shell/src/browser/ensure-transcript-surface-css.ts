// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

let transcriptSurfaceCssLoaded = false;

/**
 * Loads conversation / Files / transcript styles. Files can mount from Agents Hub
 * or project detail without opening a transcript sheet, so every Files entry path
 * must call this (not only `openTranscriptSheet`).
 */
export async function ensureTranscriptSurfaceCss(): Promise<void> {
    if (transcriptSurfaceCssLoaded) {
        return;
    }
    transcriptSurfaceCssLoaded = true;
    await import('../../src/browser/style/mobile-workbench-conversation.css');
    await import('../../src/browser/style/mobile-workbench-transcript.css');
    // Keep the Markdown surface last: it is the single canonical owner of transcript
    // typography, overflow, tables, headings, and rich code block presentation.
    await import('../../src/browser/style/qaap-transcript-markdown.css');
}

export const resetTranscriptSurfaceCssForTests = (): void => {
    transcriptSurfaceCssLoaded = false;
};
