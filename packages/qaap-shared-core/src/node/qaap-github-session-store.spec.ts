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
    sessionReads = 0;

    start(): this {
        this.init();
        return this;
    }

    /** Simulates the positive/negative sync TTL elapsing. */
    expireSyncCaches(): void {
        this.sessionCheckedAt.clear();
        this.missingSessions.clear();
        this.sessionsListSyncedAt = 0;
    }

    /** Simulates `ms` passing for an issued OAuth state (as stored in SQLite). */
    ageOAuthState(state: string, ms: number): void {
        const key = `oauth:${state}`;
        const store = this.getSqliteStore();
        const record = store.get<{ createdAt: number }>(key);
        if (record) {
            store.set(key, { ...record, createdAt: record.createdAt - ms });
        }
    }

    writeRawOAuthState(state: string, value: unknown): void {
        this.getSqliteStore().set(`oauth:${state}`, value);
    }

    /** Many simulated processes live in one test process: skip the process-level signal hooks. */
    protected override installShutdownHandlers(): void { }

    protected override readPersistedSession(key: string): ReturnType<QaapGithubSessionStore['readPersistedSession']> {
        this.sessionReads++;
        return super.readPersistedSession(key);
    }
}

const alice = { accessToken: 't', user: { provider: 'github' as const, login: 'alice', name: 'Alice' } };
const browserA = 'browser-a-binding';
const browserB = 'browser-b-binding';

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
        const state = processA.createOAuthState(browserA);
        expect(processB.consumeOAuthState(state, browserA).valid).to.equal(true);
        // Single use, also across processes.
        expect(processA.consumeOAuthState(state, browserA).valid).to.equal(false);
        expect(processB.consumeOAuthState(state, browserA).valid).to.equal(false);
    });

    it('rejects unknown and missing states', () => {
        const store = new TestGithubSessionStore().start();
        expect(store.consumeOAuthState(undefined, browserA)).to.deep.equal({ valid: false });
        expect(store.consumeOAuthState('not-a-state', browserA)).to.deep.equal({ valid: false });
    });

    it('completes a state issued before the backend restarted (deploy)', () => {
        const beforeRestart = new TestGithubSessionStore().start();
        const state = beforeRestart.createOAuthState(browserA);
        QaapSqliteConnectionRegistry.shared.closeUnder(dir);
        const afterRestart = new TestGithubSessionStore().start();
        expect(afterRestart.consumeOAuthState(state, browserA)).to.deep.equal({ valid: true, attempt: 1 });
    });

    it('keeps the states of several tabs of the same browser valid, in any order', () => {
        const store = new TestGithubSessionStore().start();
        const tab1 = store.createOAuthState(browserA);
        const tab2 = store.createOAuthState(browserA);
        expect(store.consumeOAuthState(tab2, browserA).valid).to.equal(true);
        expect(store.consumeOAuthState(tab1, browserA).valid).to.equal(true);
    });

    it('rejects a state presented by another browser, and burns it', () => {
        const store = new TestGithubSessionStore().start();
        const state = store.createOAuthState(browserA, 2);
        expect(store.consumeOAuthState(state, browserB)).to.deep.equal({ valid: false, attempt: 2 });
        expect(store.consumeOAuthState(state, undefined).valid).to.equal(false);
        expect(store.consumeOAuthState(state, browserA).valid).to.equal(false);
    });

    it('rejects an expired state', () => {
        const store = new TestGithubSessionStore().start();
        const state = store.createOAuthState(browserA);
        store.ageOAuthState(state, 11 * 60 * 1000);
        expect(store.consumeOAuthState(state, browserA)).to.deep.equal({ valid: false, attempt: 1 });
    });

    it('stores only a hash of the browser binding', () => {
        const store = new TestGithubSessionStore().start();
        store.createOAuthState(browserA);
        expect(fs.readdirSync(dir).some(name => fs.readFileSync(path.join(dir, name)).includes(browserA))).to.equal(false);
    });

    it('honours an unexpired unbound state written by the previous build, once', () => {
        const store = new TestGithubSessionStore().start();
        store.writeRawOAuthState('legacy', Date.now());
        store.writeRawOAuthState('legacy-expired', Date.now() - 11 * 60 * 1000);
        expect(store.consumeOAuthState('legacy', undefined).valid).to.equal(true);
        expect(store.consumeOAuthState('legacy', undefined).valid).to.equal(false);
        expect(store.consumeOAuthState('legacy-expired', undefined).valid).to.equal(false);
    });

    it('does not wipe keys written by another process when flushing', () => {
        const processA = new TestGithubSessionStore().start();
        const processB = new TestGithubSessionStore().start();
        const state = processA.createOAuthState(browserA);
        processB.createSession({ accessToken: 't', user: { provider: 'github', login: 'alice', name: 'Alice' } });
        processB.flushPendingPersist();
        const processC = new TestGithubSessionStore().start();
        expect(processC.listSessions().map(session => session.user.login)).to.deep.equal(['alice']);
        expect(processC.consumeOAuthState(state, browserA).valid).to.equal(true);
    });

    it('persists session deletion per key', () => {
        const store = new TestGithubSessionStore().start();
        const id = store.createSession({ accessToken: 't', user: { provider: 'github', login: 'bob', name: 'Bob' } });
        store.flushPendingPersist();
        store.deleteSession(id);
        store.flushPendingPersist();
        expect(new TestGithubSessionStore().start().getSession(id)).to.equal(undefined);
    });

    it('finds a session created by another process after this one started', () => {
        const processA = new TestGithubSessionStore().start();
        const processB = new TestGithubSessionStore().start();
        const id = processB.createSession(alice);
        processB.flushPendingPersist();
        expect(processA.getSession(id)?.user.login).to.equal('alice');
        // Cached afterwards: no extra SQLite read within the TTL.
        const reads = processA.sessionReads;
        expect(processA.getSession(id)?.user.login).to.equal('alice');
        expect(processA.sessionReads).to.equal(reads);
    });

    it('caches known-missing session ids briefly', () => {
        const store = new TestGithubSessionStore().start();
        expect(store.getSession('missing-id')).to.equal(undefined);
        expect(store.getSession('missing-id')).to.equal(undefined);
        expect(store.sessionReads).to.equal(1);
        store.expireSyncCaches();
        expect(store.getSession('missing-id')).to.equal(undefined);
        expect(store.sessionReads).to.equal(2);
    });

    it('propagates a logout from another process', () => {
        const processA = new TestGithubSessionStore().start();
        const id = processA.createSession(alice);
        processA.flushPendingPersist();
        const processB = new TestGithubSessionStore().start();
        expect(processB.getSession(id)?.user.login).to.equal('alice');
        // Process C never cached the session, but its logout must still reach SQLite.
        const processC = new TestGithubSessionStore();
        processC.start().deleteSession(id);
        processA.expireSyncCaches();
        processB.expireSyncCaches();
        expect(processA.getSession(id)).to.equal(undefined);
        expect(processB.getSession(id)).to.equal(undefined);
        expect(processB.listSessions()).to.deep.equal([]);
    });

    it('lists sessions created by another process once the sync TTL elapses', () => {
        const processA = new TestGithubSessionStore().start();
        const processB = new TestGithubSessionStore().start();
        processB.createSession(alice);
        processB.flushPendingPersist();
        processA.expireSyncCaches();
        expect(processA.listSessions().map(session => session.user.login)).to.deep.equal(['alice']);
    });

    it('keeps an unflushed local session visible', () => {
        const store = new TestGithubSessionStore().start();
        const id = store.createSession(alice);
        store.expireSyncCaches();
        expect(store.getSession(id)?.user.login).to.equal('alice');
        expect(store.listSessions()).to.have.length(1);
    });
});
