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
 * Plain Enter queues while an agent is working; Shift+Enter is Parallel; Cmd/Ctrl+Enter is Interrupt.
 */
export function resolveComposerEnterDeliveryOverride(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>): QaapComposerDeliveryMode | undefined {
    if (event.key !== 'Enter' || event.altKey) {
        return undefined;
    }
    if (event.shiftKey && !event.metaKey && !event.ctrlKey) {
        return 'parallel';
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

export function shouldBypassLocalFollowUpQueue(mode: QaapComposerDeliveryMode): boolean {
    return mode === 'parallel' || mode === 'interrupt';
}
