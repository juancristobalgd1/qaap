// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { formatEventLoopStallLog, QAAP_LOOP_STALL_LOG_MS } from './qaap-agent-conversation-persist-policy';

/** Period of the stall probe timer. A stall is how much later than this the timer fired. */
export const QAAP_LOOP_PROBE_TICK_MS = 200;

/**
 * Extra time the probe timer fired after its previous tick, beyond the tick period. Zero when the
 * loop was idle enough to fire on time; never negative.
 */
export function measureEventLoopStallMs(previousTickEpochMs: number, nowEpochMs: number, tickMs: number): number {
    return Math.max(0, nowEpochMs - previousTickEpochMs - tickMs);
}

let loopStallMonitorStarted = false;

/**
 * Starts one process-wide probe that logs `[qaap-loop]` whenever the event loop is blocked for at
 * least `QAAP_LOOP_STALL_LOG_MS`. Idempotent; the timer is unref'd so it never keeps the process alive.
 */
export function ensureQaapLoopStallMonitor(): void {
    if (loopStallMonitorStarted) {
        return;
    }
    loopStallMonitorStarted = true;
    let previousTickEpochMs = Date.now();
    const timer = setInterval(() => {
        const nowEpochMs = Date.now();
        const stallMs = measureEventLoopStallMs(previousTickEpochMs, nowEpochMs, QAAP_LOOP_PROBE_TICK_MS);
        if (stallMs >= QAAP_LOOP_STALL_LOG_MS) {
            console.warn(formatEventLoopStallLog(previousTickEpochMs, stallMs));
        }
        previousTickEpochMs = nowEpochMs;
    }, QAAP_LOOP_PROBE_TICK_MS);
    timer.unref();
}
