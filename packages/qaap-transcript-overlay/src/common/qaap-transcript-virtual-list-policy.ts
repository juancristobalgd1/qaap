// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Virtualize once the thread is long enough to hurt scroll paint on real devices.
 *
 * Kept high on purpose: message heights vary wildly (a one-line "hola" vs an agent turn with tool
 * output can be 50px vs ~1000px), so a virtualized list's estimated total height swings as rows are
 * measured on scroll — which makes scrolling UP to earlier turns jump/rebound and feel like the
 * transcript is "cut off". Below these counts the transcript renders fully (real native heights,
 * stable native scroll, every turn reachable); only genuinely long threads virtualize.
 */
export const TRANSCRIPT_VIRTUAL_MIN_MESSAGES = 50;
/** Lower threshold on narrow mobile viewports where scroll paint cost hits sooner. */
export const TRANSCRIPT_VIRTUAL_MIN_MESSAGES_NARROW = 30;

/** Keep in sync with {@link MOBILE_NARROW_VIEWPORT_MEDIA_QUERY} in core mobile-layout-state. */
export const TRANSCRIPT_VIRTUAL_NARROW_MEDIA_QUERY = '(max-width: 767px)';

/** Message-count threshold before enabling virtual scroll (lower on narrow mobile). */
export function resolveTranscriptVirtualMinMessages(
    matchesNarrow: () => boolean = matchesTranscriptVirtualNarrowViewport,
): number {
    return matchesNarrow()
        ? TRANSCRIPT_VIRTUAL_MIN_MESSAGES_NARROW
        : TRANSCRIPT_VIRTUAL_MIN_MESSAGES;
}

export function matchesTranscriptVirtualNarrowViewport(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia(TRANSCRIPT_VIRTUAL_NARROW_MEDIA_QUERY).matches;
}
