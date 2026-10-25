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

/** An error shaped like the one a backend without CAP_CHOWN gets from chown. */
function accessRefused(): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = new Error('EPERM: operation not permitted, chown');
    error.code = 'EPERM';
    return error;
}

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

    describe('without CAP_CHOWN', () => {
        const owner = { uid: 1001, gid: 1001 };

        afterEach(() => {
            sinon.restore();
        });

        it('grants the agent uid an ACL on HOME and keeps linking the other entries when chown is refused', () => {
            sinon.stub(fs, 'chownSync').throws(accessRefused());
            sinon.stub(fs, 'lchownSync').throws(accessRefused());
            const grant = sinon.spy();

            QaapTenantPersistentHome.link(home, persistentHome, owner, grant);

            expect(grant.calledWith(home, true)).to.equal(true);
            expect(grant.calledWith(persistentHome, true)).to.equal(true);
            expect(fs.readlinkSync(path.join(home, '.claude'))).to.equal(path.join(persistentHome, '.claude'));
            expect(fs.readlinkSync(path.join(home, '.claude.json'))).to.equal(path.join(persistentHome, '.claude.json'));
        });

        it('grants the moved state a directory and file ACL when its owner cannot be changed', () => {
            fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
            fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), 'tmpfs');
            sinon.stub(fs, 'chownSync').throws(accessRefused());
            sinon.stub(fs, 'lchownSync').throws(accessRefused());
            const grant = sinon.spy();

            QaapTenantPersistentHome.link(home, persistentHome, owner, grant);

            expect(grant.calledWith(path.join(persistentHome, '.gemini'), true)).to.equal(true);
            expect(grant.calledWith(path.join(persistentHome, '.gemini', 'oauth_creds.json'), false)).to.equal(true);
            expect(fs.readFileSync(path.join(persistentHome, '.gemini', 'oauth_creds.json'), 'utf8')).to.equal('tmpfs');
        });

        it('continues with the remaining entries when one ACL grant fails, and reports it once as a warning', () => {
            sinon.stub(fs, 'chownSync').throws(accessRefused());
            sinon.stub(fs, 'lchownSync').throws(accessRefused());
            const warn = sinon.stub(console, 'warn');
            const grant = sinon.spy((entry: string) => {
                if (entry === path.join(persistentHome, '.codex')) {
                    throw new Error('setfacl: no space left on device');
                }
            });

            expect(() => QaapTenantPersistentHome.link(home, persistentHome, owner, grant)).not.to.throw();
            expect(warn.calledOnce).to.equal(true);
            expect(String(warn.firstCall.args[0])).to.include('could not link 1 agent sign-in entries').and.to.include('no space left on device');
            expect(fs.lstatSync(path.join(home, '.codex'), { throwIfNoEntry: false })).to.equal(undefined);
            expect(fs.readlinkSync(path.join(home, '.claude'))).to.equal(path.join(persistentHome, '.claude'));
            expect(fs.readlinkSync(path.join(home, '.gemini'))).to.equal(path.join(persistentHome, '.gemini'));
        });

        it('throws so the caller retries when HOME itself cannot be made accessible', () => {
            sinon.stub(fs, 'chownSync').throws(accessRefused());
            const grant = sinon.spy((entry: string) => {
                if (entry === home) {
                    throw new Error('setfacl: Operation not supported');
                }
            });

            expect(() => QaapTenantPersistentHome.link(home, persistentHome, owner, grant))
                .to.throw(/Could not prepare agent sign-in storage for .*Operation not supported/);
        });

        it('grants access to an existing root-owned HOME, not only to directories it creates', () => {
            fs.mkdirSync(home, { recursive: true, mode: 0o700 });
            sinon.stub(fs, 'chownSync').throws(accessRefused());
            sinon.stub(fs, 'lchownSync').throws(accessRefused());
            const grant = sinon.spy();

            QaapTenantPersistentHome.link(home, persistentHome, owner, grant);

            expect(grant.calledWith(home, true)).to.equal(true);
            expect(grant.calledWith(persistentHome, true)).to.equal(true);
            // The volatile HOME is only prepared itself: its existing children are not walked.
            expect(grant.calledWith(path.join(home, '.claude'), true)).to.equal(false);
        });

        it('ignores a refused lchown on the symlink itself, since access follows its target', () => {
            sinon.stub(fs, 'lchownSync').throws(accessRefused());
            const grant = sinon.spy();

            QaapTenantPersistentHome.link(home, persistentHome, { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }, grant);

            expect(fs.lstatSync(path.join(home, '.claude')).isSymbolicLink()).to.equal(true);
            expect(grant.calledWith(path.join(home, '.claude'))).to.equal(false);
        });

        it('does not grant ACLs when chown works', () => {
            const grant = sinon.spy();

            QaapTenantPersistentHome.link(home, persistentHome, { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }, grant);

            expect(grant.called).to.equal(false);
            expect(fs.lstatSync(path.join(home, '.claude')).isSymbolicLink()).to.equal(true);
        });
    });
});
