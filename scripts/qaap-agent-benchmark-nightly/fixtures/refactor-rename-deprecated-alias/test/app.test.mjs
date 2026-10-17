import assert from 'node:assert/strict';
import test from 'node:test';
import { startApp, stopApp } from '../src/app.js';
import { runJob } from '../src/jobs.js';
import { setSink } from '../src/logger.js';

test('app and jobs log through the logger', () => {
    const lines = [];
    setSink(line => lines.push(line));
    const app = startApp('demo');
    runJob('sync', () => 1);
    assert.throws(() => runJob('boom', () => { throw new Error('bad'); }), /bad/);
    stopApp(app, 'maintenance');
    assert.deepEqual(lines, [
        '[INFO] starting demo',
        '[DEBUG] job sync started',
        '[DEBUG] job sync finished',
        '[DEBUG] job boom started',
        '[ERROR] job boom failed: bad',
        '[WARN] stopping demo: maintenance',
    ]);
});
