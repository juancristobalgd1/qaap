// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter } from '@theia/core';
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    QaapCreateJobGraphRequest,
    QaapCreateJobGraphResult,
    QaapJob,
    QaapJobDetail,
    QaapJobEvent,
    QaapJobGraph,
} from '../common/qaap-job';
import { QaapCreateJobLoopRequest } from '../common/qaap-job-loop';
import {
    QaapJobLoopConflictError,
    QaapJobLoopEngine,
    QaapJobLoopRequestError,
} from './qaap-job-loop-engine';
import { QaapJobRuntime } from './qaap-job-runtime';

class FakeJobRuntime {
    protected readonly emitter = new Emitter<QaapJobEvent>();
    readonly onDidChangeJob = this.emitter.event;
    readonly graphs = new Map<string, QaapJobGraph>();
    readonly jobs = new Map<string, QaapJobDetail>();
    readonly idempotency = new Map<string, string>();
    graphSequence = 0;

    createGraph(request: QaapCreateJobGraphRequest, ownerLogin?: string): QaapCreateJobGraphResult {
        const idempotencyKey = `${ownerLogin ?? ''}\0${request.idempotencyKey ?? ''}`;
        const existingId = this.idempotency.get(idempotencyKey);
        const existing = existingId ? this.graphs.get(existingId) : undefined;
        if (existing) {
            return { graph: existing, jobs: this.jobsForGraph(existing), created: false };
        }
        const graphId = `graph-${++this.graphSequence}`;
        const jobsByKey: Record<string, string> = {};
        for (const node of request.nodes) {
            const id = `${graphId}-${node.key}`;
            jobsByKey[node.key] = id;
            const functionRequest = node.request.kind === 'function';
            const job: QaapJobDetail = {
                id,
                kind: functionRequest ? 'function' : 'command',
                title: node.request.title ?? node.key,
                command: functionRequest ? undefined : node.request.command,
                functionId: functionRequest ? node.request.functionId : undefined,
                input: functionRequest ? node.request.input : undefined,
                cwd: node.request.cwd,
                resourceClass: functionRequest ? 'io' : (node.request.resourceClass ?? 'workspace'),
                workspaceAccess: functionRequest ? 'read' : (node.request.workspaceAccess ?? 'write'),
                state: 'queued',
                dependsOn: [],
                timeoutMs: node.request.timeoutMs ?? 60_000,
                attempt: 0,
                createdAt: Date.now(),
                ownerLogin,
                log: '',
            };
            this.jobs.set(id, job);
        }
        const graph: QaapJobGraph = {
            id: graphId,
            createdAt: Date.now(),
            ownerLogin,
            idempotencyKey: request.idempotencyKey,
            jobsByKey,
        };
        this.graphs.set(graphId, graph);
        this.idempotency.set(idempotencyKey, graphId);
        return { graph, jobs: this.jobsForGraph(graph), created: true };
    }

    getGraph(id: string): { graph: QaapJobGraph; jobs: Readonly<Record<string, QaapJob>> } | undefined {
        const graph = this.graphs.get(id);
        return graph ? { graph, jobs: this.jobsForGraph(graph) } : undefined;
    }

    get(id: string): QaapJobDetail | undefined {
        return this.jobs.get(id);
    }

    cancel(id: string): QaapJob | undefined {
        const job = this.jobs.get(id);
        if (!job) {
            return undefined;
        }
        const cancelled: QaapJobDetail = { ...job, state: 'cancelled', finishedAt: Date.now() };
        this.jobs.set(id, cancelled);
        this.emitter.fire({ type: 'changed', job: cancelled });
        return cancelled;
    }

    finishGraph(
        graphId: string,
        results: Readonly<Record<string, unknown>> = {},
        failedKey?: string,
        emit = false,
    ): void {
        const graph = this.graphs.get(graphId)!;
        for (const [key, id] of Object.entries(graph.jobsByKey)) {
            const job = this.jobs.get(id)!;
            const finished: QaapJobDetail = {
                ...job,
                state: key === failedKey ? 'failed' : 'succeeded',
                finishedAt: Date.now(),
                result: results[key],
            };
            this.jobs.set(id, finished);
            if (emit) {
                this.emitter.fire({ type: 'changed', job: finished });
            }
        }
    }

    protected jobsForGraph(graph: QaapJobGraph): Record<string, QaapJob> {
        const jobs: Record<string, QaapJob> = {};
        for (const [key, id] of Object.entries(graph.jobsByKey)) {
            jobs[key] = this.jobs.get(id)!;
        }
        return jobs;
    }
}

class TestLoopEngine extends QaapJobLoopEngine {
    constructor(runtime: FakeJobRuntime, protected readonly testStore: string) {
        super();
        Object.assign(this, { runtime: runtime as unknown as QaapJobRuntime });
    }

    initialize(): void {
        this.init();
    }

    reconcileNow(id: string): Promise<void> {
        return this.enqueueLoop(id, () => this.reconcile(id));
    }

    ageLoop(id: string, milliseconds: number): void {
        const record = this.records.get(id)!;
        record.loop = { ...record.loop, startedAt: Date.now() - milliseconds };
    }

    protected override storeDirectory(): string {
        return this.testStore;
    }
}

const loopRequest = (maxIterations = 3): QaapCreateJobLoopRequest => ({
    title: 'Raise score',
    graph: {
        nodes: [{
            key: 'measure',
            request: {
                kind: 'function',
                functionId: 'qaap.workspace.read-json',
                input: { path: 'metrics.json', pointer: '/score' },
                cwd: '/workspace/alice/repo',
            },
        }],
    },
    until: { nodeKey: 'measure', pointer: '/value', operator: 'greater_or_equal', expected: 10 },
    maxIterations,
    maxDurationMs: 60_000,
});

