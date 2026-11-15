// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSecretPlaceholderResolver } from './qaap-secret-placeholder-resolver';
import { writeUserSettingsToDisk } from './qaap-agent-task-runner-utils2';

const OPENROUTER = 'ai-features.openrouter.openrouterApiKey';
const PLACEHOLDER = `qaap-sealed-secret:${OPENROUTER}`;
const KEY = Buffer.alloc(32, 9).toString('base64');
// os.homedir() reads USERPROFILE on Windows and HOME elsewhere; both must point at the temp home.
const ENV_KEYS = ['HOME', 'USERPROFILE', 'QAAP_SECRETS_KEYS', 'QAAP_TENANT_BACKEND_MODE', 'QAAP_TENANT_LOGIN'];

describe('QaapSecretPlaceholderResolver', () => {

    let saved: Record<string, string | undefined>;
    let home: string;
    const resolver = new QaapSecretPlaceholderResolver();

    beforeEach(() => {
        saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-placeholder-resolve-'));
        process.env.HOME = home;
        process.env.USERPROFILE = home;
        process.env.QAAP_SECRETS_KEYS = `k1:${KEY}`;
    });
    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('passes non-placeholder values through unchanged', () => {
        expect(resolver.resolve('test-key-plain')).to.equal('test-key-plain');
        expect(resolver.resolve(undefined)).to.equal(undefined);
    });

    it('resolves a placeholder to the owner stored key on a tenant backend', () => {
        writeUserSettingsToDisk('alice', { [OPENROUTER]: 'test-key-old' }, home, process.env);
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_LOGIN = 'alice';
        expect(resolver.resolve(PLACEHOLDER)).to.equal('test-key-old');
    });

    it('resolves to undefined outside tenant mode, for unknown ids and when nothing is stored', () => {
        writeUserSettingsToDisk('alice', { [OPENROUTER]: 'test-key-old' }, home, process.env);
        expect(resolver.resolve(PLACEHOLDER)).to.equal(undefined);
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_LOGIN = 'alice';
        expect(resolver.resolve('qaap-sealed-secret:ai-features.google.apiKey')).to.equal(undefined);
        writeUserSettingsToDisk('bob', {}, home, process.env);
        process.env.QAAP_TENANT_LOGIN = 'bob';
        expect(resolver.resolve(PLACEHOLDER)).to.equal(undefined);
    });
});
