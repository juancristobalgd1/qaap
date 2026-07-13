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
    // The window that scheduled the interval. Captured from the element's own
    // document rather than read off the global `window` inside the callback: in
    // tests the global jsdom window is torn down between specs while this interval
    // is still pending, so a global `window.clearInterval` lookup at teardown would
    // throw `window is not defined`. Holding the scheduling view keeps the timer
    // stoppable without touching the (possibly deleted) global.
    protected timerView: (Window & typeof globalThis) | undefined;

    constructor(protected readonly intervalMs: number = 500) { }

    register(target: ElapsedTickTarget): void {
        this.targets.set(target.element, target);
        target.render(Date.now());
        if (this.timerId === undefined) {
            const view = (target.element.ownerDocument?.defaultView
                ?? (typeof window !== 'undefined' ? window : undefined)) as (Window & typeof globalThis) | undefined;
            if (view) {
                this.timerView = view;
                this.timerId = view.setInterval(this.tick, this.intervalMs);
            }
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
            this.timerView?.clearInterval(this.timerId);
            this.timerId = undefined;
            this.timerView = undefined;
        }
    }
}

export const sharedElapsedTicker = new QaapSharedElapsedTicker();

// Shared 1s-cadence ticker for consumers that only need a coarser tick (e.g.
// stream-meta "elapsed · tokens" chips), avoiding a dedicated per-row
// `setInterval` for each one.
export const sharedSecondTicker = new QaapSharedElapsedTicker(1000);
