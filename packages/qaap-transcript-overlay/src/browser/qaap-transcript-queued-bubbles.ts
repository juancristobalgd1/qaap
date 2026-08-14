// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { TranscriptFollowUpEntry } from '../common/qaap-transcript-follow-up-queue';

export const TRANSCRIPT_QUEUED_BUBBLES_CLASS = 'theia-mobile-agent-transcript-queued';

/**
 * Queued follow-ups are shown as a draggable list above the composer.
 * They are NOT duplicated as user bubbles inside the transcript anymore — the queue
 * container is the single source of truth for pending messages.
 *
 * This function is kept as a cleanup hook: it removes any stale queued-bubble
 * container left in the transcript scroller from previous renders and never
 * paints new ones. Callers still invoke it on every composer refresh so legacy
 * DOM is swept away cleanly.
 */
export function buildTranscriptQueuedBubblesFingerprint(
    _entries: readonly TranscriptFollowUpEntry[],
): string {
    return '';
}

/**
 * The scroller that owns the message rows. Callers hand over whatever "chat host" they hold —
 * the scroller itself, the real-chat wrapper, or the inline execution wrapper above it (the
 * Agents Hub inline shell passes that one) — so the lookup searches downwards at any depth.
 */
function resolveQueuedBubblesScroller(node: HTMLElement): HTMLElement | undefined {
    if (node.classList.contains('theia-mobile-agent-transcript')) {
        return node;
    }
    const scroller = node.querySelector('.theia-mobile-agent-transcript');
    return scroller instanceof HTMLElement ? scroller : undefined;
}

/**
 * Removes any queued-bubble container from the transcript scroller.
 *
 * Queued messages are surfaced exclusively by the composer queue list above the
 * input; the transcript no longer duplicates them as "Queued" user bubbles.
 */
export function syncTranscriptQueuedBubbles(
    host: HTMLElement | undefined,
    _entries: readonly TranscriptFollowUpEntry[],
): HTMLElement | undefined {
    if (!host?.isConnected) {
        return undefined;
    }
    const scroller = resolveQueuedBubblesScroller(host);
    if (!scroller) {
        return undefined;
    }
    scroller.querySelector(`:scope > .${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`)?.remove();
    return undefined;
}
