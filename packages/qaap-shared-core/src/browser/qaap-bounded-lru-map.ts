// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * A `Map` that never holds more than `limit` entries, evicting the least-recently-used key when it
 * would overflow. Reads (`get`) and writes (`set`) both mark the key as most-recently-used, relying
 * on `Map`'s insertion-order iteration. It is a drop-in `Map` so existing `get`/`set`/`delete`/`has`
 * call sites need no changes — the only added behaviour is bounded growth.
 *
 * Use for frontend caches whose keyspace grows with user activity over a long-lived tab (e.g. one
 * full conversation DTO per opened conversation), where unbounded retention is a slow memory leak.
 *
 * WARNING: `get()` mutates insertion order (the LRU touch), so never iterate this map (`forEach`,
 * `keys`/`values`/`entries`, spread) while also calling `get()` — read a snapshot array first. All
 * current callers only use `get`/`set`/`delete`/`has`, which is why this is safe today.
 */
export class QaapBoundedLruMap<K, V> extends Map<K, V> {
    constructor(protected readonly limit: number, entries?: ReadonlyArray<readonly [K, V]>) {
        super(entries);
        while (this.size > limit) {
            const oldest = this.keys().next().value as K;
            this.delete(oldest);
        }
    }

    override get(key: K): V | undefined {
        if (!super.has(key)) {
            return undefined;
        }
        const value = super.get(key)!;
        // Touch: re-insert so this key becomes most-recently-used in insertion order.
        super.delete(key);
        super.set(key, value);
        return value;
    }

    override set(key: K, value: V): this {
        super.delete(key);
        super.set(key, value);
        while (this.size > this.limit) {
            const oldest = this.keys().next().value as K;
            if (oldest === key) {
                break;
            }
            super.delete(oldest);
        }
        return this;
    }
}
