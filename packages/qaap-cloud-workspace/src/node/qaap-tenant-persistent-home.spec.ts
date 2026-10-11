// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
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
        for (const entry of [
            root,
            path.join(root, 'tmpfs'),
            path.join(root, 'disk'),
            home,
            persistentHome,
            path.join(persistentHome, '.config'),
            path.join(home, '.local'),
            path.join(home, '.local', 'share'),
        ]) {
            try {
                fs.chmodSync(entry, 0o700);
            } catch {
                // The entry may not have been created by this test.
            }
        }
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

    it('leaves existing ownership and permissions alone when a per-tenant backend has no agent owner', () => {
        const config = path.join(persistentHome, '.config');
        fs.mkdirSync(config, { recursive: true });
        fs.mkdirSync(home, { recursive: true });
        fs.symlinkSync(config, path.join(home, '.config'));
        fs.chmodSync(home, 0o710);
        fs.chmodSync(persistentHome, 0o750);
        fs.chmodSync(config, 0o750);

        const homeOwner = fs.statSync(home).uid;
        const configOwner = fs.statSync(config).uid;
        QaapTenantPersistentHome.link(home, persistentHome);

        expect(fs.statSync(home).uid).to.equal(homeOwner);
        expect(fs.statSync(home).mode & 0o777).to.equal(0o710);
        expect(fs.statSync(persistentHome).mode & 0o777).to.equal(0o750);
        expect(fs.statSync(config).uid).to.equal(configOwner);
        expect(fs.statSync(config).mode & 0o777).to.equal(0o750);
    });

    it('lets the dropped agent create OpenCode config through inaccessible HOME and copied state', function () {
        const backendUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
        const backendGid = typeof process.getgid === 'function' ? process.getgid() : undefined;
        if (backendUid === undefined || backendGid === undefined
            || (backendUid === 0 && (process.platform !== 'linux' || !fs.existsSync('/usr/bin/setpriv')))) {
            this.skip();
            return;
        }

        const agentUid = backendUid === 0 ? 1001 : backendUid;
        const agentGid = backendUid === 0 ? 1001 : backendGid;
        const owner = { uid: agentUid, gid: agentGid };
        const config = path.join(persistentHome, '.config');
        const existingConfig = path.join(config, 'opencode.json');
        const local = path.join(home, '.local');

        fs.mkdirSync(config, { recursive: true });
        fs.writeFileSync(existingConfig, '{}');
        fs.mkdirSync(path.join(local, 'share'), { recursive: true });
        fs.writeFileSync(path.join(local, 'share', 'agent-state.json'), '{}');

        // On a root backend this is the observed root:root 0700 state. On an unprivileged test
        // runner, mode 000 models the same effective denial without requiring chown privileges.
        fs.chmodSync(root, 0o711);
        fs.chmodSync(path.join(root, 'tmpfs'), 0o711);
        fs.chmodSync(path.join(root, 'disk'), 0o711);
        const inaccessibleMode = backendUid === 0 ? 0o700 : 0o000;
        const inaccessibleFileMode = backendUid === 0 ? 0o600 : 0o000;
        for (const entry of [
            existingConfig,
            path.join(local, 'share', 'agent-state.json'),
        ]) {
            fs.chmodSync(entry, inaccessibleFileMode);
        }
        for (const entry of [config, persistentHome, path.join(local, 'share'), local, home]) {
            fs.chmodSync(entry, inaccessibleMode);
        }

        QaapTenantPersistentHome.link(home, persistentHome, owner);

        expect(fs.statSync(home).uid).to.equal(agentUid);
        expect(fs.statSync(persistentHome).uid).to.equal(agentUid);
        expect(fs.statSync(config).uid).to.equal(agentUid);
        expect(fs.statSync(existingConfig).uid).to.equal(agentUid);
        expect(fs.statSync(local).uid).to.equal(agentUid);
        expect(fs.statSync(path.join(local, 'share')).uid).to.equal(agentUid);
        expect(fs.statSync(path.join(local, 'share', 'agent-state.json')).uid).to.equal(agentUid);
        expect(fs.statSync(home).mode & 0o700).to.equal(0o700);
        expect(fs.statSync(config).mode & 0o700).to.equal(0o700);
        expect(fs.statSync(existingConfig).mode & 0o600).to.equal(0o600);
        expect(fs.statSync(path.join(local, 'share')).mode & 0o700).to.equal(0o700);
        expect(fs.statSync(path.join(local, 'share', 'agent-state.json')).mode & 0o600).to.equal(0o600);
        expect(fs.statSync(config).mode & 0o077).to.equal(0);
        expect(fs.statSync(existingConfig).mode & 0o077).to.equal(0);

        const opencodeConfig = path.join(home, '.config', 'opencode');
        const command = backendUid === 0
            ? spawnSync('/usr/bin/setpriv', [
                '--reuid', String(agentUid), '--regid', String(agentGid), '--clear-groups', '--', '/bin/mkdir', opencodeConfig,
            ], { encoding: 'utf8' })
            : spawnSync('/bin/mkdir', [opencodeConfig], { encoding: 'utf8' });
        expect(command.error?.message ?? command.stderr).to.equal('');
        expect(command.status).to.equal(0);
        expect(fs.statSync(opencodeConfig).uid).to.equal(agentUid);
    });
});
