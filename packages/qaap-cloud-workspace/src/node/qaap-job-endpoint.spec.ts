// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapJob } from '../common/qaap-job';
import { QaapJobEndpoint } from './qaap-job-endpoint';

interface FakeResponse {
    statusCode: number;
    body: unknown;
    status(code: number): FakeResponse;
    json(payload: unknown): FakeResponse;
}

const response = (): FakeResponse => ({
    statusCode: 200,
    body: undefined,
    status(code: number): FakeResponse { this.statusCode = code; return this; },
    json(payload: unknown): FakeResponse { this.body = payload; return this; },
});

const baseJob: QaapJob = {
    id: 'job-1',
    kind: 'command',
    title: 'Build',
    command: 'npm run build',
    cwd: '/workspace/repos/users/alice/org/repo',
    resourceClass: 'cpu',
    workspaceAccess: 'read',
    state: 'queued',
    dependsOn: [],
    timeoutMs: 60_000,
    attempt: 0,
    createdAt: 1,
    ownerLogin: 'alice',
};

describe('QaapJobEndpoint', () => {

    it('canonicalizes the repository and propagates the authenticated owner on create', () => {
        const endpoint = Object.create(QaapJobEndpoint.prototype) as QaapJobEndpoint;
        let captured: { request?: { cwd?: string; idempotencyKey?: string }; owner?: string } = {};
        Object.assign(endpoint, {
            runtime: {
                create: (request: { cwd?: string; idempotencyKey?: string }, owner?: string) => {
                    captured = { request, owner };
                    return { job: baseJob, created: true };
                },
            },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: baseJob.cwd }),
            },
        });
        const res = response();

        (endpoint as unknown as { handleCreate(req: unknown, res: unknown): void }).handleCreate({
            body: { command: 'npm run build', cwd: 'org/repo' },
            header: (name: string) => name === 'idempotency-key' ? 'build:42' : undefined,
        }, res);

        expect(res.statusCode).to.equal(201);
        expect(captured.owner).to.equal('alice');
        expect(captured.request?.cwd).to.equal(baseJob.cwd);
        expect(captured.request?.idempotencyKey).to.equal('build:42');
    });

    it('returns an idempotent replay with status 200', () => {
        const endpoint = Object.create(QaapJobEndpoint.prototype) as QaapJobEndpoint;
        Object.assign(endpoint, {
            runtime: { create: () => ({ job: baseJob, created: false }) },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: baseJob.cwd }),
            },
        });
        const res = response();

        (endpoint as unknown as { handleCreate(req: unknown, res: unknown): void }).handleCreate({
            body: { command: baseJob.command, cwd: baseJob.cwd },
            header: () => undefined,
        }, res);

        expect(res.statusCode).to.equal(200);
        expect((res.body as QaapJob).id).to.equal(baseJob.id);
    });

    it('refuses to cancel a job owned by another authenticated user', () => {
        const endpoint = Object.create(QaapJobEndpoint.prototype) as QaapJobEndpoint;
        let cancelled = false;
        Object.assign(endpoint, {
            runtime: {
                get: () => ({ ...baseJob, ownerLogin: 'bob', log: '' }),
                cancel: () => { cancelled = true; },
            },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                ownsWorkspacePath: () => false,
                denyForbidden: (res: FakeResponse) => res.status(403).json({ error: 'forbidden' }),
            },
        });
        const res = response();

        (endpoint as unknown as { handleCancel(req: unknown, res: unknown): void }).handleCancel({
            params: { id: baseJob.id },
        }, res);

        expect(res.statusCode).to.equal(403);
        expect(cancelled).to.equal(false);
    });

    it('lists registered functions only after authentication', () => {
        const endpoint = Object.create(QaapJobEndpoint.prototype) as QaapJobEndpoint;
        Object.assign(endpoint, {
            runtime: { listFunctions: () => [{ id: 'test.function' }] },
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }) },
        });
        const res = response();

        (endpoint as unknown as { handleFunctions(req: unknown, res: unknown): void })
            .handleFunctions({}, res);

        expect((res.body as { functions: Array<{ id: string }> }).functions[0].id).to.equal('test.function');
    });

    it('canonicalizes every graph node and propagates the graph owner atomically', () => {
        const endpoint = Object.create(QaapJobEndpoint.prototype) as QaapJobEndpoint;
        let captured: { nodes?: Array<{ request: { cwd: string } }>; owner?: string } = {};
        Object.assign(endpoint, {
            runtime: {
                createGraph: (graph: { nodes: Array<{ request: { cwd: string } }> }, owner?: string) => {
                    captured = { nodes: graph.nodes, owner };
                    return { graph: { id: 'graph' }, jobs: {}, created: true };
                },
            },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveOwnedRepositoryCwd: (_ctx: unknown, cwd: string) => ({
                    kind: 'ok', cwd: `/workspace/repos/users/alice/${cwd}`,
                }),
            },
        });
        const res = response();

        (endpoint as unknown as { handleCreateGraph(req: unknown, res: unknown): void }).handleCreateGraph({
            body: {
                nodes: [{ key: 'first', request: { command: 'one', cwd: 'org/one' } },
                    { key: 'second', dependsOn: ['first'], request: { command: 'two', cwd: 'org/two' } }],
            },
            header: () => undefined,
        }, res);

        expect(res.statusCode).to.equal(201);
        expect(captured.owner).to.equal('alice');
        expect(captured.nodes?.map(node => node.request.cwd)).to.deep.equal([
            '/workspace/repos/users/alice/org/one',
            '/workspace/repos/users/alice/org/two',
        ]);
    });

    it('does not expose a graph owned by another authenticated user', () => {
        const endpoint = Object.create(QaapJobEndpoint.prototype) as QaapJobEndpoint;
        Object.assign(endpoint, {
            runtime: {
                getGraph: () => ({
                    graph: { id: 'foreign', createdAt: 1, ownerLogin: 'bob', jobsByKey: {} }, jobs: {},
                }),
            },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                denyForbidden: (res: FakeResponse) => res.status(403).json({ error: 'forbidden' }),
            },
        });
        const res = response();

        (endpoint as unknown as { handleGetGraph(req: unknown, res: unknown): void }).handleGetGraph({
            params: { id: 'foreign' },
        }, res);

        expect(res.statusCode).to.equal(403);
    });
});
