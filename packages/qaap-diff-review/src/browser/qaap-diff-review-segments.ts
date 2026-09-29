// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGitHunkLine } from '@theia/qaap-shared-core/lib/common/qaap-git-review';

/** Context lines above this count collapse into an expandable bar (Cursor agent diff style). */
export const CONTEXT_COLLAPSE_THRESHOLD = 4;

export type QaapDiffContextSegment =
    | { kind: 'lines'; lines: QaapGitHunkLine[] }
    | { kind: 'collapsed'; lines: QaapGitHunkLine[] };

/**
 * Segments are derived purely from a hunk's `lines` array, which is immutable once a diff response
 * arrives; caching by array identity keeps re-renders from rebuilding them while letting a
 * re-fetched diff (new arrays) be garbage collected with its cache entry.
 */
const segmentCache = new WeakMap<readonly QaapGitHunkLine[], QaapDiffContextSegment[]>();

/** Split hunk lines into visible runs and collapsible runs of unmodified context. */
export function buildContextSegments(lines: readonly QaapGitHunkLine[]): QaapDiffContextSegment[] {
    const cached = segmentCache.get(lines);
    if (cached) {
        return cached;
    }
    const segments: QaapDiffContextSegment[] = [];
    let ctxRun: QaapGitHunkLine[] = [];

    const flushCtx = (): void => {
        if (ctxRun.length === 0) {
            return;
        }
        segments.push({ kind: ctxRun.length >= CONTEXT_COLLAPSE_THRESHOLD ? 'collapsed' : 'lines', lines: ctxRun });
        ctxRun = [];
    };

    for (const line of lines) {
        if (line.type === 'ctx') {
            ctxRun.push(line);
        } else {
            flushCtx();
            segments.push({ kind: 'lines', lines: [line] });
        }
    }
    flushCtx();
    segmentCache.set(lines, segments);
    return segments;
}

/**
 * React key for a diff line that stays stable within a hunk: added lines own a unique new number,
 * removed lines a unique old number and context lines both. Falls back to the index when the
 * backend omitted line numbers.
 */
export function diffLineKey(line: QaapGitHunkLine, index: number): string {
    if (line.oldNumber === undefined && line.newNumber === undefined) {
        return `i${index}`;
    }
    return `${line.type}:${line.oldNumber ?? ''}:${line.newNumber ?? ''}`;
}
