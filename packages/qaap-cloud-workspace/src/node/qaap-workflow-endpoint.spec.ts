// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapWorkflowTemplateRegistry } from '../common/qaap-workflow-template-registry';
import { QaapWorkflowEndpoint } from './qaap-workflow-endpoint';

interface FakeRes {
    statusCode: number;
    body: unknown;
    status(code: number): FakeRes;
    json(body: unknown): FakeRes;
}

function fakeRes(): FakeRes {
    return {
        statusCode: 200,
        body: undefined,
        status(code: number) { this.statusCode = code; return this; },
        json(body: unknown) { this.body = body; return this; },
    };
}

interface Harness {
    endpoint: QaapWorkflowEndpoint;
    startCalls: { cwd: string; inputs: Record<string, string> }[];
    denyCalls: number;
}

function buildEndpoint(resolved: { kind: string; cwd?: string }): Harness {
    const state = { startCalls: [] as { cwd: string; inputs: Record<string, string> }[], denyCalls: 0 };
    const endpoint = Object.create(QaapWorkflowEndpoint.prototype) as QaapWorkflowEndpoint;
    Object.assign(endpoint, {
        templates: new QaapWorkflowTemplateRegistry(),
        auth: {
            resolveOwnedRepositoryCwd: () => resolved,
            denyForbidden: (res: FakeRes) => { state.denyCalls++; res.status(403); return false; },
        },
        requireAuth: () => ({ kind: 'authenticated', userLogin: 'ada' }),
        ownerLogin: () => 'ada',
        service: {
            start: async (_def: unknown, options: { cwd: string; inputs: Record<string, string> }) => {
                state.startCalls.push({ cwd: options.cwd, inputs: options.inputs });
                return { run: { id: 'run-1', status: 'running' }, def: { id: 'qaap.implement-then-review' }, createdAt: 1, updatedAt: 1 };
            },
        },
    });
    return {
        endpoint,
        get startCalls(): { cwd: string; inputs: Record<string, string> }[] { return state.startCalls; },
        get denyCalls(): number { return state.denyCalls; },
    };
}

const start = (endpoint: QaapWorkflowEndpoint, body: unknown, res: FakeRes): Promise<void> =>
    (endpoint as unknown as { handleStart(req: unknown, res: unknown): Promise<void> }).handleStart({ body }, res);

const validBody = {
    templateId: 'qaap.implement-then-review',
    cwd: '/repo',
    inputs: { task: 'fix the login bug' },
};

describe('QaapWorkflowEndpoint', () => {
    it('starts a run with the resolved canonical cwd', async () => {
        const h = buildEndpoint({ kind: 'ok', cwd: '/canonical/repo' });
        const res = fakeRes();
        await start(h.endpoint, validBody, res);
        expect(res.statusCode).to.equal(201);
        expect(h.startCalls).to.have.lengthOf(1);
        expect(h.startCalls[0].cwd).to.equal('/canonical/repo');
        expect(h.startCalls[0].inputs).to.deep.equal({ task: 'fix the login bug' });
    });

    it('404s an unknown template without reaching the service', async () => {
        const h = buildEndpoint({ kind: 'ok', cwd: '/canonical/repo' });
        const res = fakeRes();
        await start(h.endpoint, { ...validBody, templateId: 'nope' }, res);
        expect(res.statusCode).to.equal(404);
        expect(h.startCalls).to.have.lengthOf(0);
    });

    it('400s when a required input is missing, before resolving the cwd', async () => {
        const h = buildEndpoint({ kind: 'ok', cwd: '/canonical/repo' });
        const res = fakeRes();
        await start(h.endpoint, { ...validBody, inputs: {} }, res);
        expect(res.statusCode).to.equal(400);
        expect(h.startCalls).to.have.lengthOf(0);
    });

    it('denies a non-owned cwd without reaching the service', async () => {
        const h = buildEndpoint({ kind: 'denied' });
        const res = fakeRes();
        await start(h.endpoint, validBody, res);
        expect(h.denyCalls).to.equal(1);
        expect(h.startCalls).to.have.lengthOf(0);
    });

    it('400s a container cwd (needs-project) without reaching the service', async () => {
        const h = buildEndpoint({ kind: 'needs-project' });
        const res = fakeRes();
        await start(h.endpoint, validBody, res);
        expect(res.statusCode).to.equal(400);
        expect(h.startCalls).to.have.lengthOf(0);
    });

    it('drops non-string inputs instead of forwarding them', async () => {
        const h = buildEndpoint({ kind: 'ok', cwd: '/canonical/repo' });
        await start(h.endpoint, { ...validBody, inputs: { task: 'ok', evil: { $ref: 1 } } }, fakeRes());
        expect(h.startCalls[0].inputs).to.deep.equal({ task: 'ok' });
    });
});
