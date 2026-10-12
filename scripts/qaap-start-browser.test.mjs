// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

// A Qaap preview of this repo must start Theia on the port the allocator verified free, and must
// never kill processes of the IDE that runs it. Fake `npm`, `ps` and `lsof` record their calls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));

const fakeBin = t => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-start-browser-'));
    t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
    const calls = path.join(bin, 'calls.log');
    for (const name of ['npm', 'ps', 'lsof']) {
        fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n`, { mode: 0o755 });
    }
    const run = (script, env) => spawnSync(process.execPath, [path.join(scripts, script)], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, QAAP_PREVIEW_PORT: '', QAAP_DEV_PORT: '', ...env },
    });
    const recorded = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '');
    return { run, recorded };
};

test('start:browser passes the Qaap preview port to theia start', { skip: process.platform === 'win32' }, t => {
    const { run, recorded } = fakeBin(t);
    assert.equal(run('qaap-start-browser.mjs', { QAAP_PREVIEW_PORT: '3001' }).status, 0);
    assert.match(recorded(), /^npm run start -- --hostname=:: --port 3001$/m);
});

test('start:browser keeps :3000 outside a preview and ignores a malformed port', { skip: process.platform === 'win32' }, t => {
    const { run, recorded } = fakeBin(t);
    assert.equal(run('qaap-start-browser.mjs', { QAAP_PREVIEW_PORT: '3001; rm -rf /' }).status, 0);
    assert.match(recorded(), /^npm run start -- --hostname=:: --port 3000$/m);
});

test('free-dev-port never inspects or kills processes inside a Qaap preview', { skip: process.platform === 'win32' }, t => {
    const { run, recorded } = fakeBin(t);
    const result = run('qaap-free-dev-port.js', { QAAP_PREVIEW_PORT: '3001' });
    assert.equal(result.status, 0);
    assert.equal(recorded(), '');
});
