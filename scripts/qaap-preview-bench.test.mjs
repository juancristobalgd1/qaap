// Unit tests for the pure helpers of scripts/qaap-preview-bench.mjs (node --test, no dependencies).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgePage, parseArgs } from './qaap-preview-bench.mjs';

test('arguments: base, repeated apps, runs, cookie', () => {
    const options = parseArgs(['--base', 'http://127.0.0.1:3457/', '--app', 'vite=/tmp/a', '--app', 'next=/tmp/b', '--runs', '3', '--cookie', 'qaap_sid=x']);
    assert.equal(options.base, 'http://127.0.0.1:3457');
    assert.deepEqual(options.apps.map(app => app.name), ['vite', 'next']);
    assert.equal(options.apps[0].dir, '/tmp/a');
    assert.equal(options.runs, 3);
    assert.equal(options.cookie, 'qaap_sid=x');
    assert.throws(() => parseArgs(['--app', 'vite=/tmp/a']), /Usage/);
    assert.throws(() => parseArgs(['--base', 'http://x', '--app', 'novalue']), /name=dir/);
    assert.throws(() => parseArgs(['--base', 'http://x', '--bogus', '1']), /Unknown option/);
});

test('page verdict: page errors, blank page and failed hydration fail', () => {
    assert.equal(judgePage({ pageErrors: [], text: 'Hello', hydrated: true }).ok, true);
    assert.equal(judgePage({ pageErrors: [], text: 'Hello', hydrated: undefined }).reason, 'rendered');
    assert.match(judgePage({ pageErrors: ['ReferenceError: process is not defined'], text: 'x' }).reason, /process is not defined/);
    assert.match(judgePage({ pageErrors: [], text: '  \n' }).reason, /blank page/);
    assert.match(judgePage({ pageErrors: [], text: 'x', hydrated: false }).reason, /not hydrated/);
});
