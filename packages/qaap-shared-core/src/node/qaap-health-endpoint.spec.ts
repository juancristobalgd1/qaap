// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import { QaapHealthCheckContribution } from './qaap-health-check-contribution';

describe('GET /qaap/api/health', () => {

    function health(checks: QaapHealthCheckContribution[], query: Record<string, string> = {}): { status: number; body: Record<string, unknown> } {
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            auth: { isSkipAuthEnabled: () => false },
            healthChecks: { getContributions: () => checks },
        });
        const reply = { status: 200, body: {} as Record<string, unknown> };
        interface FakeResponse { status(code: number): FakeResponse; json(body: Record<string, unknown>): void }
        const res: FakeResponse = {
            status(code: number): FakeResponse {
                reply.status = code;
                return res;
            },
            json(body: Record<string, unknown>): void {
                reply.body = body;
            },
        };
        (endpoint as unknown as { handleHealth(req: object, response: typeof res): void }).handleHealth({ query }, res);
        return reply;
    }

    const storage = (healthy: boolean): QaapHealthCheckContribution => ({
        id: 'agentStorage',
        check: () => ({ healthy, detail: { recovery: healthy ? 'ready' : 'failed' } }),
    });

    it('answers 200 with every check while dependencies are healthy', () => {
        const reply = health([storage(true)]);
        expect(reply.status).to.equal(200);
        expect(reply.body.ok).to.equal(true);
        expect(reply.body.checks).to.deep.equal({ agentStorage: { healthy: true, detail: { recovery: 'ready' } } });
    });

    it('answers 503 when storage is unhealthy, so Docker and the deploy gates notice', () => {
        const reply = health([storage(false)]);
        expect(reply.status).to.equal(503);
        expect(reply.body.ok).to.equal(false);
    });

    it('treats a throwing check as unhealthy and logs the error instead of returning it', () => {
        const originalWarn = console.warn;
        const warnings: string[] = [];
        console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
        try {
            const reply = health([{ id: 'broken', check: () => { throw new Error('SQLITE_IOERR: /data/agents.db'); } }]);
            expect(reply.status).to.equal(503);
            expect(reply.body.checks).to.deep.equal({ broken: { healthy: false } });
            expect(JSON.stringify(reply.body)).to.not.contain('SQLITE_IOERR');
            expect(warnings.join('\n')).to.contain('SQLITE_IOERR: /data/agents.db');
        } finally {
            console.warn = originalWarn;
        }
    });

    it('keeps the liveness probe (tenant wake-up) at 200 regardless of storage', () => {
        const reply = health([storage(false)], { probe: 'liveness' });
        expect(reply.status).to.equal(200);
        expect(reply.body.ok).to.equal(true);
        expect(reply.body.checks).to.equal(undefined);
    });
});
