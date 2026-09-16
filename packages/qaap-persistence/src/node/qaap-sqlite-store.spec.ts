// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { QaapSqliteStore } from './qaap-sqlite-store';

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
});
