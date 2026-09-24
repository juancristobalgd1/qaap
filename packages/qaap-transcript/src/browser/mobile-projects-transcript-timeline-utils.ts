// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Timeline utility functions extracted from
// mobile-projects-transcript-messages-artifacts-ui.ts.

import type { TranscriptActivityNavigationItem } from '../common/qaap-transcript-activity-navigation';

export interface TranscriptActivityTimelineItem extends TranscriptActivityNavigationItem { }

export function isTranscriptExecutionTimelineNarrative(item: TranscriptActivityTimelineItem): boolean {
    return item.timelineRole === 'narrative';
}

export function transcriptExecutionTimelineCount(item: TranscriptActivityTimelineItem): number {
    return Math.max(1, item.groupCount ?? item.segmentIndices?.length ?? 1);
}

export function isTranscriptVerificationCommand(command: string | undefined): boolean {
    return !!command && /(^|[\s"'`:,{[])(npm|yarn|pnpm|npx|node)?\s*(run\s+)?(test|vitest|lint|typecheck|tsc)(:|\b)/i.test(command);
}

export function resolveTranscriptExecutionToolGroupParts(
    item: TranscriptActivityTimelineItem,
): Pick<TranscriptActivityTimelineItem, 'label' | 'verb' | 'detail' | 'tail' | 'timelineRole'> {
    const count = transcriptExecutionTimelineCount(item);
    const plural = (one: string, many: string): string => count === 1 ? one : many;
    if (item.toolKind === 'reading') {
        return {
            timelineRole: 'toolGroup',
            label: count === 1 ? 'Read 1 file' : `Read ${count} files`,
            verb: 'Read',
            detail: count === 1 ? '1 file' : `${count} files`,
            tail: undefined,
        };
    }
    if (item.toolKind === 'searching') {
        return {
            timelineRole: 'toolGroup',
            label: count === 1 ? 'Explore 1 search' : `Explore ${count} searches`,
            verb: 'Explore',
            detail: count === 1 ? '1 search' : `${count} searches`,
            tail: undefined,
        };
    }
    if (item.toolKind === 'editing') {
        return {
            timelineRole: 'toolGroup',
            label: count === 1 ? 'Update 1 file' : `Update ${count} files`,
            verb: 'Update',
            detail: count === 1 ? '1 file' : `${count} files`,
            tail: undefined,
        };
    }
    if (item.toolKind === 'terminal') {
        const verification = isTranscriptVerificationCommand(item.detail);
        const verb = verification ? 'Verification' : 'Run';
        const unit = verification ? plural('check', 'checks') : plural('command', 'commands');
        return {
            timelineRole: 'toolGroup',
            label: `${verb} ${count} ${unit}`,
            verb,
            detail: `${count} ${unit}`,
            tail: undefined,
        };
    }
    return {
        timelineRole: 'toolGroup',
        label: count === 1 ? 'Use 1 tool' : `Use ${count} tools`,
        verb: 'Use',
        detail: count === 1 ? '1 tool' : `${count} tools`,
        tail: undefined,
    };
}

export function resolveTranscriptExecutionNarrative(item: TranscriptActivityTimelineItem): string {
    if (item.toolKind === 'reading') {
        return "I'm checking the relevant files.";
    }
    if (item.toolKind === 'searching') {
        return "I'm inspecting the repository structure.";
    }
    if (item.toolKind === 'editing') {
        return "I'm updating the implementation.";
    }
    if (item.toolKind === 'terminal') {
        return isTranscriptVerificationCommand(item.detail)
            ? "I'm validating the implementation."
            : "I'm running the next command.";
    }
    return "I'm applying the next step.";
}

export function createTranscriptExecutionNarrativeItem(label: string, anchor: TranscriptActivityTimelineItem): TranscriptActivityTimelineItem {
    return {
        label,
        timelineRole: 'narrative',
        state: 'success',
        timestamp: anchor.timestamp,
        segmentIndex: anchor.segmentIndex,
    };
}

export function buildTranscriptExecutionTimelineItems(items: readonly TranscriptActivityTimelineItem[]): TranscriptActivityTimelineItem[] {
    const timeline: TranscriptActivityTimelineItem[] = [];
    for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        if (!item.toolKind) {
            if (item.verb === 'Preparing') {
                timeline.push({
                    ...item,
                    timelineRole: 'result',
                    label: item.label,
                    verb: undefined,
                    detail: undefined,
                    tail: undefined,
                });
            } else {
                timeline.push(item);
            }
            continue;
        }
        const previous = timeline[timeline.length - 1];
        if (!previous || !isTranscriptExecutionTimelineNarrative(previous)) {
            timeline.push(createTranscriptExecutionNarrativeItem(resolveTranscriptExecutionNarrative(item), item));
        }
        timeline.push({
            ...item,
            ...resolveTranscriptExecutionToolGroupParts(item),
        });
    }
    return timeline;
}

/** Leading "Error: " marker prepended by {@link traceEventsToSegments} when it
 *  converts an `error` trace event into a plain text segment. Stripped before
 *  comparing closing-narrative text against `msg.error` (which never carries
 *  the prefix) so identical content is recognized as a duplicate regardless
 *  of which side added the marker. */
const MOBILE_CLOSING_TEXT_ERROR_PREFIX = /^error:\s*/i;

/** Normalizes closing-narrative text for duplicate detection: trims and
 *  strips a leading "Error: " marker so a trace-derived error segment and the
 *  canonical `msg.error` string compare equal. */
export function normalizeMobileClosingNarrativeText(text: string): string {
    return text.trim().replace(MOBILE_CLOSING_TEXT_ERROR_PREFIX, '').trim();
}
