import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsv, toCsv } from '../src/csv.js';

test('serializes plain rows', () => {
    assert.equal(toCsv([['a', 'b'], ['c', 'd']]), 'a,b\nc,d\n');
});

test('parses plain rows', () => {
    assert.deepEqual(parseCsv('a,b\nc,d\n'), [['a', 'b'], ['c', 'd']]);
});

test('keeps empty fields', () => {
    assert.deepEqual(parseCsv('a,,c\n'), [['a', '', 'c']]);
});
