import assert from 'node:assert/strict';
import test from 'node:test';
import { LRUCache } from '../src/lru-cache.js';

test('evicts the least recently used entry', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1).set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    assert.equal(cache.has('b'), false);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('c'), 3);
    assert.equal(cache.size, 2);
});

test('rejects an invalid capacity', () => {
    assert.throws(() => new LRUCache(0), RangeError);
});

test('delete and clear', () => {
    const cache = new LRUCache(3);
    cache.set('a', 1).set('b', 2);
    assert.equal(cache.delete('a'), true);
    assert.equal(cache.size, 1);
    cache.clear();
    assert.equal(cache.size, 0);
});
