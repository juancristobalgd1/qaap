// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapProjectResourcesStore } from './qaap-project-resources-store';

describe('QaapProjectResourcesStore', () => {
    let tmpDir: string;
    let savedPath: string | undefined;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-project-resources-'));
        savedPath = process.env.QAAP_PROJECT_RESOURCES_STORE_PATH;
        process.env.QAAP_PROJECT_RESOURCES_STORE_PATH = path.join(tmpDir, 'project-resources.json');
    });

    afterEach(() => {
        QaapSqliteConnectionRegistry.shared.closeUnder(tmpDir);
        if (savedPath === undefined) {
            delete process.env.QAAP_PROJECT_RESOURCES_STORE_PATH;
        } else {
            process.env.QAAP_PROJECT_RESOURCES_STORE_PATH = savedPath;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('stores one memory choice per owner and repository, case-insensitively', () => {
        const store = new QaapProjectResourcesStore();
        store.set('Alice', 'Acme/Web', 4);
        expect(store.get('alice', 'acme/web')?.memoryGb).to.equal(4);
        expect(store.get('alice', 'acme/other')).to.equal(undefined);
        expect(store.get('bob', 'acme/web')).to.equal(undefined);
    });

    it('lists only the choices of the requested owner', () => {
        const store = new QaapProjectResourcesStore();
        store.set('alice', 'acme/web', 2);
        store.set('alice', 'acme/api', 4);
        store.set('alicia', 'acme/web', 4);
        const listed = store.listForOwner('alice').map(choice => choice.repo).sort();
        expect(listed).to.deep.equal(['acme/api', 'acme/web']);
    });

    it('survives a reopen of the store', () => {
        new QaapProjectResourcesStore().set('alice', 'acme/web', 4);
        QaapSqliteConnectionRegistry.shared.closeUnder(tmpDir);
        expect(new QaapProjectResourcesStore().get('alice', 'acme/web')?.memoryGb).to.equal(4);
    });

    it('normalizes repositories and rejects anything but owner/name', () => {
        expect(QaapProjectResourcesStore.normalizeRepo(' Acme/Web.js ')).to.equal('acme/web.js');
        expect(QaapProjectResourcesStore.normalizeRepo('acme')).to.equal(undefined);
        expect(QaapProjectResourcesStore.normalizeRepo('acme/..')).to.equal(undefined);
        expect(QaapProjectResourcesStore.normalizeRepo('a/b/c')).to.equal(undefined);
        expect(QaapProjectResourcesStore.normalizeRepo(undefined)).to.equal(undefined);
    });
});
