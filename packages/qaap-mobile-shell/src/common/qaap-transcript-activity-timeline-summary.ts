// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { formatTranscriptCursorTraceRowText } from './qaap-transcript-cursor-trace-label';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import { formatTranscriptActivityStepDuration } from './qaap-transcript-activity-step-state';

export function formatTranscriptActivityTimelineItemLabel(item: TranscriptActivityNavigationItem): string {
    if (item.verb && item.detail) {
        return formatTranscriptCursorTraceRowText(item.verb, item.detail);
    }
    return item.label;
}

/**
 * Sticky / collapsed process-accordion header.
 *
 * Reports only how long the turn took — never which step is running. The live
 * step-by-step narration belongs to the orb / activity row below the header,
 * and duplicating it here made the header rewrite itself several times per
 * second. Mirrors the Codex header: "Processing for 12s" → "Processed in 12s".
 */
export function resolveTranscriptActivityTimelineSummaryText(
    hiddenCount = 0,
    options?: {
        readonly streaming?: boolean;
        readonly durationMs?: number;
    },
): string {
    const durationText = resolveTranscriptTurnDurationText(options?.durationMs, options?.streaming);
    let summary: string;
    if (options?.streaming) {
        summary = durationText
            ? nls.localize('qaap/mobileProjects/transcriptActivityProcessing', 'Processing for {0}', durationText)
            : nls.localize('qaap/mobileProjects/transcriptActivityProcessingPending', 'Processing…');
    } else if (durationText) {
        summary = nls.localize('qaap/mobileProjects/transcriptActivityProcessed', 'Processed in {0}', durationText);
    } else {
        summary = nls.localize('qaap/mobileProjects/transcriptActivityProcessedPending', 'Processed');
    }
    if (hiddenCount > 0) {
        return nls.localize(
            'qaap/mobileProjects/transcriptActivityCollapsedSummary',
            '{0} · {1} earlier steps',
            summary,
            String(hiddenCount),
        );
    }
    return summary;
}

/**
 * While the turn is live the duration is floored to whole seconds: the header
 * re-renders on every SSE tick, and a sub-second reading would rewrite it ~8
 * times per second for no readable gain.
 */
function resolveTranscriptTurnDurationText(durationMs: number | undefined, streaming?: boolean): string | undefined {
    if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
        return undefined;
    }
    return formatTranscriptActivityStepDuration(streaming ? Math.floor(durationMs / 1000) * 1000 : durationMs);
}
