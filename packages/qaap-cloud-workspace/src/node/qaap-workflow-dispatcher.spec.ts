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
import { buildImplementThenReviewWorkflow, QaapWorkflowDef } from '../common/qaap-workflow-ir';
import {
    QaapWorkflowAgentTurnPort,
    QaapWorkflowDeterministicPort,
    QaapWorkflowDispatcher,
} from './qaap-workflow-dispatcher';
import { QaapWorkflowRunStore } from './qaap-workflow-run-store';

/** An agent log whose terminal record carries `text` as the turn's final message. */
function resultLog(text: string): string {
    return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text });
}

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

    async lookupAgentTurn(externalId: string): Promise<{ state: QaapAgentTaskState; log?: string } | undefined> {
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

    async lookupDeterministic(externalId: string): Promise<{ state: QaapJobState; result?: unknown } | undefined> {
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
        const started = await store.start(buildImplementThenReviewWorkflow(), { cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'fix the login bug' } });
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

    it('keeps the captured diff so the judge downstream can be shown the real change', async () => {
        // Regression: the git-diff node computed a diff that nothing stored, so the reviewer prompt
        // always fell back to its empty-diff branch.
        const runId = await startRun();
        await dispatcher.onAgentTaskFinished('task-1', 'completed');
        await dispatcher.onJobFinished('job-1', 'succeeded', { outcome: 'risk:high' });
        await dispatcher.onJobFinished('job-2', 'succeeded', { outcome: 'success', artifact: '--- a/cart.js\n+++ b/cart.js' });

        expect(store.get('ada', runId)?.artifacts['review.diff']).to.contain('+++ b/cart.js');
    });

    it('stores no artifact for a node that declares no artifact key', async () => {
        const runId = await startRun();
        await dispatcher.onAgentTaskFinished('task-1', 'completed');
        await dispatcher.onJobFinished('job-1', 'succeeded', { outcome: 'risk:high', artifact: 'not declared' });

        expect(store.get('ada', runId)?.artifacts).to.deep.equal({});
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
        const started = await store.start(buildImplementThenReviewWorkflow(), { cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'fix the login bug' } });
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

    describe('fan-out and fan-in', () => {
        /** Two explorers that reconverge on a join before a synthesis turn. */
        const fanOut: QaapWorkflowDef = {
            id: 'fan', version: 1, name: 'Explore in parallel, then synthesize', entry: 'plan',
            nodes: [
                { kind: 'agent-turn', id: 'plan', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'user-task' },
                { kind: 'agent-turn', id: 'left', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'user-task' },
                { kind: 'agent-turn', id: 'right', capability: 'explore', isolation: 'cwd-readonly', promptRef: 'user-task' },
                { kind: 'join', id: 'join', wait: 'all' },
                { kind: 'agent-turn', id: 'synthesize', capability: 'synthesize', isolation: 'cwd-readonly', promptRef: 'user-task' },
                { kind: 'emit', id: 'done', bindingKey: 'advice' },
            ],
            edges: [
                { from: 'plan', to: 'left', when: 'success' },
                { from: 'plan', to: 'right', when: 'success' },
                { from: 'left', to: 'join', when: 'always' },
                { from: 'right', to: 'join', when: 'always' },
                { from: 'join', to: 'synthesize', when: 'always' },
                { from: 'synthesize', to: 'done', when: 'always' },
            ],
        };

        it('settles a fired join itself instead of hanging the run on it', async () => {
            // Regression: a join is pushed onto the frontier like any other node, but no runtime
            // ever reports it. Every fan-in graph used to sit at `running` with active: ['join'].
            const started = await store.start(fanOut, { cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'map the repo' } });
            await dispatcher.dispatch(started.record, started.dispatch);
            const runId = started.record.run.id;

            await dispatcher.onAgentTaskFinished('task-1', 'completed');
            expect(agent.started).to.deep.equal(['task-1', 'task-2', 'task-3']);

            await dispatcher.onAgentTaskFinished('task-2', 'completed');
            expect(store.get('ada', runId)?.run.active).to.deep.equal(['right']);

            await dispatcher.onAgentTaskFinished('task-3', 'completed');
            // The join fired, settled itself, and released the node behind it.
            expect(agent.started).to.deep.equal(['task-1', 'task-2', 'task-3', 'task-4']);
            expect(store.get('ada', runId)?.run.active).to.deep.equal(['synthesize']);

            await dispatcher.onAgentTaskFinished('task-4', 'completed');
            const record = store.get('ada', runId);
            expect(record?.run.status).to.equal('succeeded');
            expect(record?.run.bindings).to.have.property('advice');
        });

        it('drives the shipped parallel template: both explorers, then one implement turn', async () => {
            const def = buildImplementThenReviewWorkflow({ withParallelExploration: true });
            const started = await store.start(def, { cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'fix the login bug' } });
            await dispatcher.dispatch(started.record, started.dispatch);
            const runId = started.record.run.id;

            // Both explorers start at once — that is what a multi-node entry buys.
            expect(agent.started).to.deep.equal(['task-1', 'task-2']);
            expect(store.get('ada', runId)?.run.active).to.deep.equal(['explore-structure', 'explore-verification']);

            await dispatcher.onAgentTaskFinished('task-1', 'completed', resultLog('edit src/auth/session.ts'));
            expect(agent.started).to.have.length(2, 'the join must wait for the second explorer');

            await dispatcher.onAgentTaskFinished('task-2', 'completed', resultLog('run npm test'));
            expect(agent.started).to.deep.equal(['task-1', 'task-2', 'task-3']);
            expect(store.get('ada', runId)?.run.active).to.deep.equal(['implement']);

            // Findings survive as artifacts, which is the only reason exploring in parallel pays off.
            expect(store.get('ada', runId)?.artifacts).to.deep.equal({
                'explore.structure': 'edit src/auth/session.ts',
                'explore.verification': 'run npm test',
            });
        });

        it('still reaches implement when one explorer dies', async () => {
            const def = buildImplementThenReviewWorkflow({ withParallelExploration: true });
            const started = await store.start(def, { cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'fix the login bug' } });
            await dispatcher.dispatch(started.record, started.dispatch);
            const runId = started.record.run.id;

            await dispatcher.onAgentTaskFinished('task-1', 'failed');
            await dispatcher.onAgentTaskFinished('task-2', 'completed', resultLog('run npm test'));

            expect(store.get('ada', runId)?.run.active).to.deep.equal(['implement']);
            expect(store.get('ada', runId)?.artifacts).to.deep.equal({ 'explore.verification': 'run npm test' });
        });

        it('heals a run parked on an unsettled join by an older build', async () => {
            const started = await store.start(fanOut, { cwd: '/repo', ownerLogin: 'ada', inputs: { task: 'map the repo' } });
            await dispatcher.dispatch(started.record, started.dispatch);
            const runId = started.record.run.id;
            await dispatcher.onAgentTaskFinished('task-1', 'completed');
            await dispatcher.onAgentTaskFinished('task-2', 'completed');
            // Pre-fix state, reproduced by reporting straight to the store: the join fired and sits
            // in `active` with no runtime behind it, so no event will ever arrive for it.
            await store.report('ada', runId, 'right', 'success');
            expect(store.get('ada', runId)?.run.active).to.deep.equal(['join']);

            await dispatcher.reconcileOnBoot();

            expect(store.get('ada', runId)?.run.active).to.deep.equal(['synthesize']);
        });
    });
});
