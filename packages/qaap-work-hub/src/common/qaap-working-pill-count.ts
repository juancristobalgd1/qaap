// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Inputs that decide what a single "N Working" pill displays. */
export interface WorkingPillDisplayCountInput {
    /** Live working agents in the pill's scope (global hub, or one conversation section). */
    readonly liveCount: number;
    /** Stop All was pressed and no new live agent appeared yet. */
    readonly suppressedAfterStopAll: boolean;
    /** The user has this pill's Working expand open for reading (list or detail). */
    readonly reading: boolean;
    /** Empty / new chat surface — the pill never shows there. */
    readonly suppressForEmptyComposer: boolean;
    /** A composer surface that can host the pill is mounted (or the hub home is active). */
    readonly surfaceMounted: boolean;
}

/**
 * Count rendered by one Working pill; `0` hides it. While the user is reading the expand,
 * the pill is kept alive with at least `1` so summary/settled ticks never collapse it.
 */
export function resolveWorkingPillDisplayCount(input: WorkingPillDisplayCountInput): number {
    if (input.suppressForEmptyComposer) {
        return 0;
    }
    const live = input.suppressedAfterStopAll ? 0 : Math.max(0, input.liveCount);
    const reading = input.reading && !input.suppressedAfterStopAll;
    if (live <= 0 && !reading) {
        return 0;
    }
    if (!input.surfaceMounted && !reading) {
        return 0;
    }
    return Math.max(live, reading ? 1 : 0);
}
