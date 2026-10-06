// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Work Hub reads that the login gate (`qaap-product/resources/qaap-login-gate.js`) starts together
 * with bundle.js once the session is confirmed. Without it the frontend only issues them after all
 * its modules are loaded, 7-12 s into a cold load, and "Loading session history…" waits that long.
 */
interface QaapBootPrefetchEntry {
    readonly startedAt: number;
    readonly response: Promise<Response>;
}

interface QaapBootPrefetchHost {
    __qaapBootPrefetch?: Record<string, QaapBootPrefetchEntry | undefined>;
}

/** An older prefetch may predate a sign-out or an edit made in another tab; read again instead. */
export const QAAP_BOOT_PREFETCH_MAX_AGE_MS = 60_000;

/**
 * The boot response for `path`, at most once and only while fresh. Resolves `undefined` when there
 * is none, it failed, it is not `ok` (the caller's own read handles 401s and transient gateway
 * retries), or it is not complete within `timeoutMs` of when the gate started it. The body is
 * buffered so callers parse it like any other bounded read.
 */
export async function takeQaapBootPrefetch(path: string, timeoutMs: number): Promise<Response | undefined> {
    const entries = (globalThis as QaapBootPrefetchHost).__qaapBootPrefetch;
    const entry = entries?.[path];
    if (!entries || !entry) {
        return undefined;
    }
    entries[path] = undefined;
    const remainingMs = entry.startedAt + timeoutMs - Date.now();
    if (Date.now() - entry.startedAt > QAAP_BOOT_PREFETCH_MAX_AGE_MS || remainingMs <= 0) {
        return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), remainingMs);
    });
    const buffered = entry.response.then(async response => {
        if (!response.ok) {
            return undefined;
        }
        return new Response(await response.arrayBuffer(), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    });
    try {
        return await Promise.race([buffered.catch(() => undefined), expired]);
    } finally {
        clearTimeout(timer);
    }
}
