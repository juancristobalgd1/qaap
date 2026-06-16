// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS = 'theia-mod-sticky-summary-stuck';

/** True when the timeline summary is pinned at the top of the transcript scroller. */
export function shouldStickTranscriptActivityTimelineSummary(
    timelineRect: DOMRectReadOnly,
    summaryRect: DOMRectReadOnly,
    scrollerRect: DOMRectReadOnly,
    epsilonPx = 1,
): boolean {
    if (timelineRect.height <= summaryRect.height + epsilonPx) {
        return false;
    }
    const summaryTop = summaryRect.top;
    const scrollerTop = scrollerRect.top;
    const timelineBottom = timelineRect.bottom;
    return summaryTop <= scrollerTop + epsilonPx
        && timelineBottom > scrollerTop + summaryRect.height + epsilonPx;
}
