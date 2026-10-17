import { assert, oracle } from './_lib.mjs';

await oracle(process.argv[2], async ({ load }) => {
    const { paginate } = await load('src/paginate.js');
    const eleven = Array.from({ length: 11 }, (_, index) => index + 1);

    const last = paginate(eleven, 3, 5);
    assert.deepEqual(last.items, [11], 'the partial last page must be returned');
    assert.equal(last.totalPages, 3);
    assert.equal(last.hasNext, false);
    assert.equal(last.hasPrev, true);

    const middle = paginate(eleven, 2, 5);
    assert.deepEqual(middle.items, [6, 7, 8, 9, 10]);
    assert.equal(middle.hasNext, true, 'page 2 of 3 has a next page');

    const beyond = paginate(eleven, 4, 5);
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.hasNext, false);

    assert.equal(paginate([], 1, 5).totalPages, 0);
    assert.equal(paginate([1, 2, 3], 1, 10).totalPages, 1, 'a short list is a single page');
    assert.equal(paginate(eleven, 1, 5).total, 11);
    assert.equal(paginate(eleven.slice(0, 10), 2, 5).totalPages, 2, 'divisible lists keep working');
});
