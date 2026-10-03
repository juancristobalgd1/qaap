// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Bounded exponential backoff with ±20% jitter to spread reconnect bursts. */
export function resolveQaapRetryBackoffDelayMs(
    attempt: number,
    options: { readonly baseDelayMs?: number; readonly maxDelayMs?: number; readonly random?: () => number } = {},
): number {
    const baseDelayMs = Math.max(1, options.baseDelayMs ?? 500);
    const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 30_000);
    const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt)));
    const jitter = 0.8 + ((options.random ?? Math.random)() * 0.4);
    return Math.max(1, Math.min(maxDelayMs, Math.round(exponentialDelay * jitter)));
}
