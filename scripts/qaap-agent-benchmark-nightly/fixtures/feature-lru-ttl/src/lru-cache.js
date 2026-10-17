/** Least-recently-used cache with a fixed capacity. */
export class LRUCache {
    constructor(capacity) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError('capacity must be a positive integer');
        }
        this.capacity = capacity;
        this.entries = new Map();
    }

    get size() {
        return this.entries.size;
    }

    has(key) {
        return this.entries.has(key);
    }

    /** Returns the value and marks the key as most recently used. */
    get(key) {
        if (!this.entries.has(key)) {
            return undefined;
        }
        const value = this.entries.get(key);
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    set(key, value) {
        this.entries.delete(key);
        this.entries.set(key, value);
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
