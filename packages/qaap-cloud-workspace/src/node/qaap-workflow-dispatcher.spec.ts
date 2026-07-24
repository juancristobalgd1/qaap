// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapAgentTaskState } from '../common/qaap-agent-task';
import { QaapJobState } from '../common/qaap-job';
import { buildImplementThenReviewWorkflow } from '../common/qaap-workflow-ir';
import {
    QaapWorkflowAgentTurnPort,
    QaapWorkflowDeterministicPort,
    QaapWorkflowDispatcher,
} from './qaap-workflow-dispatcher';
import { QaapWorkflowRunStore } from './qaap-workflow-run-store';

class TestStore extends QaapWorkflowRunStore {
    constructor(protected readonly testDirectory: string) { super(); }
    initialize(): void { this.init(); }
    protected override storeDirectory(): string { return this.testDirectory; }
}

class FakeAgentPort implements QaapWorkflowAgentTurnPort {
    readonly started: string[] = [];
    readonly tasks = new Map<string, { state: QaapAgentTaskState; log?: string }>();
    failNext = false;
    private counter = 0;

    async startAgentTurn(): Promise<string> {
        if (this.failNext) {
            this.failNext = false;
            throw new Error('spawn refused');
        }
        const id = `task-${++this.counter}`;
        this.started.push(id);
        this.tasks.set(id, { state: 'running' });
        return id;
    }

    lookupAgentTurn(externalId: string): { state: QaapAgentTaskState; log?: string } | undefined {
        return this.tasks.get(externalId);
    }
}

class FakeJobPort implements QaapWorkflowDeterministicPort {
    readonly started: string[] = [];
    readonly jobs = new Map<string, { state: QaapJobState; result?: unknown }>();
    private counter = 0;

    async startDeterministic(): Promise<string> {
        const id = `job-${++this.counter}`;
        this.started.push(id);
        this.jobs.set(id, { state: 'running' });
        return id;
    }

    lookupDeterministic(externalId: string): { state: QaapJobState; result?: unknown } | undefined {
        return this.jobs.get(externalId);
    }
}

describe('QaapWorkflowDispatcher', () => {
    let directory: string;
    let store: TestStore;
    let agent: FakeAgentPort;
    let jobs: FakeJobPort;
    let dispatcher: QaapWorkflowDispatcher;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-workflow-dispatch-'));
        store = new TestStore(directory);
        store.initialize();
        agent = new FakeAgentPort();
        jobs = new FakeJobPort();
        dispatcher = new QaapWorkflowDispatcher(store, { agent, deterministic: jobs });
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    async function startRun(): Promise<string> {
        const started = await store.start(buildImplementThenReviewWorkflow(), 'ada');
        await dispatcher.dispatch(started.record, started.dispatch);
        return started.record.run.id;
    }

    it('starts the entry agent turn and remembers where it went', async () => {
        const runId = await startRun();
        expect(agent.started).to.deep.equal(['task-1']);
        expect(store.get('ada', runId)?.dispatched.implement?.externalId).to.equal('task-1');
    });

    it('drives the whole review graph from runtime events', async () => {
        const runId = await startRun();
        await dispatcher.onAgentTaskFinished('task-1', 'completed');
        expect(jobs.started).to.deep.equal(['job-1']);

        await dispatcher.onJobFinished('job-1', 'succeeded', { outcome: 'risk:high' });
        expect(jobs.started).to.deep.equal(['job-1', 'job-2']);

        await dispatcher.onJobFinished('job-2', 'succeeded');
        expect(agent.started).to.deep.equal(['task-1', 'task-2']);

        await dispatcher.onAgentTaskFinished('task-2', 'completed', 'verdict below\n@@QAAP:VERDICT@@ pass looks fine');
        const record = store.get('ada', runId);
        expect(record?.run.status).to.equal('succeeded');
        expect(record?.run.bindings).to.have.property('review.passed');
        expect(record?.dispatched).to.deep.equal({});
    });

    it('routes a silent reviewer to inconclusive instead of passing the change', async () => {
        const runId = await startRun();
        await dispatcher.onAgentTaskFinished('task-1', 'completed');
        await dispatcher.onJobFinished('job-1', 'succeeded', { outcome: 'risk:high' });
        await dispatcher.onJobFinished('job-2', 'succeeded');
        await dispatcher.onAgentTaskFinished('task-2', 'completed', 'I reviewed everything and it seems fine.');

        const record = store.get('ada', runId);
        expect(record?.run.status).to.equal('succeeded');
        expect(record?.run.bindings).to.have.property('review.inconclusive');
    });

    it('skips the review when the risk classifier reports low risk', async () => {
        const runId = await startRun();
        await dispatcher.onAgentTaskFinished('task-1', 'completed');
        await dispatcher.onJobFinished('job-1', 'succeeded', { outcome: 'risk:low' });

        expect(agent.started).to.deep.equal(['task-1']);
        expect(store.get('ada', runId)?.run.bindings).to.have.property('review.skipped');
    });

    it('fails the node when the runtime refuses to start it', async () => {
        agent.failNext = true;
        const started = await store.start(buildImplementThenReviewWorkflow(), 'ada');
        await dispatcher.dispatch(started.record, started.dispatch);

        const record = store.get('ada', started.record.run.id);
        expect(record?.run.status).to.equal('failed');
        expect(record?.dispatched).to.deep.equal({});
    });

    it('ignores runtime events that belong to no workflow', async () => {
        const runId = await startRun();
        await dispatcher.onAgentTaskFinished('task-unrelated', 'completed');
        await dispatcher.onJobFinished('job-unrelated', 'succeeded');
        expect(store.get('ada', runId)?.run.active).to.deep.equal(['implement']);
    });

    it('reconciles a task that finished while the backend was down', async () => {
        const runId = await startRun();
        agent.tasks.set('task-1', { state: 'completed' });

        await dispatcher.reconcileOnBoot();

        expect(jobs.started).to.deep.equal(['job-1']);
        expect(store.get('ada', runId)?.run.active).to.deep.equal(['risk-classify']);
    });

    it('interrupts a node whose process the runtime no longer knows', async () => {
        const runId = await startRun();
        agent.tasks.delete('task-1');

        await dispatcher.reconcileOnBoot();

        const record = store.get('ada', runId);
        expect(record?.run.status).to.equal('failed');
        expect(record?.run.bindings).to.have.property('review.skipped');
    });

    it('leaves a still-running node alone on boot', async () => {
        const runId = await startRun();
        await dispatcher.reconcileOnBoot();
        expect(store.get('ada', runId)?.run.active).to.deep.equal(['implement']);
        expect(agent.started).to.deep.equal(['task-1']);
    });
});
