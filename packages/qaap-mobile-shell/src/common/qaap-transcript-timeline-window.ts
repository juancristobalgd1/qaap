// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD = 48;
export const TRANSCRIPT_TIMELINE_WINDOW_SIZE = 32;

export interface TranscriptTimelineRenderWindow {
    readonly start: number;
    readonly end: number;
    readonly hiddenBefore: number;
    readonly hiddenAfter: number;
    readonly virtualized: boolean;
}

/** Windowed DOM render for long plan traces — keeps the live step near the viewport center. */
export function resolveTranscriptTimelineRenderWindow(
    itemCount: number,
    options?: {
        readonly threshold?: number;
        readonly windowSize?: number;
        readonly focusIndex?: number;
        readonly enabled?: boolean;
    },
): TranscriptTimelineRenderWindow {
    const threshold = options?.threshold ?? TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD;
    const windowSize = options?.windowSize ?? TRANSCRIPT_TIMELINE_WINDOW_SIZE;
    if (!options?.enabled || itemCount <= threshold) {
        return {
            start: 0,
            end: itemCount,
            hiddenBefore: 0,
            hiddenAfter: 0,
            virtualized: false,
        };
    }
    const focus = Math.max(0, Math.min(itemCount - 1, options?.focusIndex ?? itemCount - 1));
    const half = Math.floor(windowSize / 2);
    let start = Math.max(0, focus - half);
    let end = Math.min(itemCount, start + windowSize);
    start = Math.max(0, end - windowSize);
    return {
        start,
        end,
        hiddenBefore: start,
        hiddenAfter: itemCount - end,
        virtualized: true,
    };
}
