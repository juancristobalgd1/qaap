import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readRecords } from '../src/store.js';
import { appendIfMissing } from '../src/sync.js';
import { call } from './helpers.mjs';

function tempFile() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'records.json');
}

test('a missing store is empty', async () => {
    assert.deepEqual(await call(readRecords, tempFile()), []);
});

test('appends once per id', async () => {
    const file = tempFile();
    assert.equal(await call(appendIfMissing, file, { id: 1, name: 'a' }), true);
    assert.equal(await call(appendIfMissing, file, { id: 1, name: 'dup' }), false);
    assert.equal(await call(appendIfMissing, file, { id: 2, name: 'b' }), true);
    assert.deepEqual((await call(readRecords, file)).map(record => record.id), [1, 2]);
});

test('a corrupt store is reported', async () => {
    const file = tempFile();
    fs.writeFileSync(file, '{not json');
    await assert.rejects(call(readRecords, file), /Corrupt store/);
});
