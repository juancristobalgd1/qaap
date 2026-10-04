// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { IJSONSchema } from '@theia/core/lib/common/json-schema';
import URI from '@theia/core/lib/common/uri';
import { QaapLazyJsonSchemaDataStore } from './qaap-lazy-json-schema-data-store';

describe('QaapLazyJsonSchemaDataStore', () => {

    const uri = new URI('vscode://schemas/settings/user');

    function countingSchema(): { schema: IJSONSchema, reads: () => number } {
        let reads = 0;
        const schema = { type: 'object', toJSON: () => { reads++; return { type: 'object' }; } } as IJSONSchema;
        return { schema, reads: () => reads };
    }

    it('does not serialize on write and serializes the last written object once on read', () => {
        const store = new QaapLazyJsonSchemaDataStore();
        const first = countingSchema();
        const second = countingSchema();
        store.setSchema(uri, first.schema);
        store.setSchema(uri, second.schema);
        expect(first.reads()).to.equal(0);
        expect(second.reads()).to.equal(0);
        expect(store.hasSchema(uri)).to.equal(true);
        expect(store.getSchema(uri)).to.equal('{"type":"object"}');
        expect(store.getSchema(uri)).to.equal('{"type":"object"}');
        expect(first.reads()).to.equal(0);
        expect(second.reads()).to.equal(1);
    });

    it('reflects the schema state at read time, like a write right before the read', () => {
        const store = new QaapLazyJsonSchemaDataStore();
        const schema: IJSONSchema = { properties: {} };
        store.setSchema(uri, schema);
        schema.properties!.later = { type: 'string' };
        expect(JSON.parse(store.getSchema(uri)!)).to.deep.equal({ properties: { later: { type: 'string' } } });
    });

    it('replaces a cached string with a newer object and a pending object with a newer string', () => {
        const store = new QaapLazyJsonSchemaDataStore();
        store.setSchema(uri, { title: 'a' });
        expect(store.getSchema(uri)).to.equal('{"title":"a"}');
        store.setSchema(uri, { title: 'b' });
        expect(store.getSchema(uri)).to.equal('{"title":"b"}');
        store.setSchema(uri, { title: 'c' });
        store.setSchema(uri, 'raw');
        expect(store.getSchema(uri)).to.equal('raw');
    });

    it('notifies on every write and on delete of pending and serialized schemas', () => {
        const store = new QaapLazyJsonSchemaDataStore();
        const notified: string[] = [];
        store.onDidSchemaUpdate(changed => notified.push(changed.toString()));
        store.setSchema(uri, { title: 'a' });
        store.setSchema(uri, 'raw');
        store.deleteSchema(uri);
        store.setSchema(uri, { title: 'b' });
        store.deleteSchema(uri);
        store.deleteSchema(uri);
        expect(notified).to.have.length(5);
        expect(store.hasSchema(uri)).to.equal(false);
        expect(store.getSchema(uri)).to.equal(undefined);
    });
});
