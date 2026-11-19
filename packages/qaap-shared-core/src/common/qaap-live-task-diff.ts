// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { QaapElementBoundDisposables } from './qaap-element-bound-disposables';

/** Line totals of a whole task, measured against its baseline commit. */
export interface QaapTaskDiffTotals {
    readonly added: number;
    readonly removed: number;
}

/** A published task total: the totals for one baseline commit. */
export interface QaapTaskDiffChange extends QaapTaskDiffTotals {
    readonly baselineCommit: string;
}

/** The summary fields that carry a task's totals. */
export interface QaapTaskDiffSummaryLike {
    readonly baselineCommit?: string;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
}

/** What {@link QaapLiveTaskDiff.bindTotals} needs from a rendered element: only whether it is still in the DOM. */
export interface QaapTaskDiffBoundElement {
    readonly isConnected: boolean;
}

/**
 * Latest live task totals, keyed by task baseline commit. A live read of the review endpoint (the
 * Changes panel) publishes here so the chat pill and the Work Hub rows show the same number as the
 * panel instead of the total frozen when the turn settled. Frontend memory only: a reload falls back
 * to the settled value until the panel is read again.
 */
const liveTotals = new Map<string, QaapTaskDiffTotals>();
const changeEmitter = new Emitter<QaapTaskDiffChange>();
const boundElements = new QaapElementBoundDisposables();

export namespace QaapLiveTaskDiff {
    /** Fires when a published total differs from the one it replaces. */
    export const onDidChange: Event<QaapTaskDiffChange> = changeEmitter.event;

    /** Records the live task total measured against `baselineCommit`; fires {@link onDidChange} only when it changed. */
    export function publish(baselineCommit: string, totals: QaapTaskDiffTotals): void {
        const previous = liveTotals.get(baselineCommit);
        const next = { added: totals.added, removed: totals.removed };
        liveTotals.set(baselineCommit, next);
        if (!previous || previous.added !== next.added || previous.removed !== next.removed) {
            changeEmitter.fire({ baselineCommit, ...next });
        }
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

    /**
     * Keeps `render` in step with the live total of `baselineCommit` for as long as `element` is in the DOM.
     * The subscription releases itself the first time an update finds the element detached, so a row or
     * pill that is re-rendered (its old elements removed) does not keep listening. Dispose the result to release it earlier.
     */
    export function bindTotals(element: QaapTaskDiffBoundElement, baselineCommit: string | undefined, render: (totals: QaapTaskDiffTotals) => void): Disposable {
        if (!baselineCommit) {
            return Disposable.NULL;
        }
        const subscription = onDidChange(change => {
            if (change.baselineCommit !== baselineCommit) {
                return;
            }
            if (!element.isConnected) {
                subscription.dispose();
                return;
            }
            render({ added: change.added, removed: change.removed });
        });
        // A total that never changes never fires the check above: also release detached bindings when new ones are made.
        return boundElements.add(element, subscription);
    }

    /** Test seam: live subscriptions held for rendered elements. */
    export function boundElementCount(): number {
        return boundElements.size;
    }

    /** Test seam: forgets every published total. */
    export function clear(): void {
        liveTotals.clear();
    }
}
