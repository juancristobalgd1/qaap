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

// A real sleeping child stands in for the listener on the port; fake `lsof`/`ps` describe it.
const fakeListener = (t, { cwd, args }) => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-free-port-'));
    // Double fork through `sh`: the sleeper is reparented away from this test process, so once it
    // is killed it is reaped instead of lingering as a zombie that `kill -0` still reports.
    const launched = spawnSync('sh', ['-c', `"${process.execPath}" -e "setInterval(() => {}, 1000)" >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' });
    const pid = Number(launched.stdout.trim());
    t.after(() => {
        try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
        fs.rmSync(bin, { recursive: true, force: true });
    });
    fs.writeFileSync(path.join(bin, 'lsof'), [
        '#!/bin/sh',
        'case "$*" in',
        `  *"-d cwd"*) echo "p${pid}"; echo "n${cwd}" ;;`,
        `  *) kill -0 ${pid} 2>/dev/null && echo ${pid} ;;`,
        'esac',
        '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'ps'), [
        '#!/bin/sh',
        'case "$*" in',
        '  *"comm="*) echo node ;;',
        `  *"args="*) echo ${JSON.stringify(args)} ;;`,
        '  *) echo "PID PPID ARGS" ;;',
        'esac',
        '',
    ].join('\n'), { mode: 0o755 });
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const run = () => spawnSync(process.execPath, [path.join(scripts, 'qaap-free-dev-port.js')], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, QAAP_PREVIEW_PORT: '', QAAP_DEV_PORT: '3999' },
    });
    return { run, alive };
};

test('free-dev-port never kills another project\'s Node server on the port', { skip: process.platform === 'win32' }, t => {
    const { run, alive } = fakeListener(t, { cwd: '/Users/someone/other-app/api', args: 'node --import tsx src/server.ts' });
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ocupado por/);
    assert.equal(alive(), true);
});

test('free-dev-port frees a leftover Theia backend of this repo', { skip: process.platform === 'win32' }, async t => {
    const repo = path.resolve(scripts, '..');
    const { run, alive } = fakeListener(t, {
        cwd: path.join(repo, 'examples', 'browser'),
        args: 'node ../../dev-packages/cli/bin/theia.js start --port 3999',
    });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(alive(), false);
});
