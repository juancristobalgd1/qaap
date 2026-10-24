// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Shares one pending promise per key: while `run` for `key` is still in flight, later callers get
 * the same promise instead of issuing a duplicate request. The entry is removed once it settles,
 * so the next call after completion always runs again (no caching of results).
 */
export function dedupeInFlight<T>(inFlight: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) {
        return existing;
    }
    const promise: Promise<T> = run().finally(() => {
        if (inFlight.get(key) === promise) {
            inFlight.delete(key);
        }
    });
    inFlight.set(key, promise);
    return promise;
}
