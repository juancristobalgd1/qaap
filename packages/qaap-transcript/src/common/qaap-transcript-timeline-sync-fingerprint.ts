// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import type { TranscriptTimelineExpandState } from './qaap-transcript-timeline-gap-expand';
import type { TranscriptTimelineRenderWindow } from './qaap-transcript-timeline-window';

export const TRANSCRIPT_TIMELINE_SYNC_FP_ATTR = 'data-transcript-timeline-sync-fp';
export const TRANSCRIPT_ACTIVITY_ITEM_FP_ATTR = 'data-transcript-activity-item-fp';
export const TRANSCRIPT_ACTIVITY_ITEM_CONTENT_FP_ATTR = 'data-transcript-activity-item-content-fp';
export const TRANSCRIPT_TIMELINE_SUMMARY_FP_ATTR = 'data-transcript-timeline-summary-fp';

/** Stable fingerprint for visible timeline slots — skip DOM sync when unchanged between SSE frames. */
export function fingerprintTranscriptTimelineSync(
    visibleItems: readonly TranscriptActivityNavigationItem[],
    activeIndex: number,
    renderWindow: TranscriptTimelineRenderWindow,
    expandState: TranscriptTimelineExpandState,
    options?: {
        readonly stalled?: boolean;
        readonly expanded?: boolean;
        readonly collapsed?: boolean;
        readonly hiddenCount?: number;
    },
): string {
    const parts: string[] = [
        String(visibleItems.length),
        String(activeIndex),
        `${renderWindow.start}:${renderWindow.end}:${renderWindow.hiddenBefore}:${renderWindow.hiddenAfter}:${renderWindow.virtualized ? 1 : 0}`,
        expandState.revealAll ? '1' : '0',
        expandState.expandBefore ? '1' : '0',
        expandState.expandAfter ? '1' : '0',
        options?.stalled ? '1' : '0',
        options?.expanded ? '1' : '0',
        options?.collapsed ? '1' : '0',
        String(options?.hiddenCount ?? 0),
    ];
    for (let index = renderWindow.start; index < renderWindow.end; index++) {
        const item = visibleItems[index];
        if (!item) {
            continue;
        }
        parts.push([
            item.segmentIndex ?? '',
            item.state,
            item.label,
            item.nestDepth ?? 0,
            item.subagentRoot ? 1 : 0,
            item.durationMs ?? '',
            item.errorSummary ?? '',
        ].join(':'));
    }
    return parts.join('|');
}

/** Content-only fingerprint — excludes active tier/shimmer so chrome can patch without rebuilding copy. */
export function fingerprintTranscriptActivityItemContent(
    item: TranscriptActivityNavigationItem,
): string {
    return fingerprintTranscriptActivityItemSlot(item, false, '', false);
}

/** Fingerprint for a single timeline row (item or gap) within a sync pass. */
export function fingerprintTranscriptActivityItemSlot(
    item: TranscriptActivityNavigationItem,
    isActive: boolean,
    tier: string,
    shimmerActive: boolean,
): string {
    return [
        item.state,
        isActive ? 1 : 0,
        tier,
        shimmerActive ? 1 : 0,
        item.label,
        item.verb ?? '',
        item.detail ?? '',
        item.tail ?? '',
        item.nestDepth ?? 0,
        item.subagentRoot ? 1 : 0,
        item.durationMs ?? '',
        item.errorSummary ?? '',
        item.toolKind ?? '',
        item.editAdded ?? '',
        item.editRemoved ?? '',
        item.grouped ? 1 : 0,
        item.groupCount ?? '',
        item.thinkingContent?.length ?? '',
        item.thinkingContent?.slice(0, 64) ?? '',
        item.expandable ? 1 : 0,
        item.resultPreview ?? '',
    ].join(':');
}

export function fingerprintTranscriptActivityHistoryGapSlot(
    hiddenCount: number,
    position: 'before' | 'after',
): string {
    return `gap:${position}:${hiddenCount}`;
}

export function fingerprintTranscriptTimelineSummary(
    summaryText: string,
    hiddenCount: number,
    collapsed: boolean,
): string {
    return `${summaryText}|${hiddenCount}|${collapsed ? 1 : 0}`;
}
