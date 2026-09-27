// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { QAAP_SQLITE_SCHEMA_VERSION, QaapSqliteStore } from './qaap-sqlite-store';

function userVersion(databasePath: string): number {
    const database = new DatabaseSync(databasePath);
    try {
        return (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    } finally {
        database.close();
    }
}

describe('QaapSqliteStore', () => {
    let directory: string;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-sqlite-store-'));
    });

    afterEach(() => {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it('uses WAL and preserves values across a reopen', () => {
        const databasePath = path.join(directory, 'state.sqlite');
        const store = new QaapSqliteStore({ databasePath, namespace: 'test' });
        store.set('one', { value: 1 });
        store.replace([['two', { value: 2 }]]);

        const database = new DatabaseSync(databasePath);
        expect((database.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode)
            .to.equal('wal');
        expect(database.prepare('SELECT value FROM qaap_kv WHERE namespace = ? AND key = ?').get('test', 'two'))
            .to.deep.equal({ value: '{"value":2}' });
        database.close();
    });

    it('imports a legacy JSON file once and keeps the source untouched', () => {
        const legacyPath = path.join(directory, 'legacy.json');
        const databasePath = path.join(directory, 'state.sqlite');
        fs.writeFileSync(legacyPath, JSON.stringify({ alpha: { answer: 42 } }), 'utf8');
        const store = new QaapSqliteStore({ databasePath, namespace: 'legacy', legacyPath });

        store.migrateLegacy<{ answer: number }>(raw => Object.entries(JSON.parse(raw)));
        expect(store.get<{ answer: number }>('alpha')).to.deep.equal({ answer: 42 });
        expect(fs.readFileSync(legacyPath, 'utf8')).to.equal('{"alpha":{"answer":42}}');
    });

    describe('schema versioning', () => {
        it('stamps a new database with the current schema version', () => {
            const databasePath = path.join(directory, 'state.sqlite');
            new QaapSqliteStore({ databasePath, namespace: 'test' }).set('k', 1);
            expect(userVersion(databasePath)).to.equal(QAAP_SQLITE_SCHEMA_VERSION);
        });

        it('adopts a pre-versioning database (user_version 0, tables present) without losing rows', () => {
            const databasePath = path.join(directory, 'legacy.sqlite');
            const seed = new DatabaseSync(databasePath);
            seed.exec(`
                CREATE TABLE qaap_kv (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL, PRIMARY KEY (namespace, key)) WITHOUT ROWID;
                CREATE TABLE qaap_migration (namespace TEXT PRIMARY KEY, source_path TEXT NOT NULL,
                    migrated_at INTEGER NOT NULL) WITHOUT ROWID;
                INSERT INTO qaap_kv VALUES ('test', 'kept', '{"n":7}', 1);
            `);
            seed.close();
            expect(userVersion(databasePath)).to.equal(0);

            const store = new QaapSqliteStore({ databasePath, namespace: 'test' });
            expect(store.get<{ n: number }>('kept')).to.deep.equal({ n: 7 });
            expect(userVersion(databasePath)).to.equal(QAAP_SQLITE_SCHEMA_VERSION);
        });

        it('refuses a database created by a newer build', () => {
            const databasePath = path.join(directory, 'newer.sqlite');
            const seed = new DatabaseSync(databasePath);
            seed.exec(`PRAGMA user_version = ${QAAP_SQLITE_SCHEMA_VERSION + 1}`);
            seed.close();
            expect(() => new QaapSqliteStore({ databasePath, namespace: 'test' })).to.throw(/newer than this build supports/);
            expect(userVersion(databasePath)).to.equal(QAAP_SQLITE_SCHEMA_VERSION + 1);
        });
    });

    describe('transactions', () => {
        it('rolls back a failed transaction and keeps the store usable', () => {
            const store = new QaapSqliteStore({ databasePath: path.join(directory, 'state.sqlite'), namespace: 'test' });
            store.set('stable', 1);
            expect(() => store.withTransaction(() => {
                store.set('lost', 2);
                throw new Error('boom');
            })).to.throw('boom');
            expect(store.get('lost')).to.equal(undefined);
            store.set('after', 3);
            expect(store.list<number>()).to.deep.equal([['after', 3], ['stable', 1]]);
        });

        it('supports nested transactions: an inner failure rolls back only the inner work', () => {
            const store = new QaapSqliteStore({ databasePath: path.join(directory, 'state.sqlite'), namespace: 'test' });
            store.withTransaction(() => {
                store.set('outer', 1);
                expect(() => store.withTransaction(() => {
                    store.set('inner', 2);
                    throw new Error('inner failed');
                })).to.throw('inner failed');
                store.withTransaction(() => store.set('inner-ok', 3));
            });
            expect(store.list<number>()).to.deep.equal([['inner-ok', 3], ['outer', 1]]);
        });

        it('replace() inside a transaction commits with the outer transaction', () => {
            const store = new QaapSqliteStore({ databasePath: path.join(directory, 'state.sqlite'), namespace: 'test' });
            store.set('old', 0);
            expect(() => store.withTransaction(() => {
                store.replace([['new', 1]]);
                throw new Error('abort');
            })).to.throw('abort');
            expect(store.list<number>()).to.deep.equal([['old', 0]]);
        });
    });

    it('leaves no open handle after an operation, so the directory can be removed on every platform', () => {
        const store = new QaapSqliteStore({ databasePath: path.join(directory, 'state.sqlite'), namespace: 'test' });
        store.set('k', 1);
        store.withTransaction(() => store.set('k2', 2));
        fs.rmSync(directory, { recursive: true, force: true });
        expect(fs.existsSync(directory)).to.equal(false);
    });
});
