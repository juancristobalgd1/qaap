// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapProjectFolderTrustStore } from './qaap-project-folder-trust-store';

class TestProjectFolderTrustStore extends QaapProjectFolderTrustStore {
    constructor(protected readonly dbPath: string) {
        super();
    }
    protected override resolveDatabasePath(): string {
        return this.dbPath;
    }
}

describe('qaap project folder trust store', function (): void {
    this.timeout(10_000);

    let tempDir: string;
    let folder: string;
    let store: TestProjectFolderTrustStore;
    const savedSqlitePath = process.env.QAAP_SQLITE_STORE_PATH;

    beforeEach(() => {
        delete process.env.QAAP_SQLITE_STORE_PATH;
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-folder-trust-'));
        folder = path.join(tempDir, 'repo');
        fs.mkdirSync(folder, { recursive: true });
        store = new TestProjectFolderTrustStore(path.join(tempDir, 'state', 'project-folder-trust.sqlite'));
    });

    afterEach(() => {
        if (savedSqlitePath === undefined) {
            delete process.env.QAAP_SQLITE_STORE_PATH;
        } else {
            process.env.QAAP_SQLITE_STORE_PATH = savedSqlitePath;
        }
        QaapSqliteConnectionRegistry.shared.closeUnder(tempDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('treats an undecided folder as not trusted', () => {
        expect(store.get('alice', folder)).to.equal(undefined);
        expect(store.isTrusted('alice', folder)).to.be.false;
    });

    it('records an explicit trust decision for the owner', () => {
        store.record('alice', folder, true);
        expect(store.isTrusted('alice', folder)).to.be.true;
        expect(store.get('alice', folder)?.trusted).to.be.true;
    });

    it('records an explicit "Don\'t trust" as a decision that is not trusted', () => {
        store.record('alice', folder, false);
        expect(store.get('alice', folder)).to.not.equal(undefined);
        expect(store.isTrusted('alice', folder)).to.be.false;
    });

    it('never lets one owner read or change another owner decision', () => {
        store.record('alice', folder, true);
        expect(store.isTrusted('bob', folder)).to.be.false;
        store.record('bob', folder, false);
        expect(store.isTrusted('alice', folder)).to.be.true;
    });

    it('keys the decision by the canonical folder path', () => {
        store.record('alice', folder, true);
        expect(store.isTrusted('alice', `${folder}${path.sep}`)).to.be.true;
        expect(store.isTrusted('alice', path.join(folder, '..', 'repo'))).to.be.true;
    });
});
