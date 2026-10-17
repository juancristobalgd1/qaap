import assert from 'node:assert/strict';
import test from 'node:test';
import { paginate } from '../src/paginate.js';

const ten = Array.from({ length: 10 }, (_, index) => index + 1);

test('first page of an evenly divisible list', () => {
    const result = paginate(ten, 1, 5);
    assert.deepEqual(result.items, [1, 2, 3, 4, 5]);
    assert.equal(result.totalPages, 2);
    assert.equal(result.hasNext, true);
    assert.equal(result.hasPrev, false);
});

test('last page of an evenly divisible list', () => {
    const result = paginate(ten, 2, 5);
    assert.deepEqual(result.items, [6, 7, 8, 9, 10]);
    assert.equal(result.hasNext, false);
    assert.equal(result.hasPrev, true);
});
