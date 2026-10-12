// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as net from 'net';

/** True for loopback, private, link-local, CGNAT, multicast, unspecified and cloud-metadata addresses (v4 and v6). */
export function isQaapBlockedFrameCheckIp(ip: string): boolean {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    const address = mapped ? mapped[1] : ip;
    if (net.isIPv4(address)) {
        const [a, b] = address.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168);
    }
    if (net.isIPv6(address)) {
        const h = address.toLowerCase();
        return h === '::' || h === '::1' || /^fe[89ab]/.test(h) || /^f[cdf]/.test(h);
    }
    return true;
}

/** Bounded insertion-ordered cache with a TTL; the oldest entry is evicted past `maxEntries`. */
export class QaapFrameCheckCache<T> {

    protected readonly entries = new Map<string, { readonly value: T; readonly expires: number }>();

    constructor(protected readonly maxEntries = 500, protected readonly ttlMs = 10 * 60 * 1000) { }

    get size(): number {
        return this.entries.size;
    }

    get(key: string, now = Date.now()): T | undefined {
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }
        if (entry.expires <= now) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key: string, value: T, now = Date.now()): void {
        this.entries.delete(key);
        this.entries.set(key, { value, expires: now + this.ttlMs });
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.entries.delete(oldest);
        }
    }
}
