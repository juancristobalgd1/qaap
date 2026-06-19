// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common';
import { TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS } from '../common/qaap-transcript-activity-timeline-sticky-summary';
import { TRANSCRIPT_ACTIVITY_TIMELINE_ATTR } from '../common/qaap-transcript-incremental-update';

const TIMELINE_SELECTOR = `[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`;

/**
 * Timeline summaries scroll with the transcript. Keep this exported hook as a cleanup-only
 * compatibility point so callers do not install per-scroll work for non-sticky summaries.
 */
export function attachTranscriptActivityTimelineStickySummary(scroller: HTMLElement): Disposable {
    for (const timeline of scroller.querySelectorAll<HTMLElement>(TIMELINE_SELECTOR)) {
        timeline.classList.remove(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS);
    }
    return Disposable.create(() => {
        for (const timeline of scroller.querySelectorAll<HTMLElement>(TIMELINE_SELECTOR)) {
            timeline.classList.remove(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS);
        }
    });
}
