// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapRetryBackoffDelayMs } from './qaap-retry-backoff';
import { fetchQaapGetWithTransientRetry } from './qaap-transient-get';

describe('Qaap transient GET retry', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('uses exponential jitter within the configured bounds', () => {
        expect(resolveQaapRetryBackoffDelayMs(0, { random: () => 0 })).to.equal(400);
        expect(resolveQaapRetryBackoffDelayMs(1, { random: () => 1 })).to.equal(1_200);
        expect(resolveQaapRetryBackoffDelayMs(20, { maxDelayMs: 2_000, random: () => 1 })).to.equal(2_000);
    });

    it('backs off after 502/503 and retries a dropped connection before recovering', async () => {
        const delays: number[] = [];
        const responses: Array<Response | Error> = [
            new Response('{}', { status: 502 }),
            new Response('{}', { status: 503 }),
            new TypeError('connection lost'),
            new Response('{"ok":true}', { status: 200 }),
        ];
        let calls = 0;
        globalThis.fetch = (async () => {
            const result = responses[calls++];
            if (result instanceof Error) {
                throw result;
            }
            return result;
        }) as typeof fetch;

        const response = await fetchQaapGetWithTransientRetry('/qaap/api/agent-tasks/all', {}, {
            random: () => 0.5,
            wait: async delayMs => { delays.push(delayMs); },
        });

        expect(response.status).to.equal(200);
        expect(calls).to.equal(4);
        expect(delays).to.deep.equal([500, 1_000, 2_000]);
    });

    it('returns a persistent gateway failure after the bounded retry budget', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            return new Response('{}', { status: 502 });
        }) as typeof fetch;

        const response = await fetchQaapGetWithTransientRetry('/qaap/api/agent-approvals', {}, {
            maxRetries: 2,
            wait: async () => undefined,
        });

        expect(response.status).to.equal(502);
        expect(calls).to.equal(3);
    });

    it('never retries a mutating request or an aborted GET', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            return new Response('{}', { status: 502 });
        }) as typeof fetch;
        const post = await fetchQaapGetWithTransientRetry('/qaap/api/agent-approvals/approval/approve', { method: 'POST' });
        expect(post.status).to.equal(502);
        expect(calls).to.equal(1);

        const controller = new AbortController();
        controller.abort();
        let fetchError: unknown;
        globalThis.fetch = (async () => {
            calls++;
            throw new DOMException('Aborted', 'AbortError');
        }) as typeof fetch;
        try {
            await fetchQaapGetWithTransientRetry('/qaap/api/agent-tasks/all', { signal: controller.signal }, {
                wait: async () => undefined,
            });
        } catch (error) {
            fetchError = error;
        }
        expect(fetchError).to.be.instanceOf(DOMException);
        expect(calls).to.equal(2);
    });
});
