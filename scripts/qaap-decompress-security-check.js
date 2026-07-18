#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const decompress = require('decompress');

const archiveEntry = overrides => ({
    type: 'file',
    path: 'file.txt',
    mode: 0o644,
    mtime: new Date(),
    data: Buffer.from('safe'),
    ...overrides,
});

const plugin = (...entries) => () => entries;

async function expectRefusal(action, label) {
    let error;
    try {
        await action();
    } catch (caught) {
        error = caught;
    }
    assert(error instanceof Error, `${label}: extraction unexpectedly succeeded`);
    assert.match(error.message, /Refusing/, `${label}: extraction failed for an unrelated reason`);
}

async function run() {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'qaap-decompress-security-'));
    try {
        const normalOutput = path.join(sandbox, 'normal');
        await decompress(Buffer.alloc(0), normalOutput, {
            plugins: [plugin(archiveEntry({ path: 'nested/file.txt' }))],
        });
        assert.strictEqual(await fs.readFile(path.join(normalOutput, 'nested/file.txt'), 'utf8'), 'safe');

        const hardlinkOutput = path.join(sandbox, 'hardlink');
        await fs.mkdir(hardlinkOutput, { recursive: true });
        await fs.writeFile(path.join(hardlinkOutput, 'target.txt'), 'inside');
        await decompress(Buffer.alloc(0), hardlinkOutput, {
            plugins: [plugin(archiveEntry({ type: 'link', path: 'copy.txt', linkname: 'target.txt' }))],
        });
        assert.strictEqual(await fs.readFile(path.join(hardlinkOutput, 'copy.txt'), 'utf8'), 'inside');

        const outsideSecret = path.join(sandbox, 'secret.txt');
        await fs.writeFile(outsideSecret, 'SECRET');
        const outsideOutput = path.join(sandbox, 'outside-link');
        await expectRefusal(() => decompress(Buffer.alloc(0), outsideOutput, {
            plugins: [plugin(archiveEntry({ type: 'link', path: 'leak.txt', linkname: '../secret.txt' }))],
        }), 'outside hardlink');

        if (process.platform !== 'win32') {
            const siblingOutput = path.join(sandbox, 'prefix');
            const siblingDirectory = path.join(sandbox, 'prefix-sibling');
            await fs.mkdir(siblingOutput, { recursive: true });
            await fs.mkdir(siblingDirectory, { recursive: true });
            await fs.symlink(siblingDirectory, path.join(siblingOutput, 'escape'));
            await expectRefusal(() => decompress(Buffer.alloc(0), siblingOutput, {
                plugins: [plugin(archiveEntry({ path: 'escape/pwned.txt', data: Buffer.from('PWNED') }))],
            }), 'sibling-prefix traversal');
            await assert.rejects(() => fs.access(path.join(siblingDirectory, 'pwned.txt')));

            const trapOutput = path.join(sandbox, 'link-trap');
            await fs.mkdir(trapOutput, { recursive: true });
            await fs.symlink(outsideSecret, path.join(trapOutput, 'trap'));
            await expectRefusal(() => decompress(Buffer.alloc(0), trapOutput, {
                plugins: [plugin(archiveEntry({ type: 'link', path: 'leak.txt', linkname: 'trap' }))],
            }), 'hardlink through an escaping symlink');

            const writeOutput = path.join(sandbox, 'write-trap');
            await fs.mkdir(writeOutput, { recursive: true });
            await fs.symlink(outsideSecret, path.join(writeOutput, 'pwned'));
            await expectRefusal(() => decompress(Buffer.alloc(0), writeOutput, {
                plugins: [plugin(archiveEntry({ type: 'contiguous-file', path: 'pwned', data: Buffer.from('PWNED') }))],
            }), 'nonstandard file write through a symlink');
            assert.strictEqual(await fs.readFile(outsideSecret, 'utf8'), 'SECRET');

            const symlinkOutput = path.join(sandbox, 'outside-symlink');
            await expectRefusal(() => decompress(Buffer.alloc(0), symlinkOutput, {
                plugins: [plugin(archiveEntry({ type: 'symlink', path: 'leak', linkname: '../secret.txt' }))],
            }), 'outside symlink');

            const modeOutput = path.join(sandbox, 'mode');
            await decompress(Buffer.alloc(0), modeOutput, {
                plugins: [plugin(archiveEntry({ path: 'executable', mode: 0o7755 }))],
            });
            const { mode } = await fs.stat(path.join(modeOutput, 'executable'));
            assert.strictEqual(mode & 0o7000, 0, 'archive special mode bits were preserved');
        }
    } finally {
        await fs.rm(sandbox, { recursive: true, force: true });
    }
}

run().then(() => {
    console.log('[qaap-decompress-security-check] OK — patched extractor blocks archive escapes and unsafe modes.');
}).catch(error => {
    console.error('[qaap-decompress-security-check] FAILED:', error);
    process.exitCode = 1;
});
