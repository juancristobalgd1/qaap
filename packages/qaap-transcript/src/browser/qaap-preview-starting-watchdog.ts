// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { PREVIEW_STARTING_STALL_TIMEOUT_MS } from '@theia/qaap-shared-core/lib/common/qaap-transcript-turn-status';

/** The timer surface the watchdog uses: a window in the browser, or a fake in tests. */
export interface PreviewStartingTimers {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

/**
 * Retires a chat "Starting preview…" request that gets neither a preview URL nor a progress event
 * for {@link PREVIEW_STARTING_STALL_TIMEOUT_MS}. While armed, every progress event restarts the
 * window; disarming stops it for good.
 */
export class QaapPreviewStartingWatchdog {
    protected handle: unknown;
    protected armed = false;

    constructor(
        protected readonly timers: PreviewStartingTimers,
        protected readonly onStall: () => void,
        protected readonly timeoutMs: number = PREVIEW_STARTING_STALL_TIMEOUT_MS,
    ) { }

    /** Starts the window from now; a previous window is replaced. */
    arm(): void {
        this.armed = true;
        this.restart();
    }

    /** A progress event: restarts the window when the watchdog is armed, and does nothing otherwise. */
    progress(): void {
        if (this.armed) {
            this.restart();
        }
    }

    /** Stops the window; a stall can no longer fire until the next {@link arm}. */
    disarm(): void {
        this.armed = false;
        this.clear();
    }

    protected restart(): void {
        this.clear();
        this.handle = this.timers.setTimeout(() => {
            this.handle = undefined;
            this.armed = false;
            this.onStall();
        }, this.timeoutMs);
    }

    protected clear(): void {
        if (this.handle !== undefined) {
            this.timers.clearTimeout(this.handle);
            this.handle = undefined;
        }
    }
}
