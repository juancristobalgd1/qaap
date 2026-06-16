// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import { isTranscriptActivityLiveState } from './qaap-transcript-activity-step-state';

export const TRANSCRIPT_TIMELINE_COLLAPSE_THRESHOLD = 20;

export interface TranscriptTimelineVisibilityPolicy {
    readonly visibleItems: readonly TranscriptActivityNavigationItem[];
    readonly hiddenCount: number;
    readonly collapsed: boolean;
}

function findActiveIndex(items: readonly TranscriptActivityNavigationItem[]): number {
    return items.findIndex(item => isTranscriptActivityLiveState(item.state));
}

function findLastCompletedIndex(items: readonly TranscriptActivityNavigationItem[]): number {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const state = items[index]?.state;
        if (state === 'success' || state === 'streaming') {
            return index;
        }
    }
    return -1;
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
 * Cursor-style collapse once a turn exceeds {@link TRANSCRIPT_TIMELINE_COLLAPSE_THRESHOLD} steps.
 * Keeps the live step, the latest error, and the latest completed step visible.
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
    const completedIndex = findLastCompletedIndex(items);
    if (completedIndex >= 0) {
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
