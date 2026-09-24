// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { devPreviewProbeBackoffDelays, probeQaapDevPreviewPort, probeQaapIdentityPreview, waitForQaapDevPreviewPort } from './qaap-dev-preview-client';

describe('qaap-dev-preview-client cancellation', () => {
    const globals = globalThis as unknown as { window?: unknown; fetch: typeof fetch };
    const originalWindow = globals.window;
    const originalFetch = globals.fetch;
    let requests: number;

    beforeEach(() => {
        requests = 0;
        globals.window = { location: { origin: 'http://ide.test' } };
        // Never answers on its own: settles only when its signal aborts.
        globals.fetch = ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
            requests++;
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })) as typeof fetch;
    });

    afterEach(() => {
        globals.window = originalWindow;
        globals.fetch = originalFetch;
    });

    it('aborts the in-flight port and identity probes when the caller signal fires', async () => {
        const controller = new AbortController();
        const startedAt = Date.now();
        const port = probeQaapDevPreviewPort(5173, controller.signal);
        const identity = probeQaapIdentityPreview('abc', controller.signal);
        setTimeout(() => controller.abort(), 10);
        expect((await port).ready).to.equal(false);
        expect((await identity).ready).to.equal(false);
        expect(Date.now() - startedAt).to.be.lessThan(1000);
    });

    it('stops polling once aborted and keeps the no-signal signature working', async () => {
        const controller = new AbortController();
        const startedAt = Date.now();
        const waiting = waitForQaapDevPreviewPort(5173, { maxAttempts: 50, intervalMs: 1000, signal: controller.signal });
        setTimeout(() => controller.abort(), 10);
        expect(await waiting).to.equal(undefined);
        expect(requests).to.equal(1);
        expect(Date.now() - startedAt).to.be.lessThan(500);
        globals.fetch = (() => Promise.resolve(new Response(JSON.stringify({ ready: true, previewUrl: 'http://ide.test/qaap-dev/5173/' })))) as typeof fetch;
        expect((await probeQaapDevPreviewPort(5173)).ready).to.equal(true);
    });

    it('backs off ×1.5 up to 4 s while keeping the fixed schedule\'s sleep budget', () => {
        const delays = devPreviewProbeBackoffDelays(30, 500);
        expect(delays.slice(0, 4)).to.deep.equal([500, 750, 1125, 1687.5]);
        expect(Math.max(...delays)).to.equal(4000);
        expect(delays.reduce((sum, delay) => sum + delay, 0)).to.equal(29 * 500);
        expect(devPreviewProbeBackoffDelays(8, 5000).every(delay => delay === 5000)).to.equal(true);
        expect(devPreviewProbeBackoffDelays(1, 500)).to.deep.equal([]);
    });

    it('probes once per backoff step within the budget', async () => {
        globals.fetch = (() => {
            requests++;
            return Promise.resolve(new Response(JSON.stringify({ ready: false, previewUrl: '' })));
        }) as typeof fetch;
        const startedAt = Date.now();
        expect(await waitForQaapDevPreviewPort(5173, { maxAttempts: 5, intervalMs: 20 })).to.equal(undefined);
        // Budget 4 × 20 ms = 80 ms of sleep as [20, 30, 30] → 4 probes instead of 5.
        expect(requests).to.equal(4);
        expect(Date.now() - startedAt).to.be.at.least(75);
        requests = 0;
        expect(await waitForQaapDevPreviewPort(5173, { maxAttempts: 0 })).to.equal(undefined);
        expect(requests).to.equal(0);
    });
});
