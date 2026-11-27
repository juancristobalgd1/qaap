// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    refreshControlPlaneConnectionToken,
    resetControlPlaneConnectionTokenRefreshForTests,
} from './qaap-ws-connection-token-refresh';

describe('refreshControlPlaneConnectionToken', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        resetControlPlaneConnectionTokenRefreshForTests();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        resetControlPlaneConnectionTokenRefreshForTests();
    });

    it('fetches /qaap/api/health with credentials and throttles rapid repeats', async () => {
        const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
        globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
            calls.push({ input, init });
            return { ok: true, status: 200 } as Response;
        }) as unknown as typeof fetch;

        await refreshControlPlaneConnectionToken(10_000);
        await refreshControlPlaneConnectionToken(11_000);
        await refreshControlPlaneConnectionToken(16_000);

        expect(calls).to.have.length(2);
        expect(calls[0].input).to.equal('/qaap/api/health');
        expect(calls[0].init?.credentials).to.equal('include');
        expect(calls[0].init?.cache).to.equal('no-store');
    });

    it('deduplicates concurrent in-flight refreshes and swallows fetch errors', async () => {
        let count = 0;
        globalThis.fetch = (async () => {
            count++;
            throw new Error('offline');
        }) as unknown as typeof fetch;

        await Promise.all([
            refreshControlPlaneConnectionToken(20_000),
            refreshControlPlaneConnectionToken(20_000),
        ]);
        expect(count).to.equal(1);
    });
});
