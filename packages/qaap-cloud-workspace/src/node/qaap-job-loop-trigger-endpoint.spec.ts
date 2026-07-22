// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapJobLoopManagementLockTimeoutError } from './qaap-job-loop-management-lock';
import { QaapJobLoopTriggerEndpoint } from './qaap-job-loop-trigger-endpoint';

interface FakeResponse {
    statusCode: number;
    body: unknown;
    status(code: number): FakeResponse;
    json(value: unknown): FakeResponse;
}
const response = (): FakeResponse => ({
    statusCode: 200, body: undefined,
    status(code: number): FakeResponse { this.statusCode = code; return this; },
    json(value: unknown): FakeResponse { this.body = value; return this; },
});

describe('QaapJobLoopTriggerEndpoint', () => {
    it('requires an authenticated owner to own the selected template', async () => {
        const endpoint = Object.create(QaapJobLoopTriggerEndpoint.prototype) as QaapJobLoopTriggerEndpoint;
        let created = false;
        Object.assign(endpoint, {
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }) },
            managementLock: { runExclusive: (operation: () => Promise<unknown>) => operation() },
            templates: { get: () => undefined },
            store: { create: () => { created = true; } },
        });
        const res = response();
        await (endpoint as unknown as { create(req: unknown, res: unknown): Promise<void> }).create({
            body: { templateId: 'bob-template', title: 'Nightly', type: 'cron' },
        }, res);
        expect(res.statusCode).to.equal(404);
        expect(created).to.equal(false);
    });

    it('rejects an invalid webhook secret before dispatching', async () => {
        const endpoint = Object.create(QaapJobLoopTriggerEndpoint.prototype) as QaapJobLoopTriggerEndpoint;
        let dispatched = false;
        Object.assign(endpoint, {
            store: { verifyWebhookSecret: () => false },
            service: { fireWebhook: () => { dispatched = true; return Promise.resolve('accepted'); } },
        });
        const res = response();
        await (endpoint as unknown as { webhook(req: unknown, res: unknown): Promise<void> }).webhook({
            params: { id: 'trigger-1' }, header: () => 'wrong',
        }, res);
        expect(res.statusCode).to.equal(401);
        expect(dispatched).to.equal(false);
    });

    it('rejects a non-string template id before updating state', async () => {
        const endpoint = Object.create(QaapJobLoopTriggerEndpoint.prototype) as QaapJobLoopTriggerEndpoint;
        let locked = false;
        Object.assign(endpoint, {
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }) },
            managementLock: { runExclusive: () => { locked = true; } },
        });
        const res = response();
        await (endpoint as unknown as { update(req: unknown, res: unknown): Promise<void> }).update({
            body: { templateId: 42 }, params: { id: 'trigger-1' },
        }, res);

        expect(res.statusCode).to.equal(400);
        expect(locked).to.equal(false);
    });

    it('returns service unavailable when the shared management lock is busy', async () => {
        const endpoint = Object.create(QaapJobLoopTriggerEndpoint.prototype) as QaapJobLoopTriggerEndpoint;
        Object.assign(endpoint, {
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }) },
            managementLock: { runExclusive: () => Promise.reject(new QaapJobLoopManagementLockTimeoutError()) },
        });
        const res = response();
        await (endpoint as unknown as { create(req: unknown, res: unknown): Promise<void> }).create({
            body: { templateId: 'template-1', title: 'Nightly', type: 'cron' },
        }, res);

        expect(res.statusCode).to.equal(503);
    });

    it('reports an unexpected persistence failure as a server error', async () => {
        const endpoint = Object.create(QaapJobLoopTriggerEndpoint.prototype) as QaapJobLoopTriggerEndpoint;
        Object.assign(endpoint, {
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }) },
            managementLock: { runExclusive: (operation: () => Promise<unknown>) => operation() },
            templates: { get: () => ({ id: 'template-1' }) },
            store: { create: () => Promise.reject(new Error('disk full')) },
        });
        const res = response();
        await (endpoint as unknown as { create(req: unknown, res: unknown): Promise<void> }).create({
            body: { templateId: 'template-1', title: 'Nightly', type: 'cron' },
        }, res);

        expect(res.statusCode).to.equal(500);
    });
});
