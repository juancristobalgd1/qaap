// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Harness auth probes that may run at the same time (see {@link QaapAgentProbeQueue}). */
export const QAAP_AGENT_PROBE_CONCURRENCY = 2;

/** Schedules `callback` on a later turn of the event loop. */
export type QaapAgentProbeDefer = (callback: () => void) => void;

/**
 * Runs harness auth probes a few at a time and starts at most one per event-loop turn.
 *
 * Each probe spawns a CLI, and forking the tenant backend (over 1 GB resident on 1 CPU) costs about 0.45 s of
 * synchronous `spawn` time. A full catalog refresh re-probed all 7 harnesses in one tick, which held the event
 * loop for 8.3 s on staging (24 Nov 2026). Starting one probe per turn lets timers, sockets and HTTP requests
 * run between the forks; the concurrency cap keeps the probes from piling up behind each other.
 */
export class QaapAgentProbeQueue {

    protected running = 0;
    protected pumpScheduled = false;
    protected readonly pending: Array<() => Promise<void>> = [];

    constructor(
        protected readonly maxConcurrent: number = QAAP_AGENT_PROBE_CONCURRENCY,
        protected readonly defer: QaapAgentProbeDefer = callback => { setImmediate(callback); },
    ) { }

    /** Probes waiting for a slot, not counting the running ones. */
    get queued(): number {
        return this.pending.length;
    }

    /** Runs `task` once a slot is free, on a later event-loop turn; settles like the task. */
    run<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.pending.push(() => {
                let result: Promise<T>;
                try {
                    result = Promise.resolve(task());
                } catch (error) {
                    result = Promise.reject(error);
                }
                return result.then(resolve, reject);
            });
            this.schedulePump();
        });
    }

    protected schedulePump(): void {
        if (this.pumpScheduled) {
            return;
        }
        this.pumpScheduled = true;
        this.defer(() => {
            this.pumpScheduled = false;
            this.pump();
        });
    }

    /** Starts one waiting probe if a slot is free, and asks for another turn when more could start. */
    protected pump(): void {
        if (this.running >= Math.max(1, this.maxConcurrent)) {
            return;
        }
        const next = this.pending.shift();
        if (!next) {
            return;
        }
        this.running++;
        next().finally(() => {
            this.running--;
            this.schedulePump();
        });
        if (this.pending.length > 0) {
            this.schedulePump();
        }
    }
}
