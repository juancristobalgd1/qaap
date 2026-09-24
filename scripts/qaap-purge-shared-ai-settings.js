#!/usr/bin/env node
// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
'use strict';

/**
 * One-off cleanup for shared-backend (QAAP_BACKEND_PER_TENANT=0) deployments with several signed-in users.
 *
 * Before per-user AI settings were fully isolated, a tenant's frontend could write AI credentials / BYOK
 * settings (API keys, model lists, MCP servers, ...) into the process-wide Theia User settings file
 * (`$THEIA_CONFIG_DIR/settings.json`, default `~/.theia/settings.json`). Tenants no longer read or write
 * those keys there, but the stale values stay on disk and are still visible to the local / anonymous
 * fallback. This tool removes exactly the isolated keys (`isQaapIsolatedAiSettingsPrefKey`), keeping
 * comments and every other setting, after writing a 0600 backup next to the file.
 *
 * Safe by default: dry-run unless `--apply`; prints key names only, never values; idempotent (nothing to
 * remove => no write, no backup). `--apply` refuses to run on what looks like a local single-user install
 * (QAAP_CLOUD_MODE unset/`local` and NODE_ENV != production) unless `--force` is given.
 *
 * Usage: node scripts/qaap-purge-shared-ai-settings.js [--settings <path>] [--apply] [--force]
 * Requires `npm run compile` (reads the key list from @theia/qaap-shared-core's compiled registry).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyEdits, modify, parse } = require('jsonc-parser');

function defaultSettingsPath(env = process.env) {
    const configDir = env.THEIA_CONFIG_DIR?.trim() || path.join(os.homedir(), '.theia');
    return path.join(configDir, 'settings.json');
}

function looksLikeLocalInstall(env = process.env) {
    const cloudMode = env.QAAP_CLOUD_MODE?.trim().toLowerCase();
    return env.NODE_ENV !== 'production' && (!cloudMode || cloudMode === 'local');
}

/**
 * @param {{ settingsPath: string, apply: boolean, isIsolatedKey: (key: string) => boolean, now?: Date }} options
 * @returns {{ removedKeys: string[], backupPath?: string, written: boolean }}
 */
function purgeSharedAiSettings({ settingsPath, apply, isIsolatedKey, now = new Date() }) {
    if (!fs.existsSync(settingsPath)) {
        return { removedKeys: [], written: false };
    }
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const errors = [];
    const settings = parse(raw, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error(`Refusing to edit ${settingsPath}: it is not a valid JSON object.`);
    }
    const removedKeys = Object.keys(settings).filter(key => isIsolatedKey(key)).sort();
    if (!apply || removedKeys.length === 0) {
        return { removedKeys, written: false };
    }
    const backupPath = `${settingsPath}.qaap-backup-${now.toISOString().replace(/[:.]/g, '-')}`;
    fs.writeFileSync(backupPath, raw, { mode: 0o600, flag: 'wx' });
    let next = raw;
    for (const key of removedKeys) {
        next = applyEdits(next, modify(next, [key], undefined, { formattingOptions: { insertSpaces: true, tabSize: 4 } }));
    }
    const tmpPath = `${settingsPath}.${process.pid}.tmp`;
    const mode = fs.statSync(settingsPath).mode & 0o777;
    fs.writeFileSync(tmpPath, next, { mode });
    fs.renameSync(tmpPath, settingsPath);
    return { removedKeys, backupPath, written: true };
}

function loadIsolatedKeyPredicate() {
    const registryPath = path.join(__dirname, '..', 'packages', 'qaap-shared-core', 'lib', 'common', 'qaap-qaiq-byok-provider-registry.js');
    if (!fs.existsSync(registryPath)) {
        throw new Error(`Missing ${registryPath}; run \`npm run compile\` first.`);
    }
    return require(registryPath).isQaapIsolatedAiSettingsPrefKey;
}

function main(argv = process.argv.slice(2), env = process.env) {
    const valueOf = flag => {
        const index = argv.indexOf(flag);
        return index >= 0 ? argv[index + 1] : undefined;
    };
    const apply = argv.includes('--apply');
    const settingsPath = path.resolve(valueOf('--settings') || defaultSettingsPath(env));
    if (apply && looksLikeLocalInstall(env) && !argv.includes('--force')) {
        console.error('[qaap-purge-shared-ai-settings] refusing --apply: this looks like a local single-user install '
            + '(set QAAP_CLOUD_MODE / NODE_ENV=production as the server does, or pass --force).');
        return 2;
    }
    const result = purgeSharedAiSettings({ settingsPath, apply, isIsolatedKey: loadIsolatedKeyPredicate() });
    const keys = result.removedKeys.length ? result.removedKeys.join(', ') : 'none';
    if (result.written) {
        console.log(`[qaap-purge-shared-ai-settings] removed ${result.removedKeys.length} tenant AI key(s) from ${settingsPath} `
            + `(backup: ${result.backupPath}): ${keys}`);
    } else if (apply) {
        console.log(`[qaap-purge-shared-ai-settings] nothing to remove from ${settingsPath}.`);
    } else {
        console.log(`[qaap-purge-shared-ai-settings] dry run, ${settingsPath}: would remove ${result.removedKeys.length} key(s): ${keys}. `
            + 'Re-run with --apply.');
    }
    return 0;
}

module.exports = { defaultSettingsPath, looksLikeLocalInstall, purgeSharedAiSettings };

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(`[qaap-purge-shared-ai-settings] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}
