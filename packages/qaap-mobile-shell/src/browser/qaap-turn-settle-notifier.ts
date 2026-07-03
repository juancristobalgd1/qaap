// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/** Terminal state of a background agent turn, as observable from the conversation summary layer. */
export type QaapTurnSettleOutcome = 'completed' | 'failed' | 'stopped';

export interface QaapTurnSettleNotifyOptions {
    /** Conversation title (already summarized) — used verbatim as the notification title. */
    readonly title: string;
    readonly outcome: QaapTurnSettleOutcome;
    /** Invoked (in addition to focusing the window) when the user clicks the notification. */
    readonly onActivate?: () => void;
}

/**
 * Fires a Web Notification when a background agent turn settles while the tab is hidden, so a user
 * who switched away during a long-running turn (these can take 3-19 minutes) is pulled back.
 *
 * Deliberately lightweight and host-instantiated (like the sibling `MobileProjectsTranscript*Ui`
 * helpers in this package) rather than DI-bound: each caller that needs it constructs its own
 * instance, and the only state worth sharing per instance is the per-conversation dedupe set below.
 */
export class QaapTurnSettleNotifier {

    /** Conversation ids already notified this session — a turn is only ever announced once. */
    protected readonly notifiedConversationIds = new Set<string>();

    /**
     * Announce that a conversation's turn has settled. No-ops unless the document is hidden, the
     * Notification API is available and permission has already been granted, and this conversation
     * has not already been announced this session.
     */
    notifyTurnSettled(conversationId: string, options: QaapTurnSettleNotifyOptions): void {
        if (this.notifiedConversationIds.has(conversationId)) {
            return;
        }
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
            return;
        }
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return;
        }
        this.notifiedConversationIds.add(conversationId);
        try {
            const notification = new Notification(options.title, {
                body: resolveTurnSettleBody(options.outcome),
                tag: `qaap-turn-settle-${conversationId}`,
            });
            notification.onclick = (): void => {
                try {
                    window.focus();
                } catch {
                    /* window.focus can throw/no-op depending on the embedding context */
                }
                options.onActivate?.();
                notification.close();
            };
        } catch {
            /* Notification constructor can throw in restricted contexts (e.g. iOS home-screen webapps) */
        }
    }

    /**
     * Requests Notification permission, but only at a moment tied to user intent (the composer
     * submit path is the natural one — starting a task is consent to be told when it finishes) and
     * only while permission is still `'default'`. Never re-prompts once the user has answered:
     * a `'denied'` result is enforced by the browser itself, and requesting again would just nag.
     */
    async maybeRequestPermission(): Promise<void> {
        if (typeof Notification === 'undefined' || Notification.permission !== 'default') {
            return;
        }
        try {
            await Notification.requestPermission();
        } catch {
            /* user dismissed the prompt, or a restricted context rejected it */
        }
    }
}

function resolveTurnSettleBody(outcome: QaapTurnSettleOutcome): string {
    switch (outcome) {
        case 'failed':
            return nls.localize('qaap/turnSettle/taskFailed', 'Task failed');
        case 'stopped':
            return nls.localize('qaap/turnSettle/taskStopped', 'Task stopped');
        case 'completed':
        default:
            return nls.localize('qaap/turnSettle/taskCompleted', 'Task completed');
    }
}
