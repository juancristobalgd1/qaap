// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { probeQaapDevPreviewPort, probeQaapIdentityPreview, waitForQaapDevPreviewPort } from './qaap-dev-preview-client';

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
});
