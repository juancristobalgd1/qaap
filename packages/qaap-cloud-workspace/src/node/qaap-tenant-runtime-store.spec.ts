// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry, QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapTenantRuntimeRecord, QaapTenantRuntimeStore } from './qaap-tenant-runtime-store';

class TestRuntimeStore extends QaapTenantRuntimeStore {
    sqliteWrites = 0;

    constructor(protected readonly databasePath: string, intervalMs: number) {
        super();
        this.touchPersistIntervalMs = intervalMs;
    }

    persisted(login: string): QaapTenantRuntimeRecord | undefined {
        return this.getStore().get<QaapTenantRuntimeRecord>(login);
    }

    pendingFlushTimers(): number {
        return this.flushTimers.size;
    }

    protected override getStore(): QaapSqliteStore {
        if (!this.sqliteStore) {
            const store = new QaapSqliteStore({ databasePath: this.databasePath, namespace: 'tenant-runtime' });
            const set = store.set.bind(store);
            store.set = <T>(key: string, value: T): void => {
                this.sqliteWrites++;
                set(key, value);
            };
            this.sqliteStore = store;
        }
        return this.sqliteStore;
    }
}

describe('QaapTenantRuntimeStore touch cache', () => {
    let dir: string;
    let stores: TestRuntimeStore[];

    const create = (intervalMs = 60_000): TestRuntimeStore => {
        const store = new TestRuntimeStore(path.join(dir, 'runtime.sqlite'), intervalMs);
        stores.push(store);
        return store;
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-tenant-runtime-'));
        stores = [];
    });

    afterEach(() => {
        for (const store of stores) {
            store.dispose();
        }
        QaapSqliteConnectionRegistry.shared.closeUnder(dir);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('persists the first touch, then throttles pure activity touches but serves them from memory', () => {
        const store = create();
        store.touch('Alice', 'user', 1_000);
        expect(store.sqliteWrites).to.equal(1);
        store.touch('alice', 'websocket', 2_000);
        store.touch('ALICE', 'terminal', 3_000);
        expect(store.sqliteWrites).to.equal(1);
        expect(store.get('alice')?.lastActivityAt).to.equal(new Date(3_000).toISOString());
        expect(store.get('alice')?.lastActivityReason).to.equal('terminal');
        expect(store.persisted('alice')?.lastActivityAt).to.equal(new Date(1_000).toISOString());
        // Every reader (reaper included) goes through get/list and sees the fresh value.
        expect(store.list().find(record => record.tenantLogin === 'alice')?.lastActivityAt).to.equal(new Date(3_000).toISOString());
        expect(store.pendingFlushTimers()).to.equal(1);
    });

    it('flush()/dispose() write the pending touch', () => {
        const store = create();
        store.touch('alice', 'user', 1_000);
        store.touch('alice', 'user', 5_000);
        store.dispose();
        expect(store.persisted('alice')?.lastActivityAt).to.equal(new Date(5_000).toISOString());
        expect(store.pendingFlushTimers()).to.equal(0);
        const writes = store.sqliteWrites;
        store.flush();
        expect(store.sqliteWrites).to.equal(writes);
    });

    it('persists immediately when a touch changes state (idle -> active)', () => {
        const store = create();
        store.setState('alice', 'idle', { idleSince: new Date(500).toISOString() }, 500);
        const writes = store.sqliteWrites;
        store.touch('alice', 'user', 1_000);
        expect(store.sqliteWrites).to.equal(writes + 1);
        const persisted = store.persisted('alice');
        expect(persisted?.state).to.equal('active');
        expect(persisted?.idleSince).to.equal(undefined);
    });

    it('setState persists immediately and carries the latest cached activity', () => {
        const store = create();
        store.touch('alice', 'user', 1_000);
        store.touch('alice', 'user', 9_000);
        store.setState('alice', 'stopped', { stoppedAt: new Date(10_000).toISOString() }, 10_000);
        const persisted = store.persisted('alice');
        expect(persisted?.state).to.equal('stopped');
        expect(persisted?.lastActivityAt).to.equal(new Date(9_000).toISOString());
        expect(store.pendingFlushTimers()).to.equal(0);
    });

    it('writes again once the interval has elapsed', () => {
        const store = create(0);
        store.touch('alice', 'user', 1_000);
        store.touch('alice', 'user', 2_000);
        expect(store.sqliteWrites).to.equal(2);
        expect(store.persisted('alice')?.lastActivityAt).to.equal(new Date(2_000).toISOString());
    });

    it('flushes a throttled touch with a trailing timer', async () => {
        const store = create(40);
        store.touch('alice', 'user', 1_000);
        store.touch('alice', 'user', 2_000);
        expect(store.persisted('alice')?.lastActivityAt).to.equal(new Date(1_000).toISOString());
        // Slow CI runners (Windows) can fire the 40 ms timer late; wait for it instead of a fixed sleep.
        const deadline = Date.now() + 5_000;
        while (store.pendingFlushTimers() > 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(store.persisted('alice')?.lastActivityAt).to.equal(new Date(2_000).toISOString());
        expect(store.pendingFlushTimers()).to.equal(0);
    });

    it('reads through to SQLite for records written before this instance started', () => {
        const writer = create();
        writer.setState('bob', 'active', { workerContainerId: 'w1' }, 1_000);
        const reader = create();
        expect(reader.get('Bob')?.workerContainerId).to.equal('w1');
        expect(reader.list().map(record => record.tenantLogin)).to.deep.equal(['bob']);
    });
});
