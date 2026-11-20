// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * A click on Stop within this window after a send, or after the button turned into Stop, is ignored: the
 * second tap of a quick double tap on Send must never cancel the turn it just started.
 */
export const QAAP_COMPOSER_STOP_CLICK_GUARD_MS = 600;

/** What the composer's send button does now. */
export type QaapComposerSendControl = 'send' | 'stop';

/** The composer state that decides between Send and Stop. */
export interface QaapComposerSendControlState {
    /** A turn of this conversation is running. */
    readonly working: boolean;
    /** The composer holds text or attachments. */
    readonly hasContent: boolean;
    /** A Stop is still unacknowledged: Send waits for it and Stop is not offered again. */
    readonly submitBlocked?: boolean;
    /** That Stop expired while the server still streams: Stop is offered again. */
    readonly stopRetryable?: boolean;
}

/**
 * Send or Stop, as T3 Code does: while a turn runs, a composer with text or attachments sends (the message
 * queues); only an empty composer stops the turn.
 */
export function resolveQaapComposerSendControl(state: QaapComposerSendControlState): QaapComposerSendControl {
    if (!state.working || state.hasContent) {
        return 'send';
    }
    return !state.submitBlocked || state.stopRetryable ? 'stop' : 'send';
}

/**
 * Ignores Stop clicks for {@link QAAP_COMPOSER_STOP_CLICK_GUARD_MS} after a send and after the button turned
 * into Stop. Keyboard interrupts (Cmd/Ctrl+Enter) do not go through it.
 */
export class QaapComposerStopClickGuard {

    protected lastSendAt = Number.NEGATIVE_INFINITY;
    protected stopShownAt = Number.NEGATIVE_INFINITY;
    protected control: QaapComposerSendControl = 'send';

    constructor(protected readonly windowMs: number = QAAP_COMPOSER_STOP_CLICK_GUARD_MS) { }

    /** A message was just sent. */
    noteSend(now: number = Date.now()): void {
        this.lastSendAt = now;
    }

    /** The button now shows `control`; turning into Stop starts the guard window. */
    noteControl(control: QaapComposerSendControl, now: number = Date.now()): void {
        if (control === 'stop' && this.control !== 'stop') {
            this.stopShownAt = now;
        }
        this.control = control;
    }

    /** Whether a Stop click at `now` stops the turn. */
    allowsStop(now: number = Date.now()): boolean {
        return now - Math.max(this.lastSendAt, this.stopShownAt) >= this.windowMs;
    }
}
