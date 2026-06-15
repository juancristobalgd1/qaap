// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface ComposerSessionDiffFileView {
    readonly path: string;
    readonly added?: number;
    readonly removed?: number;
}

export interface ComposerSessionDiffStats {
    readonly added: number;
    readonly removed: number;
}

export function summarizeComposerSessionDiffFiles(
    files: readonly ComposerSessionDiffFileView[],
): ComposerSessionDiffStats {
    let added = 0;
    let removed = 0;
    for (const file of files) {
        added += file.added ?? 0;
        removed += file.removed ?? 0;
    }
    return { added, removed };
}

/**
 * Cursor-style streaming pill counters:
 * - +N peaks at the highest git insertion total seen this run
 * - −N grows when git deletions rise OR when git insertions drop (line/file removals on new files)
 */
export function accumulateComposerSessionDisplayStats(
    previousDisplay: ComposerSessionDiffStats | undefined,
    previousAggregate: ComposerSessionDiffStats | undefined,
    currentAggregate: ComposerSessionDiffStats,
): ComposerSessionDiffStats {
    const prev = previousDisplay ?? { added: 0, removed: 0 };
    if (!previousAggregate) {
        return {
            added: Math.max(prev.added, currentAggregate.added),
            removed: Math.max(prev.removed, currentAggregate.removed),
        };
    }
    const addedDrop = Math.max(0, previousAggregate.added - currentAggregate.added);
    const delsGain = Math.max(0, currentAggregate.removed - previousAggregate.removed);
    return {
        added: Math.max(prev.added, currentAggregate.added),
        removed: Math.max(prev.removed, currentAggregate.removed, prev.removed + addedDrop, prev.removed + delsGain),
    };
}

export function buildComposerGitFilesBaselineMap(
    files: readonly ComposerSessionDiffFileView[],
): Map<string, ComposerSessionDiffStats> {
    const map = new Map<string, ComposerSessionDiffStats>();
    for (const file of files) {
        map.set(file.path, { added: file.added ?? 0, removed: file.removed ?? 0 });
    }
    return map;
}

/** @deprecated Use accumulateComposerSessionDisplayStats — kept for transitional imports. */
export function resolveComposerSessionDiffStatsFromFiles(
    files: readonly ComposerSessionDiffFileView[],
    baselineFilesByPath: ReadonlyMap<string, ComposerSessionDiffStats>,
): ComposerSessionDiffStats {
    let added = 0;
    let removed = 0;
    for (const file of files) {
        const base = baselineFilesByPath.get(file.path) ?? { added: 0, removed: 0 };
        added += Math.max(0, (file.added ?? 0) - base.added);
        removed += Math.max(0, (file.removed ?? 0) - base.removed);
    }
    return { added, removed };
}

/** @deprecated Use accumulateComposerSessionDisplayStats. */
export function latchComposerSessionDisplayStats(
    previous: ComposerSessionDiffStats | undefined,
    session: ComposerSessionDiffStats,
): ComposerSessionDiffStats {
    const prev = previous ?? { added: 0, removed: 0 };
    return {
        added: Math.max(prev.added, session.added),
        removed: Math.max(prev.removed, session.removed),
    };
}
