// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    resolveTranscriptTimelineRenderWindow,
    type TranscriptTimelineRenderWindow,
} from './qaap-transcript-timeline-window';

export const TRANSCRIPT_TIMELINE_REVEAL_ALL_ATTR = 'data-transcript-timeline-reveal-all';
export const TRANSCRIPT_TIMELINE_EXPAND_BEFORE_ATTR = 'data-transcript-timeline-expand-before';
export const TRANSCRIPT_TIMELINE_EXPAND_AFTER_ATTR = 'data-transcript-timeline-expand-after';
export const TRANSCRIPT_TIMELINE_GAP_POSITION_ATTR = 'data-transcript-timeline-gap-position';

export interface TranscriptTimelineExpandState {
    readonly revealAll: boolean;
    readonly expandBefore: boolean;
    readonly expandAfter: boolean;
}

export function readTranscriptTimelineExpandState(timeline: HTMLElement): TranscriptTimelineExpandState {
    return {
        revealAll: timeline.getAttribute(TRANSCRIPT_TIMELINE_REVEAL_ALL_ATTR) === 'true',
        expandBefore: timeline.getAttribute(TRANSCRIPT_TIMELINE_EXPAND_BEFORE_ATTR) === 'true',
        expandAfter: timeline.getAttribute(TRANSCRIPT_TIMELINE_EXPAND_AFTER_ATTR) === 'true',
    };
}

export function markTranscriptTimelineRevealAll(timeline: HTMLElement): void {
    timeline.setAttribute(TRANSCRIPT_TIMELINE_REVEAL_ALL_ATTR, 'true');
    timeline.setAttribute(TRANSCRIPT_TIMELINE_EXPAND_BEFORE_ATTR, 'true');
    timeline.setAttribute(TRANSCRIPT_TIMELINE_EXPAND_AFTER_ATTR, 'true');
}

export function markTranscriptTimelineGapExpanded(
    timeline: HTMLElement,
    position: 'before' | 'after',
): void {
    if (position === 'before') {
        timeline.setAttribute(TRANSCRIPT_TIMELINE_EXPAND_BEFORE_ATTR, 'true');
    } else {
        timeline.setAttribute(TRANSCRIPT_TIMELINE_EXPAND_AFTER_ATTR, 'true');
    }
}

/** Apply user expand flags on top of the default virtualization window. */
export function resolveTranscriptTimelineRenderWindowWithExpand(
    itemCount: number,
    options?: {
        readonly threshold?: number;
        readonly windowSize?: number;
        readonly focusIndex?: number;
        readonly enabled?: boolean;
        readonly expand?: TranscriptTimelineExpandState;
    },
): TranscriptTimelineRenderWindow {
    const base = resolveTranscriptTimelineRenderWindow(itemCount, options);
    const expand = options?.expand;
    if (!expand || !base.virtualized) {
        return base;
    }
    if (expand.revealAll || (expand.expandBefore && expand.expandAfter)) {
        return {
            start: 0,
            end: itemCount,
            hiddenBefore: 0,
            hiddenAfter: 0,
            virtualized: false,
        };
    }
    let start = base.start;
    let end = base.end;
    if (expand.expandBefore) {
        start = 0;
    }
    if (expand.expandAfter) {
        end = itemCount;
    }
    return {
        start,
        end,
        hiddenBefore: start,
        hiddenAfter: itemCount - end,
        virtualized: start > 0 || end < itemCount,
    };
}
