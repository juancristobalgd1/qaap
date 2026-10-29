// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, 'qaap-tenant-backend-isolation-check.js');

function backend(login, secret, capAdd, options = {}) {
    const seg = login.toLowerCase();
    return {
        Name: `/qaap-backend-${seg}`,
        ...(options.running === undefined ? {} : { State: { Running: options.running, Paused: options.paused === true } }),
        Config: {
            User: options.user ?? '0:0',
            Labels: { 'com.qaap.managed': 'true', 'com.qaap.tenant-backend': 'true', 'com.qaap.tenant-login': login },
            Env: [
                `QAAP_TENANT_LOGIN=${login}`, 'QAAP_TENANT_BACKEND_MODE=1', `QAAP_TENANT_BACKEND_SECRET=${secret}`,
                ...(options.requireDrop === false ? [] : ['QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP=1']),
                'QAAP_AGENT_UID=1001',
            ],
        },
        HostConfig: {
            CapDrop: ['ALL'], CapAdd: capAdd, SecurityOpt: ['no-new-privileges:true'], ReadonlyRootfs: true,
            Privileged: options.privileged === true,
            NetworkMode: `qaap-tenant-${seg}`,
        },
        Mounts: [
            `/workspace/repos/users/${seg}`, `/tmp/qaap-worktrees/${seg}`, `/tmp/qaap-parallel/${seg}`,
            '/home/theia/.qaap', '/home/theia/.theia',
        ].map((destination, index) => ({ Source: `/srv/${seg}/${index}`, Destination: destination })),
    };
}

function run(capAddA) {
    const input = JSON.stringify([backend('alice', 'a-secret', capAddA), backend('bob', 'b-secret', [])]);
    return spawnSync(process.execPath, [script, 'alice', 'bob', 'rootless'], { input, encoding: 'utf8' });
}

test('accepts a backend that only re-adds SETUID/SETGID for the agent uid drop', () => {
    const result = run(['SETUID', 'SETGID']);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('accepts CAP_-prefixed SETUID/SETGID', () => {
    assert.strictEqual(run(['CAP_SETUID', 'CAP_SETGID']).status, 0);
});

test('still blocks any other added capability', () => {
    const result = run(['SETUID', 'NET_ADMIN']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /capabilities not fully dropped \(CapAdd: SETUID, NET_ADMIN\)/);
});

test('still blocks a backend that does not drop ALL', () => {
    const input = JSON.stringify([
        { ...backend('alice', 'a', []), HostConfig: { ...backend('alice', 'a', []).HostConfig, CapDrop: [] } },
        backend('bob', 'b', []),
    ]);
    const result = spawnSync(process.execPath, [script, 'alice', 'bob', 'rootless'], { input, encoding: 'utf8' });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /capabilities not fully dropped/);
});

function runWith(options) {
    const input = JSON.stringify([backend('alice', 'a-secret', [], options), backend('bob', 'b-secret', [])]);
    return spawnSync(process.execPath, [script, 'alice', 'bob', 'rootless'], { input, encoding: 'utf8' });
}

test('accepts uid 0 on a rootless daemon with the agent-drop flag', () => {
    const result = runWith({ user: '0:0' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('fails a rootless backend that runs as uid 1000 (shared backend/agent uid)', () => {
    const result = runWith({ user: '1000:1000' });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /shared backend\/agent uid/);
});

test('fails a backend without QAAP_TENANT_BACKEND_REQUIRE_AGENT_DROP=1', () => {
    const result = runWith({ requireDrop: false });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /REQUIRE_AGENT_DROP=1 missing/);
});

test('reports, but does not block on, uid/flag drift of a stopped backend (recreated on next wake)', () => {
    const result = runWith({ running: false, requireDrop: false, user: '1000:1000' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /INFO backend qaap-backend-alice \(alice\) is stopped and will be recreated on next wake: .*REQUIRE_AGENT_DROP=1 missing/);
});

test('still blocks uid/flag drift of a running backend', () => {
    const result = runWith({ running: true, requireDrop: false });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /REQUIRE_AGENT_DROP=1 missing/);
});

test('still blocks a stopped backend that breaks another part of the contract', () => {
    const result = runWith({ running: false, requireDrop: false, privileged: true });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /privileged/);
});

test('reports, but does not block on, uid/flag drift of a paused backend (revalidated on next wake)', () => {
    const result = runWith({ running: true, paused: true, requireDrop: false });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /INFO backend qaap-backend-alice \(alice\) is paused; revalidated on next wake: .*REQUIRE_AGENT_DROP=1 missing/);
});

test('still blocks a paused backend that breaks another part of the contract', () => {
    const result = runWith({ running: true, paused: true, requireDrop: false, privileged: true });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /privileged/);
});
