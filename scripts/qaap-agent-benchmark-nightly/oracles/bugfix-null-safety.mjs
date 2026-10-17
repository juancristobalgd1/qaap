import { assert, oracle } from './_lib.mjs';

await oracle(process.argv[2], async ({ load }) => {
    const { displayName, formatAddress, averageRating } = await load('src/profile.js');

    assert.equal(displayName({ email: 'bob@example.com' }), 'bob', 'missing profile');
    assert.equal(displayName({ email: 'bob@example.com', profile: {} }), 'bob', 'missing name');
    assert.equal(displayName({ email: 'bob@example.com', profile: { name: '   ' } }), 'bob', 'blank name');
    assert.equal(displayName({ profile: { name: 'Eve' } }), 'Eve');
    assert.equal(displayName({}), 'Anonymous');
    assert.equal(displayName(null), 'Anonymous');
    assert.equal(displayName(undefined), 'Anonymous');

    assert.equal(formatAddress({}), '');
    assert.equal(formatAddress({ profile: {} }), '');
    assert.equal(formatAddress({ profile: { address: null } }), '');
    assert.equal(formatAddress(null), '');
    assert.equal(formatAddress({ profile: { address: { street: '2 Side Rd', city: 'Paris' } } }), '2 Side Rd, Paris');
    assert.equal(formatAddress({ profile: { address: { city: 'Rome', zip: '00100' } } }), 'Rome 00100');
    assert.equal(formatAddress({ profile: { address: { street: '1 Main St', city: 'London', zip: 'N1' } } }),
        '1 Main St, London N1');

    assert.equal(averageRating([]), 0);
    assert.equal(averageRating(null), 0);
    assert.equal(averageRating(undefined), 0);
    assert.equal(averageRating([{ rating: 4 }, { rating: undefined }, null, { rating: 2 }]), 3);
    assert.equal(averageRating([{ rating: Number.NaN }]), 0);
});
