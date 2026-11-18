// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Line totals of a whole task, measured against its baseline commit. */
export interface QaapTaskDiffTotals {
    readonly added: number;
    readonly removed: number;
}

/** The summary fields that carry a task's totals. */
export interface QaapTaskDiffSummaryLike {
    readonly baselineCommit?: string;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
}

/**
 * Latest live task totals, keyed by task baseline commit. A live read of the review endpoint (the
 * Changes panel) publishes here so the chat pill and the Work Hub rows show the same number as the
 * panel instead of the total frozen when the turn settled. Frontend memory only: a reload falls back
 * to the settled value until the panel is read again.
 */
const liveTotals = new Map<string, QaapTaskDiffTotals>();

export namespace QaapLiveTaskDiff {
    /** Records the live task total measured against `baselineCommit`. */
    export function publish(baselineCommit: string, totals: QaapTaskDiffTotals): void {
        liveTotals.set(baselineCommit, { added: totals.added, removed: totals.removed });
    }

    /** Sums the line counts of a changed-file list (each file already carries its own counts). */
    export function sum(files: ReadonlyArray<{ readonly adds: number; readonly dels: number }>): QaapTaskDiffTotals {
        return files.reduce((total, file) => ({ added: total.added + file.adds, removed: total.removed + file.dels }), { added: 0, removed: 0 });
    }

    /**
     * The task total to show: the live total for the summary's baseline when one was published, otherwise
     * the total stored at the last turn settle (zeros when neither exists).
     */
    export function resolve(summary: QaapTaskDiffSummaryLike | undefined): QaapTaskDiffTotals {
        const live = summary?.baselineCommit ? liveTotals.get(summary.baselineCommit) : undefined;
        if (live) {
            return live;
        }
        return { added: summary?.linesAdded ?? 0, removed: summary?.linesRemoved ?? 0 };
    }

    /** Test seam: forgets every published total. */
    export function clear(): void {
        liveTotals.clear();
    }
}
