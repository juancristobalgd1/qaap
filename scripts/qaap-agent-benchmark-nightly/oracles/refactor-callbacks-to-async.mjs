import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assert, oracle } from './_lib.mjs';

await oracle(process.argv[2], async ({ load, readSources }) => {
    const { readRecords, saveRecords } = await load('src/store.js');
    const { appendIfMissing } = await load('src/sync.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-async-'));
    const file = path.join(dir, 'records.json');

    // Promise API, no callback argument.
    const missing = readRecords(file);
    assert.ok(missing && typeof missing.then === 'function', 'readRecords returns a promise');
    assert.deepEqual(await missing, []);
    const saved = saveRecords(file, [{ id: 1 }]);
    assert.ok(saved && typeof saved.then === 'function', 'saveRecords returns a promise');
    assert.equal(await saved, undefined);
    assert.equal(fs.readFileSync(file, 'utf8'), '[\n  {\n    "id": 1\n  }\n]\n', 'same on-disk format');
    assert.deepEqual(await readRecords(file), [{ id: 1 }]);

    const appended = appendIfMissing(file, { id: 2 });
    assert.ok(appended && typeof appended.then === 'function', 'appendIfMissing returns a promise');
    assert.equal(await appended, true);
    assert.equal(await appendIfMissing(file, { id: 2, other: true }), false);
    assert.deepEqual((await readRecords(file)).map(record => record.id), [1, 2]);

    // Errors reject instead of being passed to a callback.
    fs.writeFileSync(file, '{broken');
    await assert.rejects(readRecords(file), error => {
        assert.ok(error.message.startsWith(`Corrupt store ${file}: `), error.message);
        return true;
    });
    await assert.rejects(appendIfMissing(file, { id: 3 }), /Corrupt store/);
    await assert.rejects(readRecords(dir), error => error.code === 'EISDIR', 'other fs errors propagate untouched');
    await assert.rejects(saveRecords(path.join(dir, 'no', 'such', 'dir.json'), []), error => error.code === 'ENOENT');

    // No callback plumbing left in the sources.
    for (const { name, text } of readSources('src')) {
        assert.ok(!/\bcb\b/.test(text), `${name} still has a callback parameter`);
        assert.ok(!/\(\s*err\b/.test(text), `${name} still has an (err, ...) callback`);
        assert.ok(/\basync\b/.test(text) && /\bawait\b/.test(text), `${name} should use async/await`);
    }
});
