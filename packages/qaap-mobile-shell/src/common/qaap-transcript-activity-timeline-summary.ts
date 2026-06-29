// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { formatTranscriptCursorTraceRowText } from './qaap-transcript-cursor-trace-label';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import { isTranscriptActivityLiveState } from './qaap-transcript-activity-step-state';

function isTranscriptTimelinePlanningItem(item: TranscriptActivityNavigationItem): boolean {
    return item.verb === 'Planning'
        || item.verb === 'Thinking'
        || item.navigate === 'thought';
}

function isTranscriptTimelineAnswerItem(item: TranscriptActivityNavigationItem): boolean {
    return item.verb === 'Preparing';
}

function isTranscriptTimelineActionItem(item: TranscriptActivityNavigationItem): boolean {
    return !isTranscriptTimelinePlanningItem(item) && !isTranscriptTimelineAnswerItem(item);
}

export function formatTranscriptActivityTimelineItemLabel(item: TranscriptActivityNavigationItem): string {
    if (item.verb && item.detail) {
        return formatTranscriptCursorTraceRowText(item.verb, item.detail);
    }
    return item.label;
}

/** Sticky / collapsed summary — prefers the live tool step over generic "Explored N files". */
export function resolveTranscriptActivityTimelineSummaryText(
    segments: readonly QaapAgentMessageSegmentDTO[],
    items: readonly TranscriptActivityNavigationItem[],
    hiddenCount = 0,
    options?: {
        readonly streaming?: boolean;
        readonly formatExploredSummary?: (segments: readonly QaapAgentMessageSegmentDTO[]) => string | undefined;
    },
): string {
    const activeAction = [...items].reverse().find(item =>
        isTranscriptActivityLiveState(item.state) && isTranscriptTimelineActionItem(item));
    const lastAction = [...items].reverse().find(isTranscriptTimelineActionItem);
    const activeAny = [...items].reverse().find(item => isTranscriptActivityLiveState(item.state));

    let summary: string;
    if (options?.streaming && activeAction) {
        summary = formatTranscriptActivityTimelineItemLabel(activeAction);
    } else if (lastAction) {
        summary = formatTranscriptActivityTimelineItemLabel(lastAction);
    } else if (activeAny) {
        summary = formatTranscriptActivityTimelineItemLabel(activeAny);
    } else {
        const explored = options?.formatExploredSummary?.(segments);
        if (explored) {
            summary = explored;
        } else if (items.length > 0) {
            summary = formatTranscriptActivityTimelineItemLabel(items[items.length - 1]!);
        } else {
            summary = nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity');
        }
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
