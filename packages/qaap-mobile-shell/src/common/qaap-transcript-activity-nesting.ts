// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';

/** Tool names that spawn nested child-agent traces (Cursor Agent / Task). */
export const TRANSCRIPT_SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

export function isTranscriptSubagentToolName(toolName: string): boolean {
    return TRANSCRIPT_SUBAGENT_TOOL_NAMES.has(toolName.trim());
}

/** Map each toolUseId to its parent toolUseId (when emitted by stream-json). */
export function buildTranscriptToolParentMap(
    segments: readonly QaapAgentMessageSegmentDTO[],
): ReadonlyMap<string, string | undefined> {
    const map = new Map<string, string | undefined>();
    for (const segment of segments) {
        if (segment.type === 'tool') {
            map.set(segment.toolUseId, segment.parentToolUseId);
        }
    }
    return map;
}

/** Count parent hops from the segment's parent up to the root trace. */
export function resolveTranscriptActivityNestDepth(
    parentToolUseId: string | undefined,
    parentByToolUseId: ReadonlyMap<string, string | undefined>,
): number {
    if (!parentToolUseId) {
        return 0;
    }
    let depth = 0;
    let cursor: string | undefined = parentToolUseId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
        guard.add(cursor);
        depth += 1;
        cursor = parentByToolUseId.get(cursor);
    }
    return depth;
}

export function resolveTranscriptActivityToolUseId(
    segments: readonly QaapAgentMessageSegmentDTO[],
    segmentIndex: number | undefined,
): string | undefined {
    if (segmentIndex === undefined) {
        return undefined;
    }
    const segment = segments[segmentIndex];
    return segment?.type === 'tool' ? segment.toolUseId : undefined;
}

export function transcriptActivityHasNestedChildren(
    toolUseId: string,
    segments: readonly QaapAgentMessageSegmentDTO[],
): boolean {
    return segments.some(segment =>
        segment.type === 'tool' && segment.parentToolUseId === toolUseId);
}

export function transcriptActivityNestDepthClassName(depth: number): string | undefined {
    if (depth <= 0) {
        return undefined;
    }
    if (depth >= 3) {
        return 'theia-mod-nest-3';
    }
    return `theia-mod-nest-${depth}`;
}

/** Attach nest depth and subagent-root markers for timeline rendering. */
export function annotateTranscriptActivityNestMetadata(
    items: readonly TranscriptActivityNavigationItem[],
    segments: readonly QaapAgentMessageSegmentDTO[],
): TranscriptActivityNavigationItem[] {
    const parentByToolUseId = buildTranscriptToolParentMap(segments);
    return items.map(item => {
        const segmentIndexes = item.segmentIndices?.length
            ? item.segmentIndices
            : item.segmentIndex !== undefined
                ? [item.segmentIndex]
                : [];
        let nestDepth = 0;
        let parentToolUseId: string | undefined;
        let subagentRoot = false;
        for (const segmentIndex of segmentIndexes) {
            const segment = segments[segmentIndex];
            if (segment?.type !== 'tool') {
                continue;
            }
            const depth = resolveTranscriptActivityNestDepth(segment.parentToolUseId, parentByToolUseId);
            if (depth > nestDepth) {
                nestDepth = depth;
                parentToolUseId = segment.parentToolUseId;
            }
            if (isTranscriptSubagentToolName(segment.name)
                && transcriptActivityHasNestedChildren(segment.toolUseId, segments)) {
                subagentRoot = true;
            }
        }
        if (!parentToolUseId && !subagentRoot && nestDepth === 0) {
            return item;
        }
        return {
            ...item,
            parentToolUseId,
            nestDepth,
            subagentRoot,
        };
    });
}
