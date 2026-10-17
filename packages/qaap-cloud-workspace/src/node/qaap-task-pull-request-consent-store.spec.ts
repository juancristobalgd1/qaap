// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapTaskPullRequestConsentStore } from './qaap-task-pull-request-consent-store';

class SpecConsentStore extends QaapTaskPullRequestConsentStore {
    constructor(protected readonly file: string) {
        super();
    }
    protected override databasePath(): string {
        return this.file;
    }
}

describe('QaapTaskPullRequestConsentStore', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-task-pr-consent-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('records one consent per user and repository and survives a new instance', () => {
        const file = path.join(dir, 'nested', 'consent.sqlite');
        const store = new SpecConsentStore(file);
        expect(store.isAllowed('alice', 'acme', 'demo')).to.equal(false);
        store.allow('Alice', 'Acme', 'Demo');
        expect(store.isAllowed('alice', 'acme', 'demo')).to.equal(true);
        expect(store.isAllowed('bob', 'acme', 'demo')).to.equal(false);
        expect(store.isAllowed('alice', 'acme', 'other')).to.equal(false);
        store.close();
        const reopened = new SpecConsentStore(file);
        expect(reopened.isAllowed('alice', 'acme', 'demo')).to.equal(true);
        reopened.revoke('alice', 'acme', 'demo');
        expect(reopened.isAllowed('alice', 'acme', 'demo')).to.equal(false);
        reopened.close();
    });
});
