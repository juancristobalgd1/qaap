// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** ~60 fps cap near the bottom — coalesces bursty tool SSE without lagging autoscroll. */
export const TRANSCRIPT_STREAMING_NEAR_BOTTOM_COALESCE_MS = 16;

/** ~60 fps cap off-bottom on desktop — avoids repaint flicker while reading above the tail. */
export const TRANSCRIPT_STREAMING_DESKTOP_OFF_BOTTOM_COALESCE_MS = 16;

/** ~30 fps cap for coarse pointer off-bottom — scroll smoothness on touch devices. */
export const TRANSCRIPT_STREAMING_OFF_BOTTOM_COALESCE_MS = 33;

export function matchesCoarsePointer(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Delay before applying the next streaming visual patch.
 * Near-bottom: ~60 fps to batch tool bursts; off-bottom + coarse pointer: ~30 fps for scroll smoothness.
 */
export function resolveTranscriptStreamingCoalesceDelayMs(isNearBottom: boolean): number {
    if (isNearBottom) {
        return TRANSCRIPT_STREAMING_NEAR_BOTTOM_COALESCE_MS;
    }
    if (matchesCoarsePointer()) {
        return TRANSCRIPT_STREAMING_OFF_BOTTOM_COALESCE_MS;
    }
    return TRANSCRIPT_STREAMING_DESKTOP_OFF_BOTTOM_COALESCE_MS;
}
