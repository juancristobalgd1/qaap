// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_PUSH_OWNER_RATE_LIMIT_PER_MINUTE = 30;
const WINDOW_MS = 60_000;

/** Sliding one-minute window of accepted push notifications per owner. */
export class QaapPushOwnerRateLimit {

    protected readonly accepted = new Map<string, number[]>();

    constructor(protected readonly limit: number = QAAP_PUSH_OWNER_RATE_LIMIT_PER_MINUTE) { }

    /** Records one notification for `owner` when the window has room; `false` means it must be dropped. */
    tryAcquire(owner: string, now = Date.now()): boolean {
        const recent = (this.accepted.get(owner) ?? []).filter(at => now - at < WINDOW_MS);
        const allowed = recent.length < this.limit;
        if (allowed) {
            recent.push(now);
        }
        if (recent.length > 0) {
            this.accepted.set(owner, recent);
        } else {
            this.accepted.delete(owner);
        }
        return allowed;
    }
}
