// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const fixture = t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-drift-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    git(['init']);
    git(['config', 'user.email', 'test@qaap.local']);
    git(['config', 'user.name', 'Qaap test']);
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(__filename.replace('.test.js', '.js'), path.join(root, 'scripts/qaap-drift-check.js'));
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'original\n');
    git(['add', '.']);
    git(['commit', '-m', 'fixture']);
    const sha = git(['rev-parse', 'HEAD']);
    const run = (base = sha, args = [], env = {}) => spawnSync(process.execPath,
        [path.join(root, 'scripts/qaap-drift-check.js'), ...args], {
            cwd: root, encoding: 'utf8', env: { ...process.env, QAAP_DRIFT_CHECK_REPORT: '', QAAP_DIFF_BASE: base, ...env },
        });
    return { root, git, sha, run };
};

test('validates actual commits, including absent full SHAs', t => {
    const { run } = fixture(t);
    assert.equal(run().status, 0);
    for (const base of ['f'.repeat(40), 'missing-branch', '--help', 'HEAD; echo unsafe']) {
        const result = run(base);
        assert.equal(result.status, 2);
        assert.match(result.stderr, /Base ref/);
        assert.doesNotMatch(result.stdout, /OK/);
    }
});

test('report and baseline modes cannot turn invalid input into success', t => {
    const { root, run } = fixture(t);
    const baseline = path.join(root, 'scripts/qaap-drift-baseline.txt');
    fs.writeFileSync(baseline, 'keep-this-entry\n');
    const result = run('f'.repeat(40), ['--write-baseline'], { QAAP_DRIFT_CHECK_REPORT: '1' });
    assert.equal(result.status, 2);
    assert.equal(fs.readFileSync(baseline, 'utf8'), 'keep-this-entry\n');
});

test('reports tracked changes, respects the baseline and ignores allowed product paths', t => {
    const { root, git, run } = fixture(t);
    fs.writeFileSync(path.join(root, 'scripts/qaap-example.js'), '// product tooling\n');
    git(['add', 'scripts/qaap-example.js']);
    assert.equal(run().status, 0);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');
    assert.equal(run().status, 1);
    fs.writeFileSync(path.join(root, 'scripts/qaap-drift-baseline.txt'), 'tracked.txt\n');
    assert.equal(run().status, 0);
});

test('a Git diff failure cannot report a clean tree', t => {
    const { root, run } = fixture(t);
    // A corrupt index leaves commit resolution working but makes diff fail.
    fs.writeFileSync(path.join(root, '.git/index'), 'invalid index');
    const result = run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Git diff failed/);
    assert.doesNotMatch(result.stdout, /OK/);
});
