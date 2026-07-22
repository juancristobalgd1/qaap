// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapJobLoop } from '../common/qaap-job-loop';
import { QaapJobLoopEndpoint } from './qaap-job-loop-endpoint';

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

const baseLoop: QaapJobLoop = {
    id: 'loop-1',
    title: 'Quality loop',
    state: 'running',
    ownerLogin: 'alice',
    createdAt: 1,
    startedAt: 1,
    iteration: 1,
    maxIterations: 3,
    maxDurationMs: 60_000,
    maxJobs: 6,
    jobsScheduled: 2,
    until: { nodeKey: 'measure', pointer: '/value', operator: 'greater_or_equal', expected: 90 },
    rounds: [{ iteration: 1, graphId: 'graph-1', startedAt: 1 }],
    currentGraphId: 'graph-1',
};

describe('QaapJobLoopEndpoint', () => {

    it('canonicalizes every loop graph node and propagates owner and idempotency', async () => {
        const endpoint = Object.create(QaapJobLoopEndpoint.prototype) as QaapJobLoopEndpoint;
        let captured: { cwds?: string[]; owner?: string; idempotencyKey?: string } = {};
        Object.assign(endpoint, {
            engine: {
                create: (request: { graph: { nodes: Array<{ request: { cwd: string } }> }; idempotencyKey?: string }, owner?: string) => {
                    captured = {
                        cwds: request.graph.nodes.map(node => node.request.cwd),
                        owner,
                        idempotencyKey: request.idempotencyKey,
                    };
                    return Promise.resolve({ loop: baseLoop, created: true });
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

        await (endpoint as unknown as { handleCreate(req: unknown, res: unknown): Promise<void> }).handleCreate({
            body: {
                graph: {
                    nodes: [
                        { key: 'change', request: { command: 'npm run improve', cwd: 'org/repo' } },
                        { key: 'measure', dependsOn: ['change'], request: {
                            kind: 'function', functionId: 'qaap.workspace.read-json', cwd: 'org/repo',
                        } },
                    ],
                },
                until: { nodeKey: 'measure', pointer: '/value', operator: 'greater_or_equal', expected: 90 },
            },
            header: (name: string) => name === 'idempotency-key' ? 'quality:42' : undefined,
        }, res);

        expect(res.statusCode).to.equal(201);
        expect(captured.owner).to.equal('alice');
        expect(captured.idempotencyKey).to.equal('quality:42');
        expect(captured.cwds).to.deep.equal([
            '/workspace/repos/users/alice/org/repo',
            '/workspace/repos/users/alice/org/repo',
        ]);
    });

    it('does not expose or cancel a loop owned by another authenticated user', async () => {
        const endpoint = Object.create(QaapJobLoopEndpoint.prototype) as QaapJobLoopEndpoint;
        let cancelled = false;
        Object.assign(endpoint, {
            engine: {
                get: () => ({ ...baseLoop, ownerLogin: 'bob' }),
                cancel: () => { cancelled = true; return Promise.resolve(baseLoop); },
            },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                denyForbidden: (res: FakeResponse) => res.status(403).json({ error: 'forbidden' }),
            },
        });
        const getResponse = response();
        const cancelResponse = response();

        (endpoint as unknown as { handleGet(req: unknown, res: unknown): void }).handleGet({
            params: { id: baseLoop.id },
        }, getResponse);
        await (endpoint as unknown as { handleCancel(req: unknown, res: unknown): Promise<void> }).handleCancel({
            params: { id: baseLoop.id },
        }, cancelResponse);

        expect(getResponse.statusCode).to.equal(403);
        expect(cancelResponse.statusCode).to.equal(403);
        expect(cancelled).to.equal(false);
    });

    it('lists only loops belonging to the authenticated owner', () => {
        const endpoint = Object.create(QaapJobLoopEndpoint.prototype) as QaapJobLoopEndpoint;
        let owner: string | undefined;
        Object.assign(endpoint, {
            engine: { list: (value?: string) => { owner = value; return [baseLoop]; } },
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }) },
        });
        const res = response();

        (endpoint as unknown as { handleList(req: unknown, res: unknown): void }).handleList({}, res);

        expect(owner).to.equal('alice');
        expect((res.body as { loops: QaapJobLoop[] }).loops).to.have.length(1);
    });
});
