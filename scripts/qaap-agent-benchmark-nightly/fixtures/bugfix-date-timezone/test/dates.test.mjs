import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, daysBetween, parseDate, toDateKey } from '../src/dates.js';

test('round-trips a day key', () => {
    assert.equal(toDateKey(parseDate('2024-03-10')), '2024-03-10');
});

test('adds days across a month boundary', () => {
    assert.equal(addDays('2024-01-30', 3), '2024-02-02');
    assert.equal(addDays('2024-03-01', -1), '2024-02-29');
});

test('counts days between keys', () => {
    assert.equal(daysBetween('2024-03-01', '2024-03-31'), 30);
    assert.equal(daysBetween('2024-03-31', '2024-03-01'), -30);
});
