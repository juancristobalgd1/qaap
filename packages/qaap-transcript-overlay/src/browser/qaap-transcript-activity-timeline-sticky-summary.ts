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

function resolveTranscriptTimelineScroller(mountHost: HTMLElement): HTMLElement | undefined {
    const list = mountHost.querySelector<HTMLElement>(':scope > .theia-mobile-agent-transcript');
    if (list) {
        return list;
    }
    if (mountHost.classList.contains('theia-mobile-agent-transcript')) {
        return mountHost;
    }
    return undefined;
}

/**
 * Pins the execution timeline summary while scrolling a long agent turn (Cursor parity).
 * Uses CSS `position: sticky` on the summary plus a stuck class for backdrop/shadow polish.
 */
export function attachTranscriptActivityTimelineStickySummary(scroller: HTMLElement): Disposable {
    let raf = 0;
    let boundScroller: HTMLElement | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let mutationObserver: MutationObserver | undefined;

    const sync = (): void => {
        raf = 0;
        if (!boundScroller) {
            return;
        }
        const scrollerRect = boundScroller.getBoundingClientRect();
        for (const timeline of boundScroller.querySelectorAll<HTMLElement>(TIMELINE_SELECTOR)) {
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

    const unbindScroller = (): void => {
        if (boundScroller) {
            boundScroller.removeEventListener('scroll', scheduleSync);
            for (const timeline of boundScroller.querySelectorAll<HTMLElement>(TIMELINE_SELECTOR)) {
                timeline.classList.remove(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS);
            }
        }
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        resizeObserver = undefined;
        mutationObserver = undefined;
        boundScroller = undefined;
    };

    const bindScroller = (nextScroller: HTMLElement | undefined): void => {
        if (nextScroller === boundScroller) {
            scheduleSync();
            return;
        }
        unbindScroller();
        boundScroller = nextScroller;
        if (!boundScroller) {
            return;
        }
        boundScroller.addEventListener('scroll', scheduleSync, { passive: true });
        resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(scheduleSync)
            : undefined;
        resizeObserver?.observe(boundScroller);
        mutationObserver = new MutationObserver(scheduleSync);
        mutationObserver.observe(boundScroller, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['open', 'class'],
        });
        scheduleSync();
    };

    const resolveAndBindScroller = (): void => {
        bindScroller(resolveTranscriptTimelineScroller(scroller));
    };

    const hostMutationObserver = new MutationObserver(resolveAndBindScroller);
    hostMutationObserver.observe(scroller, { childList: true, subtree: false });

    resolveAndBindScroller();

    return Disposable.create(() => {
        if (raf) {
            cancelAnimationFrame(raf);
        }
        hostMutationObserver.disconnect();
        unbindScroller();
    });
}
