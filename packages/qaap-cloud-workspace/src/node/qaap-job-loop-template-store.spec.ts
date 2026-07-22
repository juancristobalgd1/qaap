// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapCreateJobLoopTemplateRequest } from '../common/qaap-job-loop-template';
import {
    QaapJobLoopTemplateConflictError,
    QaapJobLoopTemplateStore,
} from './qaap-job-loop-template-store';

const request = (name = 'Raise score'): QaapCreateJobLoopTemplateRequest => ({
    name,
    description: 'Reusable score improvement loop',
    definition: {
        title: 'Raise score',
        graph: { nodes: [{ key: 'measure', request: { command: 'measure-score', cwd: 'org/repo' } }] },
        until: { nodeKey: 'measure', pointer: '/score', operator: 'greater_or_equal', expected: 90 },
        maxIterations: 3,
    },
});

class TestStore extends QaapJobLoopTemplateStore {
    constructor(protected readonly testDirectory: string) { super(); }
    initialize(): void { this.init(); }
    protected override storeDirectory(): string { return this.testDirectory; }
}

describe('QaapJobLoopTemplateStore', () => {
    let directory: string;
    let store: TestStore;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-loop-templates-'));
        store = new TestStore(directory);
        store.initialize();
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('isolates templates by owner and deep-clones definitions at the boundary', async () => {
        const created = await store.create(request(), 'alice');
        (created.definition.graph.nodes[0].request as { command?: string }).command = 'mutated';

        expect(store.list('bob')).to.deep.equal([]);
        expect((store.get('alice', created.id)?.definition.graph.nodes[0].request as { command?: string }).command).to.equal('measure-score');
        expect(store.get('bob', created.id)).to.equal(undefined);
    });

    it('enforces case-insensitive names and optimistic revisions', async () => {
        const created = await store.create(request(), 'alice');
        let duplicate: unknown;
        try { await store.create(request('raise SCORE'), 'alice'); } catch (error) { duplicate = error; }
        expect(duplicate).to.be.instanceOf(QaapJobLoopTemplateConflictError);

        const updated = await store.update(created.id, { revision: created.revision, description: 'Updated' }, 'alice');
        expect(updated).to.include({ revision: 2, description: 'Updated' });
        let stale: unknown;
        try { await store.update(created.id, { revision: 1, name: 'Other' }, 'alice'); } catch (error) { stale = error; }
        expect(stale).to.be.instanceOf(QaapJobLoopTemplateConflictError);
    });

    it('persists portable exports without tenant or lifecycle fields', async () => {
        const created = await store.create(request(), 'alice');
        const exported = store.export('alice', created.id)!;
        expect(exported).to.have.nested.property('template.name', 'Raise score');
        expect(exported).not.to.have.any.keys('id', 'ownerLogin', 'createdAt', 'updatedAt', 'revision');

        const restored = new TestStore(directory);
        restored.initialize();
        expect(restored.get('alice', created.id)?.name).to.equal(created.name);
        const imported = await restored.import({ document: exported }, 'bob');
        expect(imported.template.ownerLogin).to.equal('bob');
        expect(imported.template.id).not.to.equal(created.id);
    });

    it('refreshes a warm replica from a shared template state directory', async () => {
        const warmReplica = new TestStore(directory);
        warmReplica.initialize();

        const created = await store.create(request('Shared template'), 'alice');

        expect(warmReplica.get('alice', created.id)?.name).to.equal('Shared template');
    });
});
