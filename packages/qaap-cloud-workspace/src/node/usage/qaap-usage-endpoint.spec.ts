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

    function endpointSignedInAs(
        login: string | undefined,
        options: {
            readonly resolveOverrides?: (harnessId: string, owner: string | undefined) =>
                { readonly ok: true; readonly overrides: Readonly<Record<string, string>> }
                | { readonly ok: false; readonly error: string };
        } = {},
    ): QaapUsageEndpoint {
        const endpoint = new QaapUsageEndpoint();
        const makeScan = (key: string) => ({
            scanner: {
                refreshInBackground: (): void => undefined,
                hasCompletedScan: (): boolean => true,
                getLedger: () => ({ allEntries: function* (): IterableIterator<never> { /* no usage */ }, skippedRecords: () => 0 }),
            },
            target: { key, roots: {} },
        });
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: login ? 'session' : 'unauthorized' }),
                resolveUserLogin: () => login,
            },
            scanners: {
                forOwner: (owner: string) => {
                    owners.push(owner);
                    return makeScan(owner);
                },
                forHarnessInstance: (owner: string, instanceId: string, overrides: Readonly<Record<string, string>>) => {
                    instanceLookups.push({ owner, instanceId, overrides });
                    return makeScan(`${owner}:${instanceId}`);
                },
            },
            limits: {
                forOwner: (scan: { target: { key: string } }) => ({
                    getLimits: async () => ({ providers: [], scanKey: scan.target.key }),
                }),
            },
            ...(options.resolveOverrides ? {
                runner: {
                    resolveHarnessUsageHomeOverrides: options.resolveOverrides,
                },
            } : {}),
        });
        return endpoint;
    }

    let owners: string[] = [];
    let instanceLookups: Array<{ owner: string; instanceId: string; overrides: Readonly<Record<string, string>> }> = [];

    beforeEach(() => {
        owners = [];
        instanceLookups = [];
    });

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

    it('scans the agent home of the signed-in owner', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const endpoint = endpointSignedInAs('Alice');
        call(endpoint, 'handleSummary', { tz: 'UTC' });
        call(endpoint, 'handleLimits');
        await new Promise(resolve => setImmediate(resolve));
        expect(owners).to.deep.equal(['Alice', 'Alice']);
    });

    it('refuses a login other than the tenant of a per-tenant backend', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_LOGIN = 'alice';
        const other = call(endpointSignedInAs('mallory'), 'handleSummary', { tz: 'UTC' });
        const tenant = call(endpointSignedInAs('Alice'), 'handleSummary', { tz: 'UTC' });
        await new Promise(resolve => setImmediate(resolve));
        expect(other.statusCode).to.equal(403);
        expect(tenant.statusCode).to.equal(200);
        expect(owners).to.deep.equal(['Alice']);
    });

    it('requires a signed-in user', async () => {
        delete process.env.NODE_ENV;
        const response = call(endpointSignedInAs(undefined), 'handleLimits');
        await new Promise(resolve => setImmediate(resolve));
        expect(response.statusCode).to.equal(401);
    });

    it('scopes summary and limits to a harness instance when ?harness= is provided', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const endpoint = endpointSignedInAs('Alice', {
            resolveOverrides: (harnessId, owner) => {
                expect(owner).to.equal('Alice');
                const overrides: Record<string, string> = harnessId === 'codex#2'
                    ? { CODEX_HOME: '/Users/alice/.codex-work' }
                    : {};
                return { ok: true, overrides };
            },
        });
        const summary = call(endpoint, 'handleSummary', { tz: 'UTC', harness: 'codex#2' });
        const limits = call(endpoint, 'handleLimits', { harness: 'codex#2' });
        await new Promise(resolve => setImmediate(resolve));
        expect(summary.statusCode).to.equal(200);
        expect(limits.statusCode).to.equal(200);
        expect(instanceLookups).to.deep.equal([
            { owner: 'Alice', instanceId: 'codex#2', overrides: { CODEX_HOME: '/Users/alice/.codex-work' } },
            { owner: 'Alice', instanceId: 'codex#2', overrides: { CODEX_HOME: '/Users/alice/.codex-work' } },
        ]);
    });

    it('rejects unknown harness ids and invalid harness override folders with 400', async () => {
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
        const endpoint = endpointSignedInAs('Alice', {
            resolveOverrides: () => ({ ok: false, error: 'The configuration folder does not exist.' }),
        });
        const unknown = call(endpoint, 'handleSummary', { tz: 'UTC', harness: 'not-a-harness' });
        const badFolder = call(endpoint, 'handleLimits', { harness: 'codex#2' });
        await new Promise(resolve => setImmediate(resolve));
        expect(unknown.statusCode).to.equal(400);
        expect(badFolder.statusCode).to.equal(400);
        expect(badFolder.body).to.deep.equal({ error: 'The configuration folder does not exist.' });
    });
});
