// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveUserSettingsFilePath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { readUserSettingsFromDisk, writeUserSettingsToDisk } from './qaap-agent-task-runner-utils2';

const KEY = Buffer.alloc(32, 4).toString('base64');
const ENV: NodeJS.ProcessEnv = { QAAP_SECRETS_KEYS: `k1:${KEY}` };
const GOOGLE_KEY = 'ai-features.google.apiKey';
const DEFAULT_AGENT = 'ai-features.chat.defaultChatAgent';

describe('user AI settings sealed at rest (utils2)', () => {
    let home: string;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-settings-seal-'));
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    const onDisk = (login: string): Record<string, unknown> =>
        JSON.parse(fs.readFileSync(resolveUserSettingsFilePath(login, home), 'utf8')) as Record<string, unknown>;

    it('seals only credential values and keeps the other AI keys readable on disk', () => {
        writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-secret-value', [DEFAULT_AGENT]: 'Coder' }, home, ENV);
        const raw = onDisk('alice');
        expect(raw[GOOGLE_KEY]).to.match(/^qaapenc:v1:k1:/);
        expect(raw[DEFAULT_AGENT]).to.equal('Coder');
        expect(JSON.stringify(raw)).not.to.contain('AIza-secret-value');
    });

    it('returns plain text to the owner on write and on read', () => {
        const stored = writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-secret-value' }, home, ENV);
        expect(stored).to.deep.equal({ [GOOGLE_KEY]: 'AIza-secret-value' });
        expect(readUserSettingsFromDisk('alice', home, ENV)).to.deep.equal({ [GOOGLE_KEY]: 'AIza-secret-value' });
    });

    it('accepts a legacy plain credential and reseals it on the next write', () => {
        writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'legacy-plain' }, home);
        expect(onDisk('alice')[GOOGLE_KEY]).to.equal('legacy-plain');
        expect(readUserSettingsFromDisk('alice', home, ENV)).to.deep.equal({ [GOOGLE_KEY]: 'legacy-plain' });

        writeUserSettingsToDisk('alice', { [DEFAULT_AGENT]: 'Coder' }, home, ENV);
        expect(onDisk('alice')[GOOGLE_KEY]).to.match(/^qaapenc:v1:k1:/);
        expect(readUserSettingsFromDisk('alice', home, ENV)[GOOGLE_KEY]).to.equal('legacy-plain');
    });

    it('does not open a sealed credential copied into another user file', () => {
        writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-secret-value' }, home, ENV);
        const bobFile = resolveUserSettingsFilePath('bob', home);
        fs.mkdirSync(path.dirname(bobFile), { recursive: true });
        fs.copyFileSync(resolveUserSettingsFilePath('alice', home), bobFile);
        expect(readUserSettingsFromDisk('bob', home, ENV)[GOOGLE_KEY]).to.equal(undefined);
    });

    it('keeps credentials in plain text when no key is configured', () => {
        writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'AIza-plain' }, home, {});
        expect(onDisk('alice')[GOOGLE_KEY]).to.equal('AIza-plain');
    });

    it('fails loudly on a malformed key instead of writing unsealed', () => {
        expect(() => writeUserSettingsToDisk('alice', { [GOOGLE_KEY]: 'x' }, home, { QAAP_SECRETS_KEYS: 'k1:c2hvcnQ=' }))
            .to.throw(/must decode to exactly 32 bytes/);
    });
});
