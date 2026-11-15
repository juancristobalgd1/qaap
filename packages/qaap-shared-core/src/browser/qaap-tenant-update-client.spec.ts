// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_TENANT_UPDATE_PATH, QaapTenantUpdateClient } from './qaap-tenant-update-client';

interface RecordedFetch {
    readonly url: string;
    readonly init: RequestInit | undefined;
}

/** Replaces the global `fetch` for one test and returns what was requested. */
function stubFetch(status: number, body: unknown): { calls: RecordedFetch[]; restore(): void } {
    const calls: RecordedFetch[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return {
        calls,
        restore: () => { globalThis.fetch = previous; },
    };
}

describe('QaapTenantUpdateClient', () => {

    describe('parseStatus', () => {

        it('keeps a valid answer as it is', () => {
            expect(QaapTenantUpdateClient.parseStatus({ updateAvailable: true, runningTasks: 2 }))
                .to.deep.equal({ updateAvailable: true, runningTasks: 2 });
        });

        it('treats anything but an explicit true as no update, and bad counts as zero turns', () => {
            expect(QaapTenantUpdateClient.parseStatus({ updateAvailable: 'yes', runningTasks: -4 }))
                .to.deep.equal({ updateAvailable: false, runningTasks: 0 });
            expect(QaapTenantUpdateClient.parseStatus({ runningTasks: Number.NaN }))
                .to.deep.equal({ updateAvailable: false, runningTasks: 0 });
            expect(QaapTenantUpdateClient.parseStatus(undefined))
                .to.deep.equal({ updateAvailable: false, runningTasks: 0 });
        });
    });

    it('reads the status from the control-plane route with the session cookie', async () => {
        const stub = stubFetch(200, { updateAvailable: true, runningTasks: 1 });
        try {
            const status = await new QaapTenantUpdateClient().fetchStatus();
            expect(status).to.deep.equal({ updateAvailable: true, runningTasks: 1 });
            expect(stub.calls).to.have.length(1);
            expect(stub.calls[0].url).to.equal(QAAP_TENANT_UPDATE_PATH);
            expect(stub.calls[0].init?.credentials).to.equal('include');
        } finally {
            stub.restore();
        }
    });

    it('rejects when the status request fails', async () => {
        const stub = stubFetch(503, {});
        try {
            let failed = false;
            try {
                await new QaapTenantUpdateClient().fetchStatus();
            } catch {
                failed = true;
            }
            expect(failed).to.equal(true);
        } finally {
            stub.restore();
        }
    });

    it('posts the update as JSON and reports whether it was applied', async () => {
        const stub = stubFetch(200, { applied: true });
        try {
            expect(await new QaapTenantUpdateClient().applyUpdate()).to.equal(true);
            expect(stub.calls[0].init?.method).to.equal('POST');
            expect((stub.calls[0].init?.headers as Record<string, string>)['Content-Type']).to.equal('application/json');
        } finally {
            stub.restore();
        }
    });

    it('reports not applied when the control plane had nothing to apply', async () => {
        const stub = stubFetch(200, { applied: false });
        try {
            expect(await new QaapTenantUpdateClient().applyUpdate()).to.equal(false);
        } finally {
            stub.restore();
        }
    });
});
