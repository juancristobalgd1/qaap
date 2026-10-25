// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** The newest live preview of a section, as the backend reports it right now. */
export interface QaapCurrentPreviewLookup {
    readonly previewUrl?: string;
}

function isHttpUrl(value: string): boolean {
    try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * The href a preview link must open at click time. A preview link is saved in the message or
 * evidence that cited it, but its isolated host label rotates whenever the preview is re-claimed, so
 * the saved href can be stale. The current claim (looked up when the user clicks) wins; when the
 * lookup fails, finds no live claim, or returns something that is not an http(s) URL, the saved href
 * is used unchanged.
 */
export async function resolveCurrentPreviewHref(
    savedHref: string,
    lookupCurrent: () => Promise<QaapCurrentPreviewLookup | undefined>,
): Promise<string> {
    try {
        const current = (await lookupCurrent())?.previewUrl?.trim();
        if (current && isHttpUrl(current)) {
            return current;
        }
    } catch {
        // A failed lookup must never block the link: open what was saved.
    }
    return savedHref;
}
