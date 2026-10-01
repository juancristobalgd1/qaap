// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapGithubSessionStore } from './qaap-github-session-store';

/** Simulates one backend process (main or tenant) loading the shared store. */
class TestGithubSessionStore extends QaapGithubSessionStore {
    start(): this {
        this.init();
        return this;
    }
}

describe('QaapGithubSessionStore (shared SQLite file across backends)', () => {
    let dir: string;
    let previousStorePath: string | undefined;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-auth-store-'));
        previousStorePath = process.env.QAAP_AUTH_STORE_PATH;
        process.env.QAAP_AUTH_STORE_PATH = path.join(dir, 'sessions.json');
    });

    afterEach(() => {
        if (previousStorePath === undefined) {
            delete process.env.QAAP_AUTH_STORE_PATH;
        } else {
            process.env.QAAP_AUTH_STORE_PATH = previousStorePath;
        }
        QaapSqliteConnectionRegistry.shared.closeUnder(dir);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('consumes an OAuth state created by another process sharing the store', () => {
        const processA = new TestGithubSessionStore().start();
        const processB = new TestGithubSessionStore().start();
        const state = processA.createOAuthState();
        expect(processB.consumeOAuthState(state)).to.equal(true);
        // Single use, also across processes.
        expect(processA.consumeOAuthState(state)).to.equal(false);
        expect(processB.consumeOAuthState(state)).to.equal(false);
    });

    it('rejects unknown and missing states', () => {
        const store = new TestGithubSessionStore().start();
        expect(store.consumeOAuthState(undefined)).to.equal(false);
        expect(store.consumeOAuthState('not-a-state')).to.equal(false);
    });

    it('does not wipe keys written by another process when flushing', () => {
        const processA = new TestGithubSessionStore().start();
        const processB = new TestGithubSessionStore().start();
        const state = processA.createOAuthState();
        processB.createSession({ accessToken: 't', user: { provider: 'github', login: 'alice', name: 'Alice' } });
        processB.flushPendingPersist();
        const processC = new TestGithubSessionStore().start();
        expect(processC.listSessions().map(session => session.user.login)).to.deep.equal(['alice']);
        expect(processC.consumeOAuthState(state)).to.equal(true);
    });

    it('persists session deletion per key', () => {
        const store = new TestGithubSessionStore().start();
        const id = store.createSession({ accessToken: 't', user: { provider: 'github', login: 'bob', name: 'Bob' } });
        store.flushPendingPersist();
        store.deleteSession(id);
        store.flushPendingPersist();
        expect(new TestGithubSessionStore().start().getSession(id)).to.equal(undefined);
    });
});
