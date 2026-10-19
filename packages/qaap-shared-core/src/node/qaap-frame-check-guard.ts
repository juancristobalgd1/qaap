// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as net from 'net';

/**
 * True for loopback, private, link-local, CGNAT, benchmark, multicast, unspecified and cloud-metadata
 * addresses (v4 and v6). IPv6 forms that embed an IPv4 address (mapped `::ffff:a00:1`, compatible,
 * 6to4) are judged by that IPv4 address; NAT64 and Teredo are refused outright since they can reach
 * any IPv4 host. Anything that is not an IP literal is refused.
 */
export function isQaapBlockedFrameCheckIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
        return isBlockedIpv4(ip.split('.').map(Number));
    }
    const hextets = net.isIPv6(ip) ? expandIpv6(ip) : undefined;
    if (!hextets) {
        return true;
    }
    const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;
    const embeddedTail = [h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff];
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0xffff || h5 === 0)) {
        // `::`, `::1`, IPv4-mapped and IPv4-compatible.
        return h5 === 0 && h6 === 0 ? true : isBlockedIpv4(embeddedTail);
    }
    if (h0 === 0x2002) {
        return isBlockedIpv4([h1 >> 8, h1 & 0xff, h2 >> 8, h2 & 0xff]);
    }
    return h0 === 0x64 && h1 === 0xff9b // NAT64
        || h0 === 0x2001 && h1 === 0 // Teredo
        || (h0 & 0xffc0) === 0xfe80 // link-local
        || (h0 & 0xfe00) === 0xfc00 // unique local
        || (h0 & 0xff00) === 0xff00; // multicast
}

function isBlockedIpv4([a, b]: number[]): boolean {
    return a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 0)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19));
}

/** Expands a valid IPv6 literal (optionally with a dotted IPv4 tail) to its eight 16-bit groups. */
function expandIpv6(ip: string): number[] | undefined {
    let text = ip.toLowerCase().replace(/%.*$/, '');
    const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
    if (dotted) {
        const [a, b, c, d] = dotted.slice(1).map(Number);
        text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
    const [head, tail] = text.split('::');
    const left = head ? head.split(':') : [];
    const right = tail !== undefined && tail ? tail.split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0 || (tail === undefined && missing !== 0)) {
        return undefined;
    }
    const groups = [...left, ...new Array<string>(missing).fill('0'), ...right].map(group => parseInt(group, 16));
    return groups.length === 8 && groups.every(group => group >= 0 && group <= 0xffff) ? groups : undefined;
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
