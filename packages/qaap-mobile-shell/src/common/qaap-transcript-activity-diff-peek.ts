// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { extractInlineDiffPreview, type QaapTranscriptInlineDiffLine } from './qaap-agent-transcript-segments';
import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';

export interface TranscriptActivityDiffPeek {
    readonly lines: readonly QaapTranscriptInlineDiffLine[];
    readonly added?: number;
    readonly removed?: number;
}

/** Resolve a compact 2–3 line diff peek for edit/write activity rows when result text exists. Never invent. */
export function resolveTranscriptActivityDiffPeek(
    item: Pick<TranscriptActivityNavigationItem, 'toolKind' | 'segmentIndex' | 'segmentIndices' | 'editAdded' | 'editRemoved' | 'grouped'>,
    segments: readonly QaapAgentMessageSegmentDTO[] | undefined,
    maxLines = 3,
): TranscriptActivityDiffPeek | undefined {
    if (item.toolKind !== 'editing' || item.grouped) {
        return undefined;
    }
    if (!segments?.length) {
        return undefined;
    }
    const indices = item.segmentIndices?.length
        ? item.segmentIndices
        : item.segmentIndex !== undefined
            ? [item.segmentIndex]
            : [];
    if (indices.length !== 1) {
        return undefined;
    }
    const segment = segments[indices[0]!];
    if (segment?.type !== 'tool') {
        return undefined;
    }
    const result = segment.result?.trim();
    if (!result) {
        return undefined;
    }
    const lines = extractInlineDiffPreview(result, maxLines);
    if (!lines?.length) {
        return undefined;
    }
    return {
        lines,
        added: item.editAdded,
        removed: item.editRemoved,
    };
}
