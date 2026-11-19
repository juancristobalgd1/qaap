// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';

/** What the registry needs from a rendered element: only whether it is still in the DOM. */
export interface QaapElementBoundDisposablesElement {
    readonly isConnected: boolean;
}

interface QaapElementBoundEntry {
    readonly element: QaapElementBoundDisposablesElement;
    readonly disposable: Disposable;
    readonly boundAt: number;
}

/**
 * Subscriptions tied to the lifetime of a rendered element (a global listener, a shared emitter).
 *
 * Such a subscription used to release itself only when its event next fired and found the element
 * detached. For rare events (model labels arriving, a task total changing) it never fired, so every
 * re-render of a composer or row stayed alive through the global source: the whole detached subtree
 * was retained (about 400 listeners and 1k DOM nodes per conversation switch in the Work Hub).
 * Registering a new subscription now releases the ones whose element has been removed from the DOM.
 * An element gets {@link graceMs} to be attached first, because a subtree is often built offline.
 */
export class QaapElementBoundDisposables {

    protected readonly entries = new Set<QaapElementBoundEntry>();

    constructor(
        protected readonly graceMs: number = 2000,
        protected readonly now: () => number = () => Date.now(),
    ) { }

    /** Number of live subscriptions (test seam). */
    get size(): number {
        return this.entries.size;
    }

    /** Tracks `disposable` for as long as `element` stays in the DOM; the result releases it earlier. */
    add(element: QaapElementBoundDisposablesElement, disposable: Disposable): Disposable {
        this.prune();
        const entry: QaapElementBoundEntry = { element, disposable, boundAt: this.now() };
        this.entries.add(entry);
        return Disposable.create(() => {
            if (this.entries.delete(entry)) {
                disposable.dispose();
            }
        });
    }

    /** Releases every subscription. */
    dispose(): void {
        for (const entry of [...this.entries]) {
            this.entries.delete(entry);
            entry.disposable.dispose();
        }
    }

    /** Releases the subscriptions of elements that are no longer in the DOM. */
    prune(): void {
        const cutoff = this.now() - this.graceMs;
        for (const entry of [...this.entries]) {
            if (!entry.element.isConnected && entry.boundAt <= cutoff) {
                this.entries.delete(entry);
                entry.disposable.dispose();
            }
        }
    }
}
