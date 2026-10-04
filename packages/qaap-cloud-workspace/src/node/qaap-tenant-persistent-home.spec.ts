// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapTenantPersistentHome } from './qaap-tenant-persistent-home';

describe('QaapTenantPersistentHome', () => {
    let root: string;
    let home: string;
    let persistentHome: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-persistent-home-'));
        home = path.join(root, 'tmpfs', 'qaap-home');
        persistentHome = path.join(root, 'disk', 'home');
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('keeps a CLI sign-in across a container restart that wipes the tmpfs HOME', () => {
        QaapTenantPersistentHome.link(home, persistentHome);
        // `claude auth login` writes through the linked entries.
        fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{"claudeAiOauth":{}}');
        fs.writeFileSync(path.join(home, '.claude.json'), '{"oauthAccount":{}}');
        fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
        fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');

        fs.rmSync(path.join(root, 'tmpfs'), { recursive: true, force: true });
        QaapTenantPersistentHome.link(home, persistentHome);

        expect(fs.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf8')).to.equal('{"claudeAiOauth":{}}');
        expect(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).to.equal('{"oauthAccount":{}}');
        expect(fs.readFileSync(path.join(home, '.codex', 'auth.json'), 'utf8')).to.equal('{}');
    });

    it('moves state written into HOME before the link existed and is idempotent', () => {
        fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
        fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), 'tmpfs');

        QaapTenantPersistentHome.link(home, persistentHome);
        QaapTenantPersistentHome.link(home, persistentHome);

        expect(fs.lstatSync(path.join(home, '.gemini')).isSymbolicLink()).to.equal(true);
        expect(fs.readFileSync(path.join(persistentHome, '.gemini', 'oauth_creds.json'), 'utf8')).to.equal('tmpfs');
        expect(fs.readlinkSync(path.join(home, '.claude'))).to.equal(path.join(persistentHome, '.claude'));
    });
});
