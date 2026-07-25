// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { TranscriptFollowUpEntry } from '../common/qaap-transcript-follow-up-queue';

export const TRANSCRIPT_QUEUED_BUBBLES_CLASS = 'theia-mobile-agent-transcript-queued';

/**
 * Queued follow-ups painted as real user bubbles at the tail of the transcript, so a message
 * sent while the agent is working is visibly "sent" instead of only living as a row in the
 * composer queue popover. They are chrome, not conversation data: they live outside the
 * message-render pipeline (which owns fingerprints, patching and virtual scrolling) and are
 * re-synced from the queue, so an entry that flushes into the real turn simply stops being
 * painted here once the submit path takes over with its own optimistic bubble.
 */
export function buildTranscriptQueuedBubblesFingerprint(
    entries: readonly TranscriptFollowUpEntry[],
): string {
    return entries.map(entry => entry.draft).join('\x00');
}

function createQueuedBubble(entry: TranscriptFollowUpEntry): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'theia-mobile-agent-transcript-user-wrap theia-mod-queued';

    const bubble = document.createElement('div');
    bubble.className = 'theia-mobile-agent-transcript-msg theia-mod-user theia-mod-queued';

    const content = document.createElement('div');
    content.className = 'theia-mobile-agent-transcript-content';
    content.textContent = entry.draft;

    const tag = document.createElement('span');
    tag.className = 'theia-mobile-agent-transcript-queued-tag';
    tag.textContent = nls.localize('qaap/mobileProjects/transcriptQueuedBubbleTag', 'Queued');

    bubble.append(content, tag);
    wrap.append(bubble);
    return wrap;
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
 * Mounts (or updates, or removes) the queued bubbles at the transcript tail.
 *
 * They are inserted BEFORE the live-status row rather than appended last: live-status re-claims
 * the last-child slot on every tick via `ensureTranscriptLiveStatusAtScrollerTail`, so competing
 * for it would move both nodes on every SSE tick. Sitting just above it is a stable fixed point.
 */
export function syncTranscriptQueuedBubbles(
    host: HTMLElement | undefined,
    entries: readonly TranscriptFollowUpEntry[],
): HTMLElement | undefined {
    if (!host?.isConnected) {
        return undefined;
    }
    const scroller = resolveQueuedBubblesScroller(host);
    if (!scroller) {
        return undefined;
    }
    const existing = scroller.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_QUEUED_BUBBLES_CLASS}`);
    if (!entries.length) {
        existing?.remove();
        return undefined;
    }
    const fingerprint = buildTranscriptQueuedBubblesFingerprint(entries);
    let container = existing;
    if (container) {
        if (container.dataset.qaapQueuedFingerprint !== fingerprint) {
            container.replaceChildren(...entries.map(entry => createQueuedBubble(entry)));
            container.dataset.qaapQueuedFingerprint = fingerprint;
        }
    } else {
        container = document.createElement('div');
        container.className = TRANSCRIPT_QUEUED_BUBBLES_CLASS;
        container.append(...entries.map(entry => createQueuedBubble(entry)));
        container.dataset.qaapQueuedFingerprint = fingerprint;
    }
    const liveStatus = scroller.querySelector(':scope > .theia-mobile-agent-live-status');
    if (liveStatus) {
        if (container.nextElementSibling !== liveStatus) {
            scroller.insertBefore(container, liveStatus);
        }
    } else if (scroller.lastElementChild !== container) {
        scroller.append(container);
    }
    return container;
}
