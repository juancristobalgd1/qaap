// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Cursor-style timeline density tiers (spec level 1 / 2 / 3). */
export type TranscriptTimelineItemTier = 'current' | 'recent' | 'history';

/** Steps within this distance of the live step render as "recent" (level 2). */
export const TRANSCRIPT_TIMELINE_RECENT_DISTANCE = 4;

export function resolveTranscriptTimelineItemTier(
    index: number,
    activeIndex: number,
    totalCount: number,
): TranscriptTimelineItemTier {
    if (totalCount <= 0 || index < 0 || index >= totalCount) {
        return 'history';
    }
    if (activeIndex >= 0 && index === activeIndex) {
        return 'current';
    }
    if (activeIndex >= 0) {
        return Math.abs(index - activeIndex) <= TRANSCRIPT_TIMELINE_RECENT_DISTANCE
            ? 'recent'
            : 'history';
    }
    return index >= totalCount - TRANSCRIPT_TIMELINE_RECENT_DISTANCE ? 'recent' : 'history';
}

export function transcriptTimelineTierClassName(tier: TranscriptTimelineItemTier): string {
    return `theia-mod-timeline-${tier}`;
}
