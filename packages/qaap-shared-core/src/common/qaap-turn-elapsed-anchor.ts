// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Elapsed time shown for an in-flight agent turn ("Starting the agent… 9m 35s", the Work Hub
 * "ran" column). Surfaces used to read different clocks: the transcript used the last user
 * message timestamp, the Work Hub the server's `turnStartedAt`. A relaunch (Task restarted /
 * retry) moved one of them back, so the counter could show 12m 49s and a minute later 9m 35s.
 *
 * The anchor is the earliest start seen for the conversation while it is streaming. A later
 * start (a relaunch) therefore never moves the clock back, and the anchor is dropped as soon
 * as the conversation is observed idle so the next turn starts from zero.
 */
export class TurnElapsedAnchor {
    protected readonly anchors = new Map<string, number>();

    /**
     * @param conversationId conversation whose turn is being timed
     * @param turnStartMs start of the current attempt (last user message or `turnStartedAt`)
     * @param streaming whether the conversation is currently in flight
     * @param now current time in epoch milliseconds
     * @returns elapsed milliseconds since the anchor, or `undefined` when there is no active turn
     */
    resolveElapsedMs(conversationId: string, turnStartMs: number | undefined, streaming: boolean, now: number = Date.now()): number | undefined {
        if (!streaming || turnStartMs === undefined) {
            this.anchors.delete(conversationId);
            return undefined;
        }
        const previous = this.anchors.get(conversationId);
        const anchor = previous === undefined ? turnStartMs : Math.min(previous, turnStartMs);
        this.anchors.set(conversationId, anchor);
        return Math.max(0, now - anchor);
    }

    /** Forget a conversation (e.g. when its transcript is closed). */
    forget(conversationId: string): void {
        this.anchors.delete(conversationId);
    }
}

/** Shared instance so every surface that times a turn reads the same anchor. */
export const turnElapsedAnchor = new TurnElapsedAnchor();
