// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapProjectResourcesEndpoint } from './qaap-project-resources-endpoint';

interface StubResponse {
    statusCode?: number;
    body?: unknown;
    status(code: number): { json(body: unknown): void };
    json(body: unknown): void;
}

function makeRes(): StubResponse {
    const res: StubResponse = {
        status(code: number) {
            res.statusCode = code;
            return { json: (body: unknown) => { res.body = body; } };
        },
        json(body: unknown) {
            res.statusCode = 200;
            res.body = body;
        },
    };
    return res;
}

describe('QaapProjectResourcesEndpoint', () => {
    const planId = { current: 'starter' as 'starter' | 'pro' };
    let applied: string[];

    function makeEndpoint(signedIn = true): QaapProjectResourcesEndpoint {
        const endpoint = Object.create(QaapProjectResourcesEndpoint.prototype) as QaapProjectResourcesEndpoint;
        const saved = new Map<string, number>();
        applied = [];
        Object.assign(endpoint, {
            auth: {
                authenticate: () => (signedIn ? { kind: 'user' } : { kind: 'unauthorized' }),
                resolveUserLogin: () => (signedIn ? 'alice' : undefined),
            },
            billing: {
                getOrCreateAccount: async (user: string) => ({ login: user, planId: planId.current, updatedAt: '' }),
            },
            projects: {
                get: (user: string, repo: string) => (saved.has(`${user}|${repo}`) ? { memoryGb: saved.get(`${user}|${repo}`) } : undefined),
                set: (user: string, repo: string, memoryGb: number) => { saved.set(`${user}|${repo}`, memoryGb); },
            },
            orchestrator: {
                applyTenantResourceLimits: async (user: string) => { applied.push(user); return 1; },
            },
        });
        return endpoint;
    }

    beforeEach(() => {
        planId.current = 'starter';
    });

    it('answers 401 without a session', async () => {
        const res = makeRes();
        await (makeEndpoint(false) as any).handleGet({ query: { repo: 'acme/web' } }, res);
        expect(res.statusCode).to.equal(401);
    });

    it('GET returns the default choice and the plan options for an unsaved repository', async () => {
        const res = makeRes();
        await (makeEndpoint() as any).handleGet({ query: { repo: 'Acme/Web' } }, res);
        expect(res.statusCode).to.equal(200);
        expect(res.body).to.deep.equal({ repo: 'acme/web', memoryGb: 2, options: [2], plan: 'starter' });
    });

    it('GET rejects a missing or malformed repo', async () => {
        const missing = makeRes();
        await (makeEndpoint() as any).handleGet({ query: {} }, missing);
        expect(missing.statusCode).to.equal(400);
        expect(missing.body).to.deep.equal({ error: 'repo_required' });

        const malformed = makeRes();
        await (makeEndpoint() as any).handleGet({ query: { repo: 'acme' } }, malformed);
        expect(malformed.statusCode).to.equal(400);
        expect(malformed.body).to.deep.equal({ error: 'repo_invalid' });
    });

    it('POST refuses 4 GB on Starter with memory_not_in_plan and the allowed options', async () => {
        const endpoint = makeEndpoint();
        const res = makeRes();
        await (endpoint as any).handlePost({ body: { repo: 'acme/web', memoryGb: 4 } }, res);
        expect(res.statusCode).to.equal(400);
        expect(res.body).to.deep.equal({ error: 'memory_not_in_plan', options: [2], plan: 'starter' });
        expect(applied).to.deep.equal([]);
    });

    it('POST saves a Pro choice, applies it to the running tenant and returns the shape', async () => {
        planId.current = 'pro';
        const endpoint = makeEndpoint();
        const res = makeRes();
        await (endpoint as any).handlePost({ body: { repo: 'acme/web', memoryGb: 4 } }, res);
        expect(res.statusCode).to.equal(200);
        expect(res.body).to.deep.equal({ repo: 'acme/web', memoryGb: 4, options: [2, 4], plan: 'pro' });
        expect(applied).to.deep.equal(['alice']);
        const follow = makeRes();
        await (endpoint as any).handleGet({ query: { repo: 'acme/web' } }, follow);
        expect((follow.body as { memoryGb: number }).memoryGb).to.equal(4);
    });

    it('POST validates the repo and the memory type', async () => {
        const endpoint = makeEndpoint();
        const noRepo = makeRes();
        await (endpoint as any).handlePost({ body: { memoryGb: 2 } }, noRepo);
        expect(noRepo.body).to.deep.equal({ error: 'repo_required' });

        const badMemory = makeRes();
        await (endpoint as any).handlePost({ body: { repo: 'acme/web', memoryGb: '2' } }, badMemory);
        expect(badMemory.statusCode).to.equal(400);
        expect(badMemory.body).to.deep.equal({ error: 'memory_invalid' });
    });

    it('POST keeps the saved choice when the live update fails', async () => {
        planId.current = 'pro';
        const endpoint = makeEndpoint();
        Object.assign(endpoint, {
            orchestrator: { applyTenantResourceLimits: async () => { throw new Error('docker down'); } },
        });
        const res = makeRes();
        await (endpoint as any).handlePost({ body: { repo: 'acme/web', memoryGb: 2 } }, res);
        expect(res.statusCode).to.equal(200);
    });
});
