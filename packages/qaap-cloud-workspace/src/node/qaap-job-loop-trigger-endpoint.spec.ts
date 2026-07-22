// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
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
    it('requires an authenticated owner to own the selected template', () => {
        const endpoint = Object.create(QaapJobLoopTriggerEndpoint.prototype) as QaapJobLoopTriggerEndpoint;
        let created = false;
        Object.assign(endpoint, {
            auth: { authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }) },
            templates: { get: () => undefined },
            store: { create: () => { created = true; } },
        });
        const res = response();
        (endpoint as unknown as { create(req: unknown, res: unknown): void }).create({ body: { templateId: 'bob-template', title: 'Nightly', type: 'cron' } }, res);
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
});
