// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Shared elapsed-time ticker ───────────────────────────────────────────────
//
// A single `setInterval` shared by every live "elapsed time" chip in the
// transcript UI, instead of one timer per chip. Targets self-remove once
// their element is disconnected from the DOM, so callers don't need explicit
// teardown beyond calling `unregister` when they stop owning the element.
// ─────────────────────────────────────────────────────────────────────────────

export interface ElapsedTickTarget {
    readonly element: HTMLElement;
    render(nowMs: number): void;
}

export class QaapSharedElapsedTicker {
    protected readonly targets = new Map<HTMLElement, ElapsedTickTarget>();
    protected timerId: number | undefined;

    register(target: ElapsedTickTarget): void {
        this.targets.set(target.element, target);
        target.render(Date.now());
        if (this.timerId === undefined) {
            this.timerId = window.setInterval(this.tick, 500);
        }
    }

    unregister(element: HTMLElement): void {
        this.targets.delete(element);
        if (this.targets.size === 0) {
            this.stop();
        }
    }

    protected readonly tick = (): void => {
        const now = Date.now();
        for (const [element, target] of [...this.targets]) {
            let alive = false;
            try {
                alive = element.isConnected;
            } catch {
                alive = false;
            }
            if (!alive) {
                this.targets.delete(element);
                continue;
            }
            try {
                target.render(now);
            } catch {
                this.targets.delete(element);
            }
        }
        if (this.targets.size === 0) {
            this.stop();
        }
    };

    protected stop(): void {
        if (this.timerId !== undefined) {
            window.clearInterval(this.timerId);
            this.timerId = undefined;
        }
    }
}

export const sharedElapsedTicker = new QaapSharedElapsedTicker();
