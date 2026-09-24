// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import { isTranscriptActivityLiveState } from './qaap-transcript-activity-step-state';

export const TRANSCRIPT_TIMELINE_COLLAPSE_THRESHOLD = 14;
export const TRANSCRIPT_TIMELINE_RECENT_COMPLETED_COUNT = 3;

export interface TranscriptTimelineVisibilityPolicy {
    readonly visibleItems: readonly TranscriptActivityNavigationItem[];
    readonly hiddenCount: number;
    readonly collapsed: boolean;
}

function findActiveIndex(items: readonly TranscriptActivityNavigationItem[]): number {
    return items.findIndex(item => isTranscriptActivityLiveState(item.state));
}

function findRecentCompletedIndices(
    items: readonly TranscriptActivityNavigationItem[],
    count = TRANSCRIPT_TIMELINE_RECENT_COMPLETED_COUNT,
): readonly number[] {
    const indices: number[] = [];
    for (let index = items.length - 1; index >= 0 && indices.length < count; index -= 1) {
        const state = items[index]?.state;
        if (state === 'success' || state === 'streaming') {
            indices.unshift(index);
        }
    }
    return indices;
}

function findLastErrorIndex(items: readonly TranscriptActivityNavigationItem[]): number {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index]?.state === 'error') {
            return index;
        }
    }
    return -1;
}

/**
 * Collapse noisy traces once a turn exceeds {@link TRANSCRIPT_TIMELINE_COLLAPSE_THRESHOLD} steps.
 * Keeps the live step, the latest error, and a small tail of completed work visible.
 */
export function resolveTranscriptTimelineVisibilityPolicy(
    items: readonly TranscriptActivityNavigationItem[],
    options?: {
        readonly threshold?: number;
        readonly maxVisibleItems?: number;
        readonly revealAll?: boolean;
    },
): TranscriptTimelineVisibilityPolicy {
    const threshold = options?.threshold ?? TRANSCRIPT_TIMELINE_COLLAPSE_THRESHOLD;
    const maxVisibleItems = options?.maxVisibleItems ?? 0;
    if (options?.revealAll) {
        return { visibleItems: items, hiddenCount: 0, collapsed: false };
    }
    if (items.length === 0) {
        return { visibleItems: items, hiddenCount: 0, collapsed: false };
    }
    if (maxVisibleItems > 0 && items.length > maxVisibleItems) {
        const sliced = items.slice(-maxVisibleItems);
        return {
            visibleItems: sliced,
            hiddenCount: items.length - sliced.length,
            collapsed: true,
        };
    }
    if (items.length <= threshold) {
        return { visibleItems: items, hiddenCount: 0, collapsed: false };
    }
    const keep = new Set<number>();
    const activeIndex = findActiveIndex(items);
    if (activeIndex >= 0) {
        keep.add(activeIndex);
    }
    const errorIndex = findLastErrorIndex(items);
    if (errorIndex >= 0) {
        keep.add(errorIndex);
    }
    for (const completedIndex of findRecentCompletedIndices(items)) {
        keep.add(completedIndex);
    }
    if (keep.size === 0) {
        keep.add(items.length - 1);
    }
    const visibleItems = items.filter((_, index) => keep.has(index));
    return {
        visibleItems,
        hiddenCount: items.length - visibleItems.length,
        collapsed: visibleItems.length < items.length,
    };
}
