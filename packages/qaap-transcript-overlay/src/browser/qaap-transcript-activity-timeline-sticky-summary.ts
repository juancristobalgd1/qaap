// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common';
import {
    shouldStickTranscriptActivityTimelineSummary,
    TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS,
} from '../common/qaap-transcript-activity-timeline-sticky-summary';
import { TRANSCRIPT_ACTIVITY_TIMELINE_ATTR } from '../common/qaap-transcript-incremental-update';

const TIMELINE_SELECTOR = `[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`;

/**
 * Pins the execution timeline summary while scrolling a long agent turn (Cursor parity).
 * Uses CSS `position: sticky` on the summary plus a stuck class for backdrop/shadow polish.
 */
export function attachTranscriptActivityTimelineStickySummary(scroller: HTMLElement): Disposable {
    let raf = 0;

    const sync = (): void => {
        raf = 0;
        const scrollerRect = scroller.getBoundingClientRect();
        for (const timeline of scroller.querySelectorAll<HTMLElement>(TIMELINE_SELECTOR)) {
            if (!(timeline instanceof HTMLDetailsElement) || !timeline.open) {
                timeline.classList.remove(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS);
                continue;
            }
            const summary = timeline.querySelector('.theia-mobile-agent-activity-timeline-sticky-bar')
                ?? timeline.querySelector('summary');
            if (!summary) {
                timeline.classList.remove(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS);
                continue;
            }
            const stuck = shouldStickTranscriptActivityTimelineSummary(
                timeline.getBoundingClientRect(),
                summary.getBoundingClientRect(),
                scrollerRect,
            );
            timeline.classList.toggle(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS, stuck);
        }
    };

    const scheduleSync = (): void => {
        if (raf) {
            return;
        }
        raf = requestAnimationFrame(sync);
    };

    scroller.addEventListener('scroll', scheduleSync, { passive: true });
    const resizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(scheduleSync)
        : undefined;
    resizeObserver?.observe(scroller);
    const mutationObserver = new MutationObserver(scheduleSync);
    mutationObserver.observe(scroller, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'class'],
    });

    scheduleSync();

    return Disposable.create(() => {
        if (raf) {
            cancelAnimationFrame(raf);
        }
        scroller.removeEventListener('scroll', scheduleSync);
        resizeObserver?.disconnect();
        mutationObserver.disconnect();
        for (const timeline of scroller.querySelectorAll<HTMLElement>(TIMELINE_SELECTOR)) {
            timeline.classList.remove(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS);
        }
    });
}
