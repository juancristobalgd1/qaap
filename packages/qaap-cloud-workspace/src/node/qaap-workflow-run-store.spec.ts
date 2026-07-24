// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildImplementThenReviewWorkflow, type QaapWorkflowDef } from '../common/qaap-workflow-ir';
import { QaapWorkflowRunRequestError, QaapWorkflowRunStore } from './qaap-workflow-run-store';

class TestStore extends QaapWorkflowRunStore {
    constructor(protected readonly testDirectory: string) { super(); }
    initialize(): void { this.init(); }
    protected override storeDirectory(): string { return this.testDirectory; }
}

describe('QaapWorkflowRunStore', () => {
    let directory: string;
    let store: TestStore;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-workflow-runs-'));
        store = new TestStore(directory);
        store.initialize();
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('starts a run and returns the entry node to dispatch', async () => {
        const started = await store.start(buildImplementThenReviewWorkflow(), 'Ada');
        expect(started.dispatch).to.deep.equal(['implement']);
        expect(started.record.run.status).to.equal('running');
        expect(started.record.ownerLogin).to.equal('ada');
    });

    it('rejects an invalid definition before persisting anything', async () => {
        const invalid: QaapWorkflowDef = {
            id: 'bad', version: 1, name: 'Bad', entry: 'missing', nodes: [], edges: [],
        };
        await store.start(invalid, 'ada').then(
            () => expect.fail('expected the invalid definition to be rejected'),
            error => expect(error).to.be.instanceOf(QaapWorkflowRunRequestError),
        );
        expect(store.list('ada')).to.deep.equal([]);
    });

    it('advances the run across reports and records the emitted binding', async () => {
        const started = await store.start(buildImplementThenReviewWorkflow(), 'ada');
        const id = started.record.run.id;
        expect((await store.report('ada', id, 'implement', 'success')).dispatch).to.deep.equal(['risk-classify']);
        expect((await store.report('ada', id, 'risk-classify', 'risk:high')).dispatch).to.deep.equal(['git-diff']);
        expect((await store.report('ada', id, 'git-diff', 'success')).dispatch).to.deep.equal(['judge']);

        const final = await store.report('ada', id, 'judge', 'verdict:pass', 'artifacts/review.json');
        expect(final.record.run.status).to.equal('succeeded');
        expect(final.record.run.bindings).to.deep.equal({ 'review.passed': 'artifacts/review.json' });
    });

    it('ignores a duplicate report for a node that already finished', async () => {
        const started = await store.start(buildImplementThenReviewWorkflow(), 'ada');
        const id = started.record.run.id;
        await store.report('ada', id, 'implement', 'success');
        const duplicate = await store.report('ada', id, 'implement', 'success');
        expect(duplicate.dispatch).to.deep.equal([]);
        expect(duplicate.record.run.active).to.deep.equal(['risk-classify']);
    });

    it('routes an interrupted node through the graph failure edges', async () => {
        const started = await store.start(buildImplementThenReviewWorkflow(), 'ada');
        const id = started.record.run.id;
        const interrupted = await store.interrupt('ada', id, 'implement');
        expect(interrupted.record.run.status).to.equal('failed');
        expect(interrupted.record.run.bindings).to.have.property('review.skipped');
    });

    it('keeps runs owner-scoped', async () => {
        const started = await store.start(buildImplementThenReviewWorkflow(), 'ada');
        const id = started.record.run.id;
        expect(store.get('grace', id)).to.equal(undefined);
        expect(store.list('grace')).to.deep.equal([]);
        await store.report('grace', id, 'implement', 'success').then(
            () => expect.fail('expected a foreign owner to be rejected'),
            error => expect(error).to.be.instanceOf(QaapWorkflowRunRequestError),
        );
        expect(store.get('ada', id)?.run.active).to.deep.equal(['implement']);
    });

    it('restores unfinished runs from disk after a restart', async () => {
        const started = await store.start(buildImplementThenReviewWorkflow(), 'ada');
        const id = started.record.run.id;
        await store.report('ada', id, 'implement', 'success');

        const restored = new TestStore(directory);
        restored.initialize();
        const unfinished = restored.listUnfinished('ada');
        expect(unfinished).to.have.lengthOf(1);
        expect(unfinished[0].run.id).to.equal(id);
        expect(unfinished[0].run.active).to.deep.equal(['risk-classify']);
        // The definition travels with the run, so the restarted backend can keep routing it.
        expect(unfinished[0].def.id).to.equal('qaap.implement-then-review');

        const resumed = await restored.report('ada', id, 'risk-classify', 'risk:low');
        expect(resumed.record.run.status).to.equal('succeeded');
    });

    it('survives a corrupted index instead of throwing on boot', () => {
        fs.writeFileSync(path.join(directory, 'index.json'), '{"version":99}', 'utf8');
        const broken = new TestStore(directory);
        broken.initialize();
        expect(broken.list('ada')).to.deep.equal([]);
    });
});
