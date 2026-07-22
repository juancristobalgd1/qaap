// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    createQaapJobLoopTrigger,
    deleteQaapJobLoopTemplate,
    QaapJobLoopManagementError,
    runQaapJobLoopTemplate,
    updateQaapJobLoopTemplate,
} from './qaap-job-loop-management-client';

describe('QaapJobLoopManagementClient', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('encodes identifiers and sends template revisions in JSON request bodies', async () => {
        const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
        globalThis.fetch = async (input, init) => {
            calls.push({ input, init });
            return { ok: true, status: 200, json: async () => ({ id: 'template' }) } as Response;
        };

        await updateQaapJobLoopTemplate('template/a', { revision: 4, name: 'Renamed' });
        await deleteQaapJobLoopTemplate('template/a', 5);

        expect(calls.map(call => String(call.input))).to.deep.equal([
            '/qaap/api/job-loop-templates/template%2Fa',
            '/qaap/api/job-loop-templates/template%2Fa',
        ]);
        expect(calls[0].init).to.include({ method: 'PATCH', credentials: 'include' });
        expect(calls[0].init?.headers).to.deep.equal({ 'Content-Type': 'application/json' });
        expect(calls[0].init?.body).to.equal(JSON.stringify({ revision: 4, name: 'Renamed' }));
        expect(calls[1].init?.body).to.equal(JSON.stringify({ revision: 5 }));
    });

    it('keeps run idempotency keys identical in the header and body', async () => {
        let init: RequestInit | undefined;
        globalThis.fetch = async (_input, requestInit) => {
            init = requestInit;
            return { ok: true, status: 201, json: async () => ({ loop: { id: 'loop' }, created: true }) } as Response;
        };

        await runQaapJobLoopTemplate('template/a', { idempotencyKey: 'run-42' });

        expect(init).to.include({ method: 'POST', credentials: 'include' });
        expect(init?.headers).to.deep.equal({ 'Content-Type': 'application/json', 'Idempotency-Key': 'run-42' });
        expect(init?.body).to.equal(JSON.stringify({ idempotencyKey: 'run-42' }));
    });

    it('returns a webhook secret only from the create response and normalizes endpoint errors', async () => {
        let requestCount = 0;
        globalThis.fetch = async () => {
            requestCount += 1;
            return requestCount === 1
                ? { ok: true, status: 201, json: async () => ({ trigger: { id: 'webhook' }, webhookSecret: 'secret-once' }) } as Response
                : { ok: false, status: 409, json: async () => ({ error: 'Template is stale.' }) } as Response;
        };

        const created = await createQaapJobLoopTrigger({ templateId: 'template', title: 'Webhook', type: 'webhook' });
        expect(created.webhookSecret).to.equal('secret-once');

        try {
            await deleteQaapJobLoopTemplate('template', 1);
            expect.fail('Expected a management error.');
        } catch (error) {
            expect(error).to.be.instanceOf(QaapJobLoopManagementError);
            expect(error).to.include({ status: 409, message: 'Template is stale.' });
        }
    });
});
