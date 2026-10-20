// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as ipaddr from 'ipaddr.js';

/**
 * Extra ranges `ipaddr.js` 1.x still labels `unicast` but that must never be fetched: IPv4-compatible
 * IPv6 (`::/96`, embeds any IPv4), deprecated site-local (`fec0::/10`), discard-only (`100::/64`),
 * the IETF protocol block (`2001::/23`: Teredo, ORCHID, benchmarking…), documentation (`3fff::/20`)
 * and IPv4 benchmarking (`198.18.0.0/15`).
 */
const EXTRA_BLOCKED_CIDRS: ReadonlyArray<[ipaddr.IPv4 | ipaddr.IPv6, number]> = [
    '::/96', 'fec0::/10', '100::/64', '2001::/23', '2001:db8::/32', '3fff::/20', '198.18.0.0/15',
].map(cidr => ipaddr.parseCIDR(cidr));

/**
 * Allowlist: true unless `ip` is a plain public unicast address. `ipaddr.process` unwraps IPv4-mapped
 * IPv6 (`::ffff:a00:1` → `10.0.0.1`), then anything whose range is not `unicast` (private, loopback,
 * link-local, CGNAT, metadata, multicast, reserved, 6to4, NAT64, Teredo…) is refused, as are the
 * {@link EXTRA_BLOCKED_CIDRS} and anything that is not an IP literal.
 */
export function isQaapBlockedFrameCheckIp(ip: string): boolean {
    let address: ipaddr.IPv4 | ipaddr.IPv6;
    try {
        address = ipaddr.process(ip.replace(/%.*$/, ''));
    } catch {
        return true;
    }
    if (address.range() !== 'unicast') {
        return true;
    }
    return EXTRA_BLOCKED_CIDRS.some(([range, bits]) => matchesCidr(address, range, bits));
}

function matchesCidr(address: ipaddr.IPv4 | ipaddr.IPv6, range: ipaddr.IPv4 | ipaddr.IPv6, bits: number): boolean {
    if (address.kind() === 'ipv4' && range.kind() === 'ipv4') {
        return (address as ipaddr.IPv4).match(range as ipaddr.IPv4, bits);
    }
    if (address.kind() === 'ipv6' && range.kind() === 'ipv6') {
        return (address as ipaddr.IPv6).match(range as ipaddr.IPv6, bits);
    }
    return false;
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

/**
 * True for Qaap's own hosts, which the frame check must never fetch: the public app origin's host
 * and any `*.<previewBaseDomain>` isolated preview host (their `frame-ancestors` names Qaap anyway).
 */
export function isQaapInternalFrameCheckHost(url: URL, appOrigin: string | undefined, previewBaseDomain: string | undefined): boolean {
    const hostname = url.hostname.toLowerCase();
    const baseDomain = previewBaseDomain?.toLowerCase().replace(/:\d+$/, '');
    if (baseDomain && (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`))) {
        return true;
    }
    if (!appOrigin) {
        return false;
    }
    try {
        return new URL(appOrigin).hostname.toLowerCase() === hostname;
    } catch {
        return false;
    }
}

/** Per-key token bucket: `capacity` checks in a burst, refilled at `refillPerSecond`. Bounded by `maxKeys`. */
export class QaapFrameCheckRateLimiter {

    protected readonly buckets = new Map<string, { tokens: number; updated: number }>();

    constructor(
        protected readonly capacity = 20,
        protected readonly refillPerSecond = 0.5,
        protected readonly maxKeys = 1000,
    ) { }

    tryTake(key: string, now = Date.now()): boolean {
        const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
        bucket.tokens = Math.min(this.capacity, bucket.tokens + ((now - bucket.updated) / 1000) * this.refillPerSecond);
        bucket.updated = now;
        this.buckets.delete(key);
        this.buckets.set(key, bucket);
        while (this.buckets.size > this.maxKeys) {
            const oldest = this.buckets.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.buckets.delete(oldest);
        }
        if (bucket.tokens < 1) {
            return false;
        }
        bucket.tokens -= 1;
        return true;
    }
}

/**
 * Non-blocking concurrency cap: at most `perKey` checks per user and `global` in total. `tryAcquire`
 * fails instead of queueing, so one user cannot starve everyone else's checks.
 */
export class QaapFrameCheckConcurrency {

    protected held = 0;
    protected readonly heldByKey = new Map<string, number>();

    constructor(protected readonly global: number, protected readonly perKey: number) { }

    get inUse(): number {
        return this.held;
    }

    tryAcquire(key: string): boolean {
        const mine = this.heldByKey.get(key) ?? 0;
        if (this.held >= this.global || mine >= this.perKey) {
            return false;
        }
        this.held++;
        this.heldByKey.set(key, mine + 1);
        return true;
    }

    release(key: string): void {
        const mine = this.heldByKey.get(key) ?? 0;
        if (mine <= 0) {
            return;
        }
        this.held = Math.max(0, this.held - 1);
        if (mine === 1) {
            this.heldByKey.delete(key);
        } else {
            this.heldByKey.set(key, mine - 1);
        }
    }
}
