// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Small FIFO permit pool for browser work that must not fan out without a bound. */
export class QaapAsyncConcurrencyLimiter {
    protected active = 0;
    protected readonly waiters: Array<() => void> = [];

    constructor(protected readonly limit: number) {
        if (!Number.isInteger(limit) || limit < 1) {
            throw new Error('Concurrency limit must be a positive integer.');
        }
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            this.release();
        }
    }

    protected async acquire(): Promise<void> {
        if (this.active < this.limit) {
            this.active++;
            return;
        }
        await new Promise<void>(resolve => this.waiters.push(resolve));
    }

    protected release(): void {
        const next = this.waiters.shift();
        if (next) {
            next();
            return;
        }
        this.active--;
    }
}