describe('QaapJobLoopEngine', () => {
    let temporaryRoot: string;
    let runtime: FakeJobRuntime;
    let engine: TestLoopEngine;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-loop-'));
        runtime = new FakeJobRuntime();
        engine = new TestLoopEngine(runtime, temporaryRoot);
        engine.initialize();
    });

    afterEach(async () => {
        await engine.shutdown();
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    it('succeeds when a structured result satisfies the declarative condition', async () => {
        const created = await engine.create(loopRequest(), 'alice');
        runtime.finishGraph(created.loop.currentGraphId!, { measure: { value: 12 } });

        await engine.reconcileNow(created.loop.id);

        const loop = engine.get(created.loop.id)!;
        expect(loop.state).to.equal('succeeded');
        expect(loop.terminationReason).to.equal('goal_reached');
        expect(loop.iteration).to.equal(1);
        expect(loop.rounds[0].conditionMatched).to.equal(true);
    });

    it('reconciles automatically from terminal job events', async () => {
        const created = await engine.create(loopRequest(), 'alice');
        runtime.finishGraph(created.loop.currentGraphId!, { measure: { value: 12 } }, undefined, true);

        const deadline = Date.now() + 1_000;
        while (engine.get(created.loop.id)?.state === 'running' && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        expect(engine.get(created.loop.id)).to.include({ state: 'succeeded', terminationReason: 'goal_reached' });
    });

    it('starts another graph after a miss and stops at the iteration budget', async () => {
        const created = await engine.create(loopRequest(2), 'alice');
        runtime.finishGraph(created.loop.currentGraphId!, { measure: { value: 4 } });
        await engine.reconcileNow(created.loop.id);

        const secondGraph = engine.get(created.loop.id)!.currentGraphId!;
        expect(secondGraph).to.equal('graph-2');
        runtime.finishGraph(secondGraph, { measure: { value: 9 } });
        await engine.reconcileNow(created.loop.id);

        const loop = engine.get(created.loop.id)!;
        expect(loop.state).to.equal('budget_exhausted');
        expect(loop.terminationReason).to.equal('max_iterations');
        expect(loop.rounds).to.have.length(2);
        expect(loop.jobsScheduled).to.equal(2);
    });

    it('fails the loop when any graph node does not succeed', async () => {
        const created = await engine.create(loopRequest(), 'alice');
        runtime.finishGraph(created.loop.currentGraphId!, {}, 'measure');

        await engine.reconcileNow(created.loop.id);

        expect(engine.get(created.loop.id)).to.include({ state: 'failed', terminationReason: 'graph_failed' });
    });

    it('cancels active graph jobs when the duration budget is exhausted', async () => {
        const created = await engine.create(loopRequest(), 'alice');
        const graphId = created.loop.currentGraphId!;
        engine.ageLoop(created.loop.id, 61_000);

        await engine.reconcileNow(created.loop.id);

        expect(engine.get(created.loop.id)).to.include({ state: 'budget_exhausted', terminationReason: 'max_duration' });
        expect(Object.values(runtime.getGraph(graphId)!.jobs)[0].state).to.equal('cancelled');
    });

    it('cancels explicitly only for the owning user', async () => {
        const created = await engine.create(loopRequest(), 'alice');
        expect(await engine.cancel(created.loop.id, 'bob')).to.equal(undefined);

        const cancelled = await engine.cancel(created.loop.id, 'alice');

        expect(cancelled).to.include({ state: 'cancelled', terminationReason: 'cancelled' });
        expect(Object.values(runtime.getGraph(created.loop.currentGraphId!)!.jobs)[0].state).to.equal('cancelled');
    });

    it('replays an identical idempotent request and rejects a conflicting one', async () => {
        const request = { ...loopRequest(), idempotencyKey: 'score:42' };
        const first = await engine.create(request, 'alice');
        const replay = await engine.create(request, 'alice');

        expect(replay.created).to.equal(false);
        expect(replay.loop.id).to.equal(first.loop.id);
        let conflict: unknown;
        try {
            await engine.create({ ...request, maxIterations: 2 }, 'alice');
        } catch (error) {
            conflict = error;
        }
        expect(conflict).to.be.instanceOf(QaapJobLoopConflictError);
    });

    it('restores a running loop and reconciles a graph completed before restart', async () => {
        const created = await engine.create(loopRequest(), 'alice');
        runtime.finishGraph(created.loop.currentGraphId!, { measure: { value: 10 } });
        await engine.shutdown();

        engine = new TestLoopEngine(runtime, temporaryRoot);
        engine.initialize();
        await engine.reconcileNow(created.loop.id);

        expect(engine.get(created.loop.id)).to.include({ state: 'succeeded', terminationReason: 'goal_reached' });
        expect(runtime.graphSequence).to.equal(1);
    });

    it('rejects a loop whose graph multiplied by iterations exceeds the job budget', async () => {
        const nodes = Array.from({ length: 6 }, (_, index) => ({
            key: `node${index}`,
            request: { command: 'true', cwd: '/workspace/alice/repo' },
        }));
        const request: QaapCreateJobLoopRequest = {
            graph: { nodes },
            until: { nodeKey: 'node0', source: 'job', pointer: '/state', operator: 'equals', expected: 'succeeded' },
            maxIterations: 100,
        };

        let rejected: unknown;
        try {
            await engine.create(request, 'alice');
        } catch (error) {
            rejected = error;
        }
        expect(rejected).to.be.instanceOf(QaapJobLoopRequestError);
        expect((rejected as Error).message).to.contain('maximum job budget');
        expect(runtime.graphSequence).to.equal(0);
    });
});
