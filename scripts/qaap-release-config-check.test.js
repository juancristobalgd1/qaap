// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateReleaseConfig } = require('./qaap-release-config-check');
const sha = 'abcdef123456' + '0'.repeat(28);
const config = {
    skipAuth: false, productionRuntime: true, agentUidPerUser: true, oauthConfigured: true,
    betaAccessRequired: true, betaAccessConfigured: true, build: sha.slice(0, 12),
};
const health = { ...config, ok: true, ready: true };

test('accepts a production candidate matching the expected commit', () => {
    assert.deepEqual(validateReleaseConfig(config, health, sha), []);
});
test('rejects missing, malformed and string-valued security flags', () => {
    for (const key of ['skipAuth', 'productionRuntime', 'agentUidPerUser', 'oauthConfigured', 'betaAccessRequired', 'betaAccessConfigured']) {
        for (const value of [undefined, String(config[key]), !config[key]]) {
            assert.notEqual(validateReleaseConfig({ ...config, [key]: value }, health).length, 0, key);
        }
    }
});
test('rejects a live HTTP endpoint that is not ready for production', () => {
    for (const patch of [{ ready: false }, { ok: false }, { skipAuth: true }, { productionRuntime: false }, { agentUidPerUser: false }]) {
        assert.notEqual(validateReleaseConfig(config, { ...health, ...patch }).length, 0);
    }
});
test('rejects old, unknown, inconsistent or wrong release identities', () => {
    for (const build of [undefined, '', 'dev', 'a', '123456abcdef']) {
        assert.notEqual(validateReleaseConfig({ ...config, build }, health, sha).length, 0);
    }
    assert.notEqual(validateReleaseConfig(config, health, 'f'.repeat(40)).length, 0);
    assert.notEqual(validateReleaseConfig(config, health, 'abcdef').length, 0);
});
test('rejects invalid response shapes without throwing', () => {
    for (const payload of [undefined, null, [], 'html', 42]) {
        assert.notEqual(validateReleaseConfig(payload, payload).length, 0);
    }
});
