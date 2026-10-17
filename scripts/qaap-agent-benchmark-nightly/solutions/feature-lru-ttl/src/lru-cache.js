export class LRUCache {
    constructor(capacity, { ttlMs, now = Date.now } = {}) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError('capacity must be a positive integer');
        }
        this.capacity = capacity;
        this.defaultTtlMs = LRUCache.checkTtl(ttlMs);
        this.now = now;
        this.entries = new Map();
    }

    static checkTtl(ttlMs) {
        if (ttlMs !== undefined && !(typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0)) {
            throw new RangeError('ttlMs must be a positive number');
        }
        return ttlMs;
    }

    purge() {
        const now = this.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
                this.entries.delete(key);
            }
        }
    }

    get size() {
        this.purge();
        return this.entries.size;
    }

    live(key) {
        const entry = this.entries.get(key);
        if (entry && entry.expiresAt !== undefined && this.now() >= entry.expiresAt) {
            this.entries.delete(key);
            return undefined;
        }
        return entry;
    }

    has(key) {
        return this.live(key) !== undefined;
    }

    get(key) {
        const entry = this.live(key);
        if (!entry) {
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key, value, options = {}) {
        const ttlMs = LRUCache.checkTtl(options.ttlMs) ?? this.defaultTtlMs;
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: ttlMs === undefined ? undefined : this.now() + ttlMs });
        if (this.entries.size > this.capacity) {
            this.purge();
        }
        if (this.entries.size > this.capacity) {
            this.entries.delete(this.entries.keys().next().value);
        }
        return this;
    }

    delete(key) {
        return this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }
}
