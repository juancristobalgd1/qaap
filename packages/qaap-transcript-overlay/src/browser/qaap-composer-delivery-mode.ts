// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** How to deliver a follow-up while an agent is already working. */
export type QaapComposerDeliveryMode = 'queue' | 'parallel' | 'interrupt';

export const QAAP_DEFAULT_COMPOSER_DELIVERY_MODE: QaapComposerDeliveryMode = 'queue';

export function isQaapComposerDeliveryMode(value: unknown): value is QaapComposerDeliveryMode {
    return value === 'queue' || value === 'parallel' || value === 'interrupt';
}

/**
 * One-shot override from a composer Enter keydown.
 * - Plain Enter: submit (queues on the server while an agent is working).
 * - Shift+Enter: newline (no delivery override — caller must not preventDefault).
 * - Alt+Enter: Parallel (isolated worktree conversation).
 * - Cmd/Ctrl+Enter: Interrupt the live turn, then send.
 */
export function resolveComposerEnterDeliveryOverride(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>): QaapComposerDeliveryMode | undefined {
    if (event.key !== 'Enter') {
        return undefined;
    }
    if (event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        return 'parallel';
    }
    if (event.shiftKey && !event.metaKey && !event.ctrlKey) {
        // Native newline — do not treat as a delivery mode.
        return undefined;
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
        return 'interrupt';
    }
    return undefined;
}

export function resolveBusyFollowUpDeliveryMode(options: {
    readonly forceDeliveryMode?: QaapComposerDeliveryMode;
}): QaapComposerDeliveryMode {
    return options.forceDeliveryMode ?? QAAP_DEFAULT_COMPOSER_DELIVERY_MODE;
}

/**
 * Always POST to the backend (including `'queue'`). The local in-memory follow-up
 * queue is only a fallback when the server rejects/errors — Cursor-style same-session
 * multitask requires durable `pendingUserMessages` on the conversation.
 */
export function shouldBypassLocalFollowUpQueue(_mode: QaapComposerDeliveryMode): boolean {
    return true;
}
