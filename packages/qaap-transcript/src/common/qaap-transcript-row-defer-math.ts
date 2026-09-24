// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface TranscriptRowDeferContext {
    readonly messageIndex: number;
    readonly messageCount: number;
    readonly conversationStreaming: boolean;
}

/**
 * How many rows at the tail always paint in full.
 *
 * The tail pair (last user turn + the answer under it) is what the viewport shows during a
 * turn and immediately after it ends, so it must never be deferred.
 */
export const TRANSCRIPT_EAGER_TAIL_ROWS = 2;

/**
 * Historical rows defer heavy paint; the rows the reader is actually looking at never do.
 *
 * Deferring replaces a row's content with a ~180-char excerpt until an idle callback hydrates
 * it. Keying that on `conversationStreaming` meant the answer stopped being exempt the instant
 * the turn finished: the next full render collapsed a fully painted answer to the excerpt and
 * sprang back on hydration — the transcript visibly blinked and the scroll jumped at the end of
 * every turn. Distance from the tail is the honest signal for "is this on screen"; the
 * streaming flag is deliberately not consulted.
 */
export function shouldDeferTranscriptRowHeavyContent(ctx: TranscriptRowDeferContext): boolean {
    return ctx.messageCount - 1 - ctx.messageIndex >= TRANSCRIPT_EAGER_TAIL_ROWS;
}
