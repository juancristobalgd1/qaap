// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';
// Executed via stdin inside a stopped-container snapshot, never the live app.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

async function manifest(root) {
    const result = [];
    async function visit(relative) {
        const file = path.join(root, relative);
        const stat = fs.lstatSync(file);
        const entry = { path: relative, uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o7777 };
        if (stat.isSymbolicLink()) {
            entry.type = 'link';
            entry.target = fs.readlinkSync(file);
        } else if (stat.isDirectory()) {
            entry.type = 'directory';
        } else if (stat.isFile()) {
            entry.type = 'file';
            const hash = crypto.createHash('sha256');
            for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); }
            entry.sha256 = hash.digest('hex');
        } else {
            throw new Error('Special file in runtime state; stop previews and remove stale sockets before migrating');
        }
        result.push(entry);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(file).sort()) { await visit(path.join(relative, name)); }
        }
    }
    await visit('');
    return result;
}

async function copyState(source, destination, verifyOnly = false) {
    assert.equal(fs.lstatSync(source).isDirectory(), true, 'Source root must be a real directory');
    assert.equal(fs.lstatSync(destination).isDirectory(), true, 'Target root must be a real directory');
    const expected = await manifest(source);
    if (!verifyOnly) {
        assert.equal(fs.readdirSync(destination).length, 0, 'Refusing to overwrite a nonempty target volume');
        for (const entry of expected) {
            const from = path.join(source, entry.path);
            const to = path.join(destination, entry.path);
            if (entry.type === 'directory') {
                fs.mkdirSync(to, { recursive: true });
            } else if (entry.type === 'link') {
                fs.symlinkSync(entry.target, to);
            } else {
                fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
            }
        }
        // Apply directory permissions last; retain numeric tenant identities.
        for (const entry of [...expected].reverse()) {
            const to = path.join(destination, entry.path);
            fs.lchownSync(to, entry.uid, entry.gid);
            if (entry.type !== 'link') {
                fs.chmodSync(to, entry.mode);
                const info = fs.statSync(path.join(source, entry.path));
                fs.utimesSync(to, info.atime, info.mtime);
            }
        }
    }
    assert.deepEqual(await manifest(destination), expected, 'Copied runtime state does not match the snapshot');
    return { verified: true, entries: expected.length };
}

module.exports = { manifest, copyState };
if (!module.parent && (require.main === module || process.argv[1] === '-')) {
    const [source, destination, mode] = process.argv.slice(2);
    assert.ok(['/tmp/qaap-worktrees', '/tmp/qaap-parallel', '/home/qaap-tenants'].includes(source));
    assert.equal(destination, '/qaap-migration-target');
    assert.ok(['copy', 'verify'].includes(mode));
    assert.equal(process.platform, 'linux');
    assert.equal(process.getuid(), 0);
    // A never-used root has no state to migrate; initialize it in the helper only.
    if (!fs.existsSync(source)) { fs.mkdirSync(source, { recursive: true, mode: 0o711 }); }
    copyState(source, destination, mode === 'verify').then(result => console.log(JSON.stringify(result))).catch(() => {
        console.error('Runtime state copy/verification failed; retain the source snapshot and inspect the target.');
        process.exitCode = 1;
    });
}
