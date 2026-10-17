import assert from 'node:assert/strict';
import test from 'node:test';
import { averageRating, displayName, formatAddress } from '../src/profile.js';

const user = {
    email: 'ada@example.com',
    profile: { name: 'Ada Lovelace', address: { street: '1 Main St', city: 'London', zip: 'N1' } },
};

test('uses the profile name', () => {
    assert.equal(displayName(user), 'Ada Lovelace');
});

test('formats a complete address', () => {
    assert.equal(formatAddress(user), '1 Main St, London N1');
});

test('averages ratings', () => {
    assert.equal(averageRating([{ rating: 4 }, { rating: 5 }]), 4.5);
});
