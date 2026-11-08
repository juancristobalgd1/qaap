// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapUsageEndpoint } from './qaap-usage-endpoint';

interface FakeResponse {
    statusCode: number;
    body: unknown;
    status(code: number): FakeResponse;
    json(payload: unknown): FakeResponse;
}

function fakeResponse(): FakeResponse {
    const response: FakeResponse = {
        statusCode: 200,
        body: undefined,
        status(code: number): FakeResponse {
            response.statusCode = code;
            return response;
        },
        json(payload: unknown): FakeResponse {
            response.body = payload;
            return response;
        },
    };
    return response;
}

describe('QaapUsageEndpoint', () => {

    const savedEnv = { ...process.env };

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) {
                delete process.env[key];
            }
        }
        Object.assign(process.env, savedEnv);
    });

    function endpointSignedInAs(login: string | undefined): QaapUsageEndpoint {
        const endpoint = new QaapUsageEndpoint();
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: login ? 'session' : 'unauthorized' }),
                resolveUserLogin: () => login,
            },
            scanner: {
                refreshInBackground: (): void => undefined,
                hasCompletedScan: (): boolean => true,
                getLedger: () => ({ allEntries: function* (): IterableIterator<never> { /* no usage */ }, skippedRecords: () => 0 }),
            },
            limits: { getLimits: async () => ({ providers: [] }) },
        });
        return endpoint;
    }

    function call(endpoint: QaapUsageEndpoint, method: 'handleSummary' | 'handleLimits', query: Record<string, string> = {}): FakeResponse {
        const response = fakeResponse();
        const request = { query, headers: {}, method: 'GET', path: '/x' };
        (endpoint as unknown as Record<string, (req: unknown, res: unknown) => Promise<void>>)[method](request, response);
        return response;
    }

    it('refuses on a hosted runtime that is not a per-tenant backend', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.QAAP_TENANT_BACKEND_MODE;
        const response = call(endpointSignedInAs('someone'), 'handleSummary');
        await new Promise(resolve => setImmediate(resolve));
        expect(response.statusCode).to.equal(403);
        expect(response.body).to.deep.equal({ error: 'Usage is only available with per-tenant backends' });
    });

    it('answers a summary on a local runtime after sign-in', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const response = call(endpointSignedInAs('someone'), 'handleSummary', { range: '30d', tz: 'UTC' });
        await new Promise(resolve => setImmediate(resolve));
        expect(response.statusCode).to.equal(200);
        expect(response.body).to.deep.include({ range: '30d', timezone: 'UTC', scanning: false, skippedRecords: 0 });
    });

    it('rejects unknown ranges, providers and timezones', async () => {
        delete process.env.NODE_ENV;
        const endpoint = endpointSignedInAs('someone');
        const badRange = call(endpoint, 'handleSummary', { range: '1y' });
        const badProvider = call(endpoint, 'handleSummary', { provider: 'vscode' });
        const badZone = call(endpoint, 'handleSummary', { tz: 'Mars/Olympus' });
        await new Promise(resolve => setImmediate(resolve));
        expect(badRange.statusCode).to.equal(400);
        expect(badProvider.statusCode).to.equal(400);
        expect(badZone.statusCode).to.equal(400);
    });

    it('parses a comma-separated provider filter and rejects any unknown id in it', () => {
        const endpoint = endpointSignedInAs('someone') as unknown as { parseProviderList(raw: string | undefined): string[] | undefined };
        expect(endpoint.parseProviderList(undefined)).to.deep.equal([]);
        expect(endpoint.parseProviderList('')).to.deep.equal([]);
        expect(endpoint.parseProviderList('claude, codex,claude')).to.deep.equal(['claude', 'codex']);
        expect(endpoint.parseProviderList('claude,vscode')).to.equal(undefined);
    });

    it('requires a signed-in user', async () => {
        delete process.env.NODE_ENV;
        const response = call(endpointSignedInAs(undefined), 'handleLimits');
        await new Promise(resolve => setImmediate(resolve));
        expect(response.statusCode).to.equal(401);
    });
});
