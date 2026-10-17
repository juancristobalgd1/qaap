import { assert, oracle } from './_lib.mjs';

await oracle(process.argv[2], async ({ load }) => {
    const { LRUCache } = await load('src/lru-cache.js');
    let clock = 1000;
    const now = () => clock;

    // Default TTL.
    let cache = new LRUCache(3, { ttlMs: 100, now });
    cache.set('a', 1);
    clock = 1099;
    assert.equal(cache.get('a'), 1, 'alive just before the deadline');
    clock = 1100;
    assert.equal(cache.has('a'), false, 'expired at the deadline');
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.size, 0, 'expired entries do not count');

    // get() refreshes recency but not the TTL.
    clock = 2000;
    cache = new LRUCache(2, { ttlMs: 100, now });
    cache.set('a', 1);
    clock = 2050;
    cache.get('a');
    clock = 2100;
    assert.equal(cache.has('a'), false, 'reading does not extend the lifetime');

    // set() on an existing key restarts the TTL and replaces the value.
    clock = 3000;
    cache = new LRUCache(2, { ttlMs: 100, now });
    cache.set('a', 1);
    clock = 3080;
    cache.set('a', 2);
    clock = 3150;
    assert.equal(cache.get('a'), 2);

    // Per-entry TTL overrides the default; entries without any TTL never expire.
    clock = 4000;
    cache = new LRUCache(5, { ttlMs: 100, now });
    cache.set('short', 1, { ttlMs: 10 });
    cache.set('default', 2);
    cache.set('long', 3, { ttlMs: 1000 });
    clock = 4050;
    assert.equal(cache.has('short'), false);
    assert.equal(cache.has('default'), true);
    clock = 4500;
    assert.equal(cache.has('default'), false);
    assert.equal(cache.get('long'), 3);
    const plain = new LRUCache(2, { now });
    plain.set('x', 1);
    clock = 99999999;
    assert.equal(plain.get('x'), 1, 'no ttl, no expiry');

    // Eviction prefers expired entries over live LRU ones.
    clock = 5000;
    cache = new LRUCache(2, { now });
    cache.set('old', 1, { ttlMs: 10 });
    cache.set('live', 2);
    clock = 5020;
    cache.set('new', 3);
    assert.equal(cache.has('live'), true, 'the expired entry is dropped first');
    assert.equal(cache.has('new'), true);
    assert.equal(cache.size, 2);

    // has() must not change recency.
    clock = 6000;
    cache = new LRUCache(2, { now });
    cache.set('a', 1).set('b', 2);
    cache.has('a');
    cache.set('c', 3);
    assert.equal(cache.has('a'), false, 'has() does not refresh recency');

    // Validation and backwards compatibility.
    assert.throws(() => new LRUCache(2, { ttlMs: 0 }), { name: 'RangeError', message: 'ttlMs must be a positive number' });
    assert.throws(() => new LRUCache(2, { ttlMs: -5 }), RangeError);
    assert.throws(() => cache.set('k', 1, { ttlMs: Number.NaN }), RangeError);
    const legacy = new LRUCache(1);
    legacy.set('a', 1).set('b', 2);
    assert.equal(legacy.has('a'), false);
    assert.equal(legacy.get('b'), 2);
});
