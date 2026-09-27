const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { manifest, copyState } = require('./qaap-runtime-state-copy');

test('verification detects modified and missing files', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-state-copy-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'worktree.txt'), 'uncommitted work');
    fs.cpSync(source, target, { recursive: true });
    assert.deepEqual(await manifest(source), await manifest(target));
    await copyState(source, target, true);
    fs.writeFileSync(path.join(target, 'worktree.txt'), 'changed');
    await assert.rejects(copyState(source, target, true));
    fs.unlinkSync(path.join(target, 'worktree.txt'));
    await assert.rejects(copyState(source, target, true));
});
test('copy retains data, modes and links on Linux without overwriting a populated target', { skip: process.platform !== 'linux' }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-state-copy-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'), target = path.join(root, 'target');
    fs.mkdirSync(source, { mode: 0o711 });
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(source, 'worktree.txt'), 'uncommitted work', { mode: 0o600 });
    fs.symlinkSync('worktree.txt', path.join(source, 'link'));
    await copyState(source, target);
    assert.deepEqual(await manifest(source), await manifest(target));
    await assert.rejects(copyState(source, target), /nonempty/);
});
test('stdin execution actually runs the helper and rejects invalid roots', () => {
    const input = fs.readFileSync(path.join(__dirname, 'qaap-runtime-state-copy.js'), 'utf8');
    const result = spawnSync(process.execPath, ['-', '/invalid', '/qaap-migration-target', 'copy'], { input, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
});

test('importing the helper from a stdin smoke script does not execute its CLI', () => {
    const input = `require(${JSON.stringify(path.join(__dirname, 'qaap-runtime-state-copy.js'))});`;
    const result = spawnSync(process.execPath, ['-'], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
