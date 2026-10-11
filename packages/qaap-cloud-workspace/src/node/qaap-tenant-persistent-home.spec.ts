// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
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

    afterEach(() => sinon.restore());

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

    it('continues preparing persistent links when chown returns EPERM (rootless profile without CAP_CHOWN)', () => {
        fs.mkdirSync(path.join(home, '.config'), { recursive: true });
        fs.writeFileSync(path.join(home, '.config', 'opencode.json'), '{}');
        const deniedChowns: string[] = [];
        const chownWithoutCapability = (entry: string): void => {
            deniedChowns.push(entry);
            throw Object.assign(new Error('Operation not permitted'), { code: 'EPERM' });
        };

        QaapTenantPersistentHome.link(home, persistentHome, { uid: 1001, gid: 1001 }, chownWithoutCapability);

        expect(deniedChowns).to.include(home);
        expect(deniedChowns).not.to.include(persistentHome);
        expect(fs.lstatSync(path.join(home, '.config')).isSymbolicLink()).to.equal(true);
        expect(fs.readFileSync(path.join(persistentHome, '.config', 'opencode.json'), 'utf8')).to.equal('{}');
        expect(fs.statSync(home).mode & 0o077).to.equal(0);
        expect(fs.statSync(persistentHome).mode & 0o077).to.equal(0);
    });

    it('does not chmod a persistent HOME root owned by another uid', () => {
        fs.mkdirSync(persistentHome, { recursive: true });
        const actualLstatSync = fs.lstatSync;
        sinon.stub(fs, 'lstatSync').callsFake(((entry: fs.PathLike) => {
            const stats = actualLstatSync(entry);
            if (path.resolve(String(entry)) === persistentHome) {
                return new Proxy(stats, {
                    get: (target, property, receiver) => property === 'uid'
                        ? stats.uid + 1
                        : Reflect.get(target, property, receiver)
                });
            }
            return stats;
        }) as typeof fs.lstatSync);
        const actualChmodSync = fs.chmodSync;
        const chmod = sinon.stub(fs, 'chmodSync').callsFake(((entry: fs.PathLike, mode: fs.Mode) => {
            if (path.resolve(String(entry)) === persistentHome) {
                throw Object.assign(new Error('Operation not permitted'), { code: 'EPERM' });
            }
            actualChmodSync(entry, mode);
        }) as typeof fs.chmodSync);

        expect(() => QaapTenantPersistentHome.link(home, persistentHome, { uid: 1001, gid: 1001 }, () => undefined)).not.to.throw();
        expect(chmod.calledWith(persistentHome, 0o1700)).to.equal(false);
    });

    it('keeps an existing link when the agent-owned persistent HOME is not searchable by the backend', () => {
        fs.mkdirSync(persistentHome, { recursive: true });
        fs.mkdirSync(home, { recursive: true });
        const target = path.join(persistentHome, '.config');
        fs.symlinkSync(target, path.join(home, '.config'));
        const actualLstatSync = fs.lstatSync;
        sinon.stub(fs, 'lstatSync').callsFake(((entry: fs.PathLike) => {
            const resolved = path.resolve(String(entry));
            if (resolved === target) {
                throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
            }
            const stats = actualLstatSync(entry);
            if (resolved === persistentHome) {
                return new Proxy(stats, {
                    get: (value, property, receiver) => property === 'uid'
                        ? 1001
                        : Reflect.get(value, property, receiver),
                });
            }
            return stats;
        }) as typeof fs.lstatSync);

        expect(() => QaapTenantPersistentHome.link(home, persistentHome, { uid: 1001, gid: 1001 })).not.to.throw();
        expect(fs.readlinkSync(path.join(home, '.config'))).to.equal(target);
    });

    it('tolerates EACCES inspecting a HOME entry already owned by the agent', () => {
        fs.mkdirSync(home, { recursive: true });
        fs.mkdirSync(path.join(persistentHome, '.config'), { recursive: true });
        fs.chmodSync(home, 0o700);
        fs.symlinkSync(path.join(persistentHome, '.config'), path.join(home, '.config'));

        const homeConfig = path.join(home, '.config');
        const persistentConfig = path.join(persistentHome, '.config');
        const actualLstatSync = fs.lstatSync;
        sinon.stub(fs, 'lstatSync').callsFake(((entry: fs.PathLike) => {
            const resolved = path.resolve(String(entry));
            if (resolved === homeConfig || resolved === persistentConfig) {
                throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
            }
            return actualLstatSync(entry);
        }) as typeof fs.lstatSync);

        expect(() => QaapTenantPersistentHome.link(home, persistentHome, { uid: 1001, gid: 1001 })).not.to.throw();
    });

    it('reports an inaccessible persistent destination with a normal HOME entry as incomplete and retries it', () => {
        const config = path.join(home, '.config');
        const persistentConfig = path.join(persistentHome, '.config');
        fs.mkdirSync(config, { recursive: true });
        fs.writeFileSync(path.join(config, 'settings.json'), 'temporary');

        const actualLstatSync = fs.lstatSync;
        sinon.stub(fs, 'lstatSync').callsFake(((entry: fs.PathLike) => {
            if (path.resolve(String(entry)) === persistentConfig) {
                throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
            }
            return actualLstatSync(entry);
        }) as typeof fs.lstatSync);

        const result = QaapTenantPersistentHome.linkWithStatus(home, persistentHome);
        expect(result.complete).to.equal(false);
        expect(fs.lstatSync(config).isDirectory()).to.equal(true);
        expect(fs.readFileSync(path.join(config, 'settings.json'), 'utf8')).to.equal('temporary');

        sinon.restore();
        QaapTenantPersistentHome.link(home, persistentHome);

        expect(fs.lstatSync(config).isSymbolicLink()).to.equal(true);
        expect(fs.readFileSync(path.join(persistentConfig, 'settings.json'), 'utf8')).to.equal('temporary');
    });

    it('skips symlinks and entries on another device while migrating a preexisting HOME directory', () => {
        const config = path.join(home, '.config');
        const outside = path.join(root, 'outside.json');
        const mounted = path.join(config, 'mounted');
        fs.mkdirSync(mounted, { recursive: true });
        fs.writeFileSync(path.join(config, 'settings.json'), '{}');
        fs.writeFileSync(path.join(mounted, 'secret.json'), 'mounted');
        fs.writeFileSync(outside, 'outside');
        fs.symlinkSync(outside, path.join(config, 'outside-link.json'));

        const actualLstatSync = fs.lstatSync;
        sinon.stub(fs, 'lstatSync').callsFake(((entry: fs.PathLike) => {
            const stats = actualLstatSync(entry);
            if (path.resolve(String(entry)) === mounted) {
                return new Proxy(stats, {
                    get: (target, property, receiver) => property === 'dev'
                        ? stats.dev + 1
                        : Reflect.get(target, property, receiver)
                });
            }
            return stats;
        }) as typeof fs.lstatSync);

        const changedEntries = QaapTenantPersistentHome.link(home, persistentHome);

        const persistentConfig = path.join(persistentHome, '.config');
        expect(fs.readFileSync(path.join(persistentConfig, 'settings.json'), 'utf8')).to.equal('{}');
        expect(changedEntries).to.include(persistentConfig);
        expect(fs.existsSync(path.join(persistentConfig, 'mounted'))).to.equal(false);
        expect(fs.existsSync(path.join(persistentConfig, 'outside-link.json'))).to.equal(false);
        expect(fs.readFileSync(path.join(mounted, 'secret.json'), 'utf8')).to.equal('mounted');
        expect(fs.lstatSync(config).isDirectory()).to.equal(true);
        expect(fs.readFileSync(outside, 'utf8')).to.equal('outside');
    });

    it('does not copy or remove a HOME entry that is itself a mount point', () => {
        const config = path.join(home, '.config');
        fs.mkdirSync(config, { recursive: true });
        fs.mkdirSync(path.join(persistentHome, '.config'), { recursive: true });
        fs.writeFileSync(path.join(config, 'mounted-secret.json'), 'mounted');
        fs.writeFileSync(path.join(persistentHome, '.config', 'mounted-secret.json'), 'existing');

        const actualLstatSync = fs.lstatSync;
        sinon.stub(fs, 'lstatSync').callsFake(((entry: fs.PathLike) => {
            const resolved = path.resolve(String(entry));
            const stats = actualLstatSync(entry);
            if (resolved === config || resolved.startsWith(`${config}${path.sep}`)) {
                return new Proxy(stats, {
                    get: (target, property, receiver) => property === 'dev'
                        ? stats.dev + 1
                        : Reflect.get(target, property, receiver)
                });
            }
            return stats;
        }) as typeof fs.lstatSync);

        QaapTenantPersistentHome.link(home, persistentHome);

        expect(fs.lstatSync(config).isDirectory()).to.equal(true);
        expect(fs.readFileSync(path.join(config, 'mounted-secret.json'), 'utf8')).to.equal('mounted');
        expect(fs.readFileSync(path.join(persistentHome, '.config', 'mounted-secret.json'), 'utf8')).to.equal('existing');
    });

    it('rejects a symlink in a persistent HOME root instead of operating through it', () => {
        const target = path.join(root, 'outside');
        fs.mkdirSync(target);
        fs.mkdirSync(path.dirname(persistentHome), { recursive: true });
        fs.symlinkSync(target, persistentHome);

        expect(() => QaapTenantPersistentHome.link(home, persistentHome)).to.throw(/symlink/i);
        expect(fs.readdirSync(target)).to.deep.equal([]);
    });
});
