// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Reloading an open preview after an agent turn: keep the page the user is on (route, query,
 * hash), bypass the HTTP cache, and reuse the surface instead of opening a widget.
 */

const QAAP_CACHE_BUST_PARAM = '_qaap_cache_bust';

/** The page the frame shows now: the live location when same-origin, else its `src`. */
export function readQaapPreviewFrameUrl(frame: Pick<HTMLIFrameElement, 'src' | 'contentWindow'>): string | undefined {
    try {
        const href = frame.contentWindow?.location.href;
        if (href && href !== 'about:blank') {
            return href;
        }
    } catch {
        /* cross-origin preview: only `src` is readable */
    }
    return frame.src && frame.src !== 'about:blank' ? frame.src : undefined;
}

/** `url` with a fresh cache-bust marker (any previous one replaced). */
export function withQaapPreviewCacheBust(url: string, now: number = Date.now()): string {
    try {
        const parsed = new URL(url);
        parsed.searchParams.set(QAAP_CACHE_BUST_PARAM, String(now));
        return parsed.toString();
    } catch {
        return url;
    }
}

/** Plain frames (embedded panes): replace the document so Back does not step through reloads. */
export function navigateQaapPreviewFrame(frame: HTMLIFrameElement, url: string): void {
    try {
        if (frame.contentWindow) {
            frame.contentWindow.location.replace(url);
            return;
        }
    } catch {
        /* fall through to src */
    }
    frame.src = url;
}
