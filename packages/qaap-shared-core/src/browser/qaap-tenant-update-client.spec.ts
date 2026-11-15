// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_TENANT_RUNTIME_STATUS_PATH, QAAP_TENANT_UPDATE_PATH, QaapTenantUpdateClient } from './qaap-tenant-update-client';

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

    describe('parseUpdate', () => {

        it('keeps a valid pending update, its builds and its running turns', () => {
            expect(QaapTenantUpdateClient.parseUpdate({
                backendBuild: 'old5678',
                controlPlaneBuild: 'abc1234',
                updatePending: true,
                reason: 'agent-turns-running',
                runningTasks: 2,
            })).to.deep.equal({
                backendBuild: 'old5678',
                controlPlaneBuild: 'abc1234',
                updatePending: true,
                reason: 'agent-turns-running',
                runningTasks: 2,
            });
        });

        it('treats anything but an explicit true as nothing pending, and bad counts as zero turns', () => {
            expect(QaapTenantUpdateClient.parseUpdate({ updatePending: 'yes', runningTasks: -4 }))
                .to.deep.equal({ updatePending: false, runningTasks: 0 });
            expect(QaapTenantUpdateClient.parseUpdate({ updatePending: true, runningTasks: Number.NaN }))
                .to.deep.equal({ updatePending: true, runningTasks: 0 });
            expect(QaapTenantUpdateClient.parseUpdate(undefined))
                .to.deep.equal({ updatePending: false, runningTasks: 0 });
        });
    });

    it('reads the update field of the runtime status with the session cookie', async () => {
        const stub = stubFetch(200, { runtime: {}, update: { updatePending: true, runningTasks: 1 } });
        try {
            const update = await new QaapTenantUpdateClient().fetchBackendUpdate();
            expect(update).to.deep.equal({ updatePending: true, runningTasks: 1 });
            expect(stub.calls).to.have.length(1);
            expect(stub.calls[0].url).to.equal(QAAP_TENANT_RUNTIME_STATUS_PATH);
            expect(stub.calls[0].init?.credentials).to.equal('include');
        } finally {
            stub.restore();
        }
    });

    it('reports no update when the status carries no update field', async () => {
        const stub = stubFetch(200, { runtime: {} });
        try {
            expect(await new QaapTenantUpdateClient().fetchBackendUpdate()).to.equal(undefined);
        } finally {
            stub.restore();
        }
    });

    it('rejects when the status request fails', async () => {
        const stub = stubFetch(503, {});
        try {
            let failed = false;
            try {
                await new QaapTenantUpdateClient().fetchBackendUpdate();
            } catch {
                failed = true;
            }
            expect(failed).to.equal(true);
        } finally {
            stub.restore();
        }
    });

    it('posts the update as JSON to the update route and reports whether it was applied', async () => {
        const stub = stubFetch(200, { applied: true });
        try {
            expect(await new QaapTenantUpdateClient().applyUpdate()).to.equal(true);
            expect(stub.calls[0].url).to.equal(QAAP_TENANT_UPDATE_PATH);
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
