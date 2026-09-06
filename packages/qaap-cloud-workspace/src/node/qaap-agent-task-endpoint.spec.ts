// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapAgentTaskEndpoint } from './qaap-agent-task-endpoint';
import { QaapAgentQueueFullError } from './qaap-agent-queue-policy';
import { QaapAgentStorageUnavailableError } from './qaap-agent-storage-unavailable-error';

class TestableTaskEndpoint extends QaapAgentTaskEndpoint {
    detailForTest(req: Request, res: Response): Promise<void> {
        return this.handleDetail(req, res);
    }
    retryForTest(req: Request, res: Response): Promise<void> {
        return this.handleStorageRetry(req, res);
    }
    healthForTest(req: Request, res: Response): void {
        this.handleStorageHealth(req, res);
    }
    createForTest(req: Request, res: Response): Promise<void> {
        return this.handleCreate(req, res);
    }
}

describe('QaapAgentTaskEndpoint queue admission', () => {
    it('checks workspace freshness only after ownership is authorized', async () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        let owned = false;
        let snapshots = 0;
        let payload: unknown;
        Object.assign(endpoint, {
            requireAuth: () => ({}),
            auth: { ownsWorkspacePath: () => owned, denyForbidden: () => undefined },
            runner: { detail: async () => ({ id: 't', cwd: '/repo' }), checkTaskWorkspaceSnapshot: () => { snapshots++; return 'changed'; } }
        });
        const req = { params: { id: 't' }, query: { verifySnapshot: '1' } } as unknown as Request;
        const res = { set: () => undefined, json: (body: unknown) => { payload = body; } } as unknown as Response;
        await endpoint.detailForTest(req, res);
        expect(snapshots).to.equal(0);
        owned = true;
        await endpoint.detailForTest(req, res);
        expect(snapshots).to.equal(1);
        expect(payload).to.deep.equal({ id: 't', cwd: '/repo', workspaceSnapshot: 'changed' });
    });
    it('requires authentication to retry storage and reports the resulting state', async () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        let authorized = false;
        let calls = 0;
        const health = { ready: false, recovery: 'ready', writeFailed: true };
        Object.assign(endpoint, {
            requireAuth: () => authorized ? {} : undefined,
            runner: { retryStorage: async () => { calls++; return health; } }
        });
        let status = 0;
        const response = {
            set: () => response,
            status: (code: number) => { status = code; return response; },
            json: (body: unknown) => { expect(body).to.deep.equal(health); return response; }
        };
        await endpoint.retryForTest({} as Request, response as unknown as Response);
        expect(calls).to.equal(0);
        authorized = true;
        await endpoint.retryForTest({} as Request, response as unknown as Response);
        expect(calls).to.equal(1);
        expect(status).to.equal(503);
        health.ready = true;
        health.writeFailed = false;
        await endpoint.retryForTest({} as Request, response as unknown as Response);
        expect(status).to.equal(200);
    });
    it('exposes storage status only after authentication and prevents caching', () => {
        for (const authenticated of [false, true]) {
            for (const ready of [false, true]) {
                const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
                let reads = 0;
                const health = { ready, recovery: 'ready', writeFailed: !ready };
                Object.assign(endpoint, {
                    requireAuth: () => authenticated ? {} : undefined,
                    runner: { storageHealth: () => { reads++; return health; } }
                });
                let status = 0;
                let cache = '';
                let payload: unknown;
                const response = {
                    set: (_key: string, value: string) => { cache = value; return response; },
                    status: (code: number) => { status = code; return response; },
                    json: (body: unknown) => { payload = body; return response; }
                };
                endpoint.healthForTest({} as Request, response as unknown as Response);
                expect(reads).to.equal(authenticated ? 1 : 0);
                if (authenticated) {
                    expect(status).to.equal(ready ? 200 : 503);
                    expect(cache).to.equal('no-store');
                    expect(payload).to.deep.equal(health);
                } else {
                    expect(payload).to.equal(undefined);
                }
            }
        }
    });
    it('returns 429 for queue saturation and preserves 400 for invalid requests', async () => {
        for (const [error, expectedStatus] of [
            [new QaapAgentQueueFullError(), 429],
            [new QaapAgentStorageUnavailableError(), 503],
            [new Error('Invalid request'), 400]
        ] as const) {
            const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
            Object.assign(endpoint, {
                auth: {
                    authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                    resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: '/repo' })
                },
                runner: { create: () => { throw error; } }
            });
            let status = 0;
            let payload: unknown;
            const response = {
                status: (code: number) => { status = code; return response; },
                json: (body: unknown) => { payload = body; return response; }
            };
            await endpoint.createForTest({
                body: { cwd: '/repo', command: 'echo test' }, header: () => undefined
            } as unknown as Request, response as unknown as Response);
            expect(status).to.equal(expectedStatus);
            expect(payload).to.deep.equal({ error: error.message });
        }
    });
});
