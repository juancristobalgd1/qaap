// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { QaapSqliteConnectionRegistry, QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapJsonArrayElementSplitter, forEachLegacyAggregateElement } from './qaap-conversation-legacy-aggregate';

const TRICKY = [
    { id: 'plain' },
    { id: 'brackets in strings', text: ']}[{ "quoted" \\" and \\\\', nested: { list: [1, [2, { deep: '}' }]] } },
    { id: 'unicode', text: 'ñandú 🦤 \u2028 end' },
];

function split(text: string, pieceLength: number): string[] {
    const splitter = new QaapJsonArrayElementSplitter();
    const elements: string[] = [];
    for (let start = 0; start < text.length; start += pieceLength) {
        elements.push(...splitter.push(text.slice(start, start + pieceLength)));
    }
    splitter.end();
    return elements;
}

describe('QaapJsonArrayElementSplitter', () => {
    for (const pieceLength of [1, 2, 3, 7, 64, 100_000]) {
        it(`splits an array cut every ${pieceLength} character(s)`, () => {
            const elements = split(JSON.stringify(TRICKY), pieceLength);
            expect(elements.map(element => JSON.parse(element))).to.deep.equal(TRICKY);
        });
    }

    it('accepts whitespace between the elements and an empty array', () => {
        expect(split(' [ {"a":1} ,\n {"b":2} ] \n', 4)).to.deep.equal(['{"a":1}', '{"b":2}']);
        expect(split('[]', 1)).to.deep.equal([]);
    });

    for (const [name, text] of [
        ['a row that stops inside an element', '[{"id":"a"},{"id":'],
        ['a row that stops after an element', '[{"id":"a"}'],
        ['an empty row', ''],
    ]) {
        it(`reports ${name} at the end`, () => {
            expect(() => split(text, 3)).to.throw('ended early');
        });
    }

    for (const [name, text] of [
        ['a row that is not an array', '{"id":"a"}'],
        ['a non-object element', '[1,2]'],
        ['a trailing comma', '[{"a":1},]'],
        ['a missing comma', '[{"a":1}{"b":2}]'],
        ['text after the array', '[{"a":1}]x'],
        ['unbalanced closers', '[{"a":1}}]'],
    ]) {
        it(`rejects ${name}`, () => {
            expect(() => split(text, 3)).to.throw();
        });
    }
});

describe('forEachLegacyAggregateElement', () => {
    let directory: string;
    let store: QaapSqliteStore;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-legacy-aggregate-'));
        store = new QaapSqliteStore({ databasePath: path.join(directory, 'index.sqlite'), namespace: 'legacy' });
    });

    afterEach(() => {
        QaapSqliteConnectionRegistry.shared.closeUnder(directory);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    for (const chunkChars of [1, 5, 64, 1024]) {
        it(`walks a stored row in chunks of ${chunkChars} character(s)`, () => {
            store.set('conversations', TRICKY);
            const seen: unknown[] = [];
            expect(forEachLegacyAggregateElement(store, 'conversations', raw => seen.push(JSON.parse(raw)), chunkChars)).to.equal(TRICKY.length);
            expect(seen).to.deep.equal(TRICKY);
        });
    }

    it('finishes a row whose length is an exact multiple of the chunk', () => {
        const text = JSON.stringify(TRICKY);
        store.applyRawBatch([['conversations', text]], []);
        expect(forEachLegacyAggregateElement(store, 'conversations', () => undefined, text.length)).to.equal(TRICKY.length);
    });

    it('reports nothing for a missing key', () => {
        expect(forEachLegacyAggregateElement(store, 'conversations', () => { throw new Error('unexpected'); })).to.equal(0);
    });
});
