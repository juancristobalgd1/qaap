// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { looksLikeLocalInstall, purgeSharedAiSettings } = require('./qaap-purge-shared-ai-settings');

const ISOLATED = new Set(['ai-features.openrouter.openrouterApiKey', 'ai-features.mcp.mcpServers']);
const isIsolatedKey = key => ISOLATED.has(key);

const SETTINGS = `{
    // operator comment
    "editor.fontSize": 14,
    "ai-features.openrouter.openrouterApiKey": "sk-leaked",
    "ai-features.chat.defaultChatAgent": "Coder",
    "ai-features.mcp.mcpServers": { "gh": { "command": "x", "env": { "TOKEN": "t" } } }
}
`;

const fixture = t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-purge-ai-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, SETTINGS, { mode: 0o600 });
    return { dir, settingsPath };
};

test('dry run lists isolated keys without touching the file', t => {
    const { dir, settingsPath } = fixture(t);
    const result = purgeSharedAiSettings({ settingsPath, apply: false, isIsolatedKey });
    assert.deepEqual(result.removedKeys, ['ai-features.mcp.mcpServers', 'ai-features.openrouter.openrouterApiKey']);
    assert.equal(result.written, false);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), SETTINGS);
    assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('apply removes only isolated keys, keeps comments and writes a 0600 backup; second run is a no-op', t => {
    const { dir, settingsPath } = fixture(t);
    const result = purgeSharedAiSettings({ settingsPath, apply: true, isIsolatedKey, now: new Date('2026-09-24T00:00:00Z') });
    assert.equal(result.written, true);
    const next = fs.readFileSync(settingsPath, 'utf8');
    assert.match(next, /operator comment/);
    assert.match(next, /"editor.fontSize": 14/);
    assert.match(next, /"ai-features.chat.defaultChatAgent": "Coder"/);
    assert.doesNotMatch(next, /sk-leaked|mcpServers/);
    assert.equal(fs.readFileSync(result.backupPath, 'utf8'), SETTINGS);
    assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o600);

    const again = purgeSharedAiSettings({ settingsPath, apply: true, isIsolatedKey });
    assert.deepEqual(again, { removedKeys: [], written: false });
    assert.equal(fs.readdirSync(dir).length, 2);
});

test('refuses to edit a file that is not a JSON object', t => {
    const { settingsPath } = fixture(t);
    fs.writeFileSync(settingsPath, '[1, 2]');
    assert.throws(() => purgeSharedAiSettings({ settingsPath, apply: true, isIsolatedKey }), /not a valid JSON object/);
});

test('a local single-user install is detected and --apply is refused without --force', t => {
    assert.equal(looksLikeLocalInstall({}), true);
    assert.equal(looksLikeLocalInstall({ QAAP_CLOUD_MODE: 'local' }), true);
    assert.equal(looksLikeLocalInstall({ QAAP_CLOUD_MODE: 'docker' }), false);
    assert.equal(looksLikeLocalInstall({ NODE_ENV: 'production' }), false);
    const { settingsPath } = fixture(t);
    const env = { ...process.env, QAAP_CLOUD_MODE: '', NODE_ENV: 'development' };
    const run = spawnSync(process.execPath, [path.join(__dirname, 'qaap-purge-shared-ai-settings.js'), '--settings', settingsPath, '--apply'],
        { encoding: 'utf8', env });
    assert.equal(run.status, 2, run.stderr);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), SETTINGS);
});
