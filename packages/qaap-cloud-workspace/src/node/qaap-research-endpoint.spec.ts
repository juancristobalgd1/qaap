// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapResearchEndpoint } from './qaap-research-endpoint';

describe('QaapResearchEndpoint', () => {
    const userA = 'alice';
    const reposRoot = '/workspace/repos';

    function fakeRes(): {
        statusCode: number;
        body: unknown;
        status(code: number): unknown;
        json(payload: unknown): unknown;
    } {
        return {
            statusCode: 200,
            body: undefined,
            status(code: number) { this.statusCode = code; return this; },
            json(payload: unknown) { this.body = payload; return this; },
        };
    }

    function buildEndpoint(options: {
        readonly resolved?: { kind: string; cwd?: string };
        readonly running?: Array<{ id: string; owner?: string }>;
        readonly maxGlobal?: number;
        readonly maxPerUser?: number;
    } = {}): {
        endpoint: QaapResearchEndpoint;
        storeCwd: string | undefined;
        denyCalls: number;
        started: number;
    } {
        const state = {
            storeCwd: undefined as string | undefined,
            denyCalls: 0,
            started: 0,
        };
        const running = (options.running ?? []).map(entry => ({
            id: entry.id,
            status: 'running' as const,
            cwd: `${reposRoot}/users/${entry.owner ?? userA}/acme/demo`,
        }));
        const owners = new Map((options.running ?? []).map(entry => [entry.id, entry.owner ?? userA]));
        const endpoint = Object.create(QaapResearchEndpoint.prototype) as QaapResearchEndpoint;
        Object.assign(endpoint, {
            requireAuth: () => ({ kind: 'authenticated', userLogin: userA }),
            auth: {
                resolveOwnedRepositoryCwd: () => options.resolved ?? { kind: 'ok', cwd: `${reposRoot}/users/${userA}/acme/demo` },
                resolveUserLogin: () => userA,
                denyForbidden: (res: { statusCode: number }) => { state.denyCalls++; res.statusCode = 403; return false; },
            },
            store: {
                create: (req: { cwd: string }) => {
                    state.storeCwd = req.cwd;
                    return { id: 'g1', cwd: req.cwd, status: 'running' };
                },
                listRunning: () => running,
                ownerOf: (id: string) => owners.get(id),
            },
            runner: { start: () => { state.started++; } },
            maxConcurrentResearch: () => options.maxGlobal ?? 2,
            maxConcurrentResearchPerUser: () => options.maxPerUser ?? 1,
        });
        return {
            endpoint,
            get storeCwd(): string | undefined { return state.storeCwd; },
            get denyCalls(): number { return state.denyCalls; },
            get started(): number { return state.started; },
        };
    }

    const validBody = {
        cwd: `${reposRoot}/users/bob/acme/demo`,
        description: 'improve latency',
        metrics: [{ name: 'latency', direction: 'minimize', metricCommand: 'echo 1', primary: true }],
    };

    it('persists the resolved canonical cwd (SEC-7)', () => {
        const canonical = `${reposRoot}/users/${userA}/acme/demo`;
        const h = buildEndpoint({ resolved: { kind: 'ok', cwd: canonical } });
        const res = fakeRes();
        (h.endpoint as unknown as { handleCreate(req: unknown, res: unknown): void })
            .handleCreate({ body: validBody }, res);
        expect(res.statusCode).to.equal(201);
        expect(h.storeCwd).to.equal(canonical);
        expect(h.started).to.equal(1);
    });

    it('rejects a container cwd with 400', () => {
        const h = buildEndpoint({ resolved: { kind: 'needs-project' } });
        const res = fakeRes();
        (h.endpoint as unknown as { handleCreate(req: unknown, res: unknown): void })
            .handleCreate({ body: validBody }, res);
        expect(res.statusCode).to.equal(400);
        expect(h.storeCwd).to.be.undefined;
        expect(h.started).to.equal(0);
    });

    it('denies a non-owned cwd with 403', () => {
        const h = buildEndpoint({ resolved: { kind: 'denied' } });
        const res = fakeRes();
        (h.endpoint as unknown as { handleCreate(req: unknown, res: unknown): void })
            .handleCreate({ body: validBody }, res);
        expect(h.denyCalls).to.equal(1);
        expect(res.statusCode).to.equal(403);
        expect(h.started).to.equal(0);
    });

    it('enforces the per-user research concurrency quota', () => {
        const h = buildEndpoint({
            resolved: { kind: 'ok', cwd: `${reposRoot}/users/${userA}/acme/demo` },
            running: [{ id: 'g-existing', owner: userA }],
            maxPerUser: 1,
            maxGlobal: 8,
        });
        const res = fakeRes();
        (h.endpoint as unknown as { handleCreate(req: unknown, res: unknown): void })
            .handleCreate({ body: validBody }, res);
        expect(res.statusCode).to.equal(409);
        expect(h.started).to.equal(0);
    });

    it('enforces the global research concurrency quota', () => {
        const h = buildEndpoint({
            resolved: { kind: 'ok', cwd: `${reposRoot}/users/${userA}/acme/demo` },
            running: [
                { id: 'g1', owner: 'bob' },
                { id: 'g2', owner: 'carol' },
            ],
            maxGlobal: 2,
            maxPerUser: 4,
        });
        const res = fakeRes();
        (h.endpoint as unknown as { handleCreate(req: unknown, res: unknown): void })
            .handleCreate({ body: validBody }, res);
        expect(res.statusCode).to.equal(409);
        expect(h.started).to.equal(0);
    });

    it('requires cwd, description and metrics', () => {
        const h = buildEndpoint();
        const res = fakeRes();
        (h.endpoint as unknown as { handleCreate(req: unknown, res: unknown): void })
            .handleCreate({ body: { description: 'x', metrics: validBody.metrics } }, res);
        expect(res.statusCode).to.equal(400);
    });
});
