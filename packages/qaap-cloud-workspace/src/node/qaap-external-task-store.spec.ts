// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QAAP_EXTERNAL_TASK_DELIVERY_TTL_MS, QaapExternalTaskStore } from './qaap-external-task-store';

class SpecExternalTaskStore extends QaapExternalTaskStore {
    constructor(protected readonly file: string) {
        super();
    }
    protected override databasePath(): string {
        return this.file;
    }
}

describe('QaapExternalTaskStore', () => {
    let dir: string;
    let store: SpecExternalTaskStore;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-external-task-store-'));
        store = new SpecExternalTaskStore(path.join(dir, 'nested', 'store.sqlite'));
    });

    afterEach(() => {
        store.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('claims a delivery once and again after the TTL', () => {
        const now = 1_000_000;
        expect(store.claimDelivery('d1', now)).to.equal(true);
        expect(store.claimDelivery('d1', now + 1000)).to.equal(false);
        expect(store.claimDelivery('d2', now + 1000)).to.equal(true);
        expect(store.claimDelivery('d1', now + QAAP_EXTERNAL_TASK_DELIVERY_TTL_MS)).to.equal(true);
    });

    it('binds, looks up and unbinds an issue', () => {
        expect(store.conversationForIssue('github', 99, 7)).to.equal(undefined);
        expect(store.bindIssue('github', 99, 7, 'c1')).to.equal(true);
        expect(store.bindIssue('github', 99, 7, 'c1')).to.equal(true);
        expect(store.conversationForIssue('github', 99, 7)).to.equal('c1');
        expect(store.conversationForIssue('github', 99, 8)).to.equal(undefined);
        store.unbindIssue('github', 99, 7);
        expect(store.conversationForIssue('github', 99, 7)).to.equal(undefined);
    });

    it('refuses to bind an issue held by another conversation', () => {
        expect(store.bindIssue('github', 99, 7, 'c1')).to.equal(true);
        expect(store.bindIssue('github', 99, 7, 'c2')).to.equal(false);
        expect(store.conversationForIssue('github', 99, 7)).to.equal('c1');
    });

    it('marks each status notified once', () => {
        expect(store.markNotified('c1', 'started')).to.equal(true);
        expect(store.markNotified('c1', 'started')).to.equal(false);
        expect(store.markNotified('c1', 'failed')).to.equal(true);
        expect(store.markNotified('c2', 'started')).to.equal(true);
    });
});
