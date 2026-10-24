// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveUserSettingsFilePath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QAAP_TENANT_BACKEND_MODE_ENV, QAAP_TENANT_LOGIN_ENV } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { readUserSettingsFromDisk, writeUserSettingsToDisk } from './qaap-agent-task-runner-utils2';

const KEY_1 = Buffer.alloc(32, 6).toString('base64');
const KEY_2 = Buffer.alloc(32, 7).toString('base64');
const GOOGLE_KEY = 'ai-features.google.apiKey';
const OPENROUTER_KEY = 'ai-features.openrouter.openrouterApiKey';
const DEFAULT_AGENT = 'ai-features.chat.defaultChatAgent';
const tenantEnv = (keys: string): NodeJS.ProcessEnv => ({
    QAAP_SECRETS_KEYS: keys,
    [QAAP_TENANT_BACKEND_MODE_ENV]: '1',
    [QAAP_TENANT_LOGIN_ENV]: 'alice',
});

describe('tenant credential migration (utils2)', () => {
    let home: string;
    const sharedPath = (): string => path.join(home, '.theia', 'settings.json');
    const userPath = (): string => resolveUserSettingsFilePath('alice', home);

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-migration-'));
        fs.mkdirSync(path.dirname(sharedPath()), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    const writeShared = (text: string): void => fs.writeFileSync(sharedPath(), text, 'utf8');
    const readJson = (file: string): Record<string, unknown> => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

    it('moves tenant credentials into the sealed per-user file and keeps the rest of a JSONC file intact', () => {
        writeShared([
            '{',
            `    "${GOOGLE_KEY}": "AIza-tenant-copy",`,
            '    // Theia preferences of this tenant',
            `    "${DEFAULT_AGENT}": "Coder",`,
            '    "editor.fontSize": 14,',
            '}',
            '',
        ].join('\n'));
        const read = readUserSettingsFromDisk('alice', home, tenantEnv(`k1:${KEY_1}`));
        expect(read[GOOGLE_KEY]).to.equal('AIza-tenant-copy');
        expect(readJson(userPath())[GOOGLE_KEY]).to.match(/^qaapenc:v1:k1:/);

        const sharedText = fs.readFileSync(sharedPath(), 'utf8');
        expect(sharedText).not.to.contain(GOOGLE_KEY);
        expect(sharedText).not.to.contain('AIza-tenant-copy');
        expect(sharedText).to.contain('// Theia preferences of this tenant');
        expect(sharedText).to.contain(`"${DEFAULT_AGENT}": "Coder"`);
        expect(sharedText).to.contain('"editor.fontSize": 14');
    });

    it('is idempotent: a second read changes nothing', () => {
        writeShared(`{ "${OPENROUTER_KEY}": "sk-or-1" }\n`);
        readUserSettingsFromDisk('alice', home, tenantEnv(`k1:${KEY_1}`));
        const first = fs.readFileSync(sharedPath(), 'utf8');
        const firstUser = fs.readFileSync(userPath(), 'utf8');
        readUserSettingsFromDisk('alice', home, tenantEnv(`k1:${KEY_1}`));
        expect(fs.readFileSync(sharedPath(), 'utf8')).to.equal(first);
        expect(fs.readFileSync(userPath(), 'utf8')).to.equal(firstUser);
        expect(readUserSettingsFromDisk('alice', home, tenantEnv(`k1:${KEY_1}`))[OPENROUTER_KEY]).to.equal('sk-or-1');
    });

    it('moves nothing without a configured key', () => {
        const original = `{ "${GOOGLE_KEY}": "AIza-stays" }\n`;
        writeShared(original);
        readUserSettingsFromDisk('alice', home, tenantEnv(''));
        expect(fs.readFileSync(sharedPath(), 'utf8')).to.equal(original);
        expect(fs.existsSync(userPath())).to.equal(false);
    });

    it('moves nothing outside a tenant backend (shared single-user file keeps its keys)', () => {
        const original = `{ "${GOOGLE_KEY}": "AIza-local" }\n`;
        writeShared(original);
        readUserSettingsFromDisk('alice', home, { QAAP_SECRETS_KEYS: `k1:${KEY_1}` });
        expect(fs.readFileSync(sharedPath(), 'utf8')).to.equal(original);
    });

    it('keeps the tenant copy when the per-user file already holds a different value', () => {
        writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-user-value' }, home, tenantEnv(`k1:${KEY_1}`));
        writeShared(`{ "${GOOGLE_KEY}": "AIza-tenant-copy" }\n`);
        const read = readUserSettingsFromDisk('alice', home, tenantEnv(`k1:${KEY_1}`));
        expect(read[GOOGLE_KEY]).to.equal('AIza-user-value');
        expect(fs.readFileSync(sharedPath(), 'utf8')).to.contain('AIza-tenant-copy');
    });

    it('keeps the tenant copy when the per-user value is sealed under a key it cannot open', () => {
        writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-old-key' }, home, tenantEnv(`k1:${KEY_1}`));
        const sealedBefore = readJson(userPath())[GOOGLE_KEY];
        writeShared(`{ "${GOOGLE_KEY}": "AIza-tenant-copy" }\n`);
        readUserSettingsFromDisk('alice', home, tenantEnv(`k2:${KEY_2}`));
        expect(readJson(userPath())[GOOGLE_KEY]).to.equal(sealedBefore);
        expect(fs.readFileSync(sharedPath(), 'utf8')).to.contain('AIza-tenant-copy');
    });

    it('removes a credential that is the last property and leaves valid JSON behind', () => {
        writeShared(`{ "editor.fontSize": 14, "${OPENROUTER_KEY}": "sk-or-last" }\n`);
        readUserSettingsFromDisk('alice', home, tenantEnv(`k1:${KEY_1}`));
        expect(JSON.parse(fs.readFileSync(sharedPath(), 'utf8'))).to.deep.equal({ 'editor.fontSize': 14 });
    });
});

describe('sealed user settings are never dropped by a write (utils2)', () => {
    let home: string;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-settings-keep-'));
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('keeps an unreadable sealed credential byte-for-byte through writes of other keys, and does not return it', () => {
        writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-k1' }, home, { QAAP_SECRETS_KEYS: `k1:${KEY_1}` });
        const file = resolveUserSettingsFilePath('alice', home);
        const sealed = (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>)[GOOGLE_KEY];

        // Rotated to a key set that no longer contains k1.
        const rotated = { QAAP_SECRETS_KEYS: `k2:${KEY_2}` };
        expect(readUserSettingsFromDisk('alice', home, rotated)[GOOGLE_KEY]).to.equal(undefined);
        writeUserSettingsToDisk('alice', { [DEFAULT_AGENT]: 'Coder' }, home, rotated);

        expect((JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>)[GOOGLE_KEY]).to.equal(sealed);
        expect(readUserSettingsFromDisk('alice', home, { QAAP_SECRETS_KEYS: `k1:${KEY_1}` })[GOOGLE_KEY]).to.equal('AIza-k1');
    });

    it('replaces the sealed value only when the user explicitly sets that key', () => {
        writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-k1' }, home, { QAAP_SECRETS_KEYS: `k1:${KEY_1}` });
        const rotated = { QAAP_SECRETS_KEYS: `k2:${KEY_2}` };
        const stored = writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-new' }, home, rotated);
        expect(stored[GOOGLE_KEY]).to.equal('AIza-new');
        expect(readUserSettingsFromDisk('alice', home, rotated)[GOOGLE_KEY]).to.equal('AIza-new');
    });
});
