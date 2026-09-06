// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Run only in the throwaway smoke container. These paths disappear with its removal.
assert.equal(process.env.QAAP_IMAGE_SMOKE, '1');
assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0);
// Compilation cannot detect a native terminal binary built for the wrong Node ABI.
require(require.resolve('node-pty', { paths: ['/app/packages/process'] }));
const python = spawnSync('python3', ['-c', 'import tarfile; assert hasattr(tarfile, "data_filter")'], { encoding: 'utf8', timeout: 10000 });
assert.equal(python.status, 0, 'The image must support safe backup restore filtering: ' + python.stderr);
const root = fs.mkdtempSync('/tmp/qaap-image-smoke-');
fs.chmodSync(root, 0o711);
for (const uid of [20000, 20001]) {
    const dir = path.join(root, String(uid));
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.chownSync(dir, uid, uid);
}
for (const [uid, other] of [[20000, 20001], [20001, 20000]]) {
    const own = path.join(root, String(uid), 'owned.txt');
    const peer = path.join(root, String(other), 'forbidden.txt');
    const result = spawnSync('setpriv', ['--reuid', String(uid), '--regid', String(uid), '--clear-groups',
        process.execPath, '-e', `
const fs = require('node:fs'), assert = require('node:assert/strict');
assert.equal(process.getuid(), Number(process.argv[3]));
fs.writeFileSync(process.argv[1], 'owned');
assert.equal(fs.readFileSync(process.argv[1], 'utf8'), 'owned');
assert.throws(() => fs.writeFileSync(process.argv[2], 'escape'), { code: 'EACCES' });
assert.throws(() => fs.readFileSync(process.argv[2]), { code: 'EACCES' });
assert.throws(() => fs.readdirSync('/root'), { code: 'EACCES' });
`, own, peer, String(uid)], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
}
const shell = process.env.THEIA_SHELL || process.env.SHELL;
assert.ok(shell, 'Terminal shell must be configured');
const probe = spawnSync(shell, ['-c', 'printf QAAP_TERMINAL_OK'], { encoding: 'utf8', timeout: 10000 });
assert.equal(probe.status, 0, probe.stderr);
assert.equal(probe.stdout, 'QAAP_TERMINAL_OK');
console.log('PASS: runtime shell and bidirectional OS uid boundaries (primitive smoke check)');

// Exercise the real migration copier with tenant-owned files inside this throwaway container.
const { copyState } = require('/app/scripts/qaap-runtime-state-copy.js');
const migrationSource = path.join(root, '20000');
const migrationTarget = path.join(root, 'copied-state');
fs.mkdirSync(migrationTarget);
fs.symlinkSync('owned.txt', path.join(migrationSource, 'link'));
fs.lchownSync(path.join(migrationSource, 'link'), 20000, 20000);
copyState(migrationSource, migrationTarget).then(() => {
    console.log('PASS: migration retains tenant data, numeric ownership, permissions and links');
}).catch(error => {
    console.error('Migration copy smoke failed:', error.message);
    process.exitCode = 1;
});
