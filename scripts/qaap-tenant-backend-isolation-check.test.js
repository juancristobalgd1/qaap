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

function backend(login, secret, capAdd) {
    const seg = login.toLowerCase();
    return {
        Name: `/qaap-backend-${seg}`,
        Config: {
            User: '0:0',
            Labels: { 'com.qaap.managed': 'true', 'com.qaap.tenant-backend': 'true', 'com.qaap.tenant-login': login },
            Env: [`QAAP_TENANT_LOGIN=${login}`, 'QAAP_TENANT_BACKEND_MODE=1', `QAAP_TENANT_BACKEND_SECRET=${secret}`],
        },
        HostConfig: {
            CapDrop: ['ALL'], CapAdd: capAdd, SecurityOpt: ['no-new-privileges:true'], ReadonlyRootfs: true,
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
