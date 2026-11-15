// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { fetchQaapGithubRepositories } from './qaap-github-auth-client';
import { QaapApiRequestError } from './qaap-github-auth-client';
import { pollQaapGithubDeviceFlow, startQaapGithubDeviceFlow } from './qaap-github-device-client';

describe('qaap GitHub sign-in client', () => {
    const originalFetch = globalThis.fetch;
    let requests: Array<{ url: string; method?: string; body?: string }>;

    beforeEach(() => {
        requests = [];
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function respondWith(status: number, body: unknown): void {
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), method: init?.method, body: typeof init?.body === 'string' ? init.body : undefined });
            return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
    }

    it('lists repositories as a sign-in-required error (not a session expiry) on a desktop 401', async () => {
        respondWith(401, { code: 'github_sign_in_required', error: 'GitHub sign-in required' });
        let error: unknown;
        try {
            await fetchQaapGithubRepositories();
        } catch (err) {
            error = err;
        }
        expect(error).to.be.instanceOf(QaapApiRequestError);
        expect((error as QaapApiRequestError).code).to.equal('github_sign_in_required');
        expect((error as QaapApiRequestError).status).to.equal(401);
    });

    it('keeps the expired-session error for any other 401', async () => {
        respondWith(401, { error: 'GitHub session expired', signedIn: false });
        let error: unknown;
        try {
            await fetchQaapGithubRepositories();
        } catch (err) {
            error = err;
        }
        expect((error as { code?: string }).code).to.equal('session_expired');
    });

    it('starts a device sign-in with a POST and returns the flow without a device code', async () => {
        respondWith(200, { flowId: 'f1', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900 });
        const start = await startQaapGithubDeviceFlow();
        expect(start.flowId).to.equal('f1');
        expect(requests[0]).to.deep.include({ url: '/qaap/api/github/device/start', method: 'POST' });
    });

    it('polls with the flow id only', async () => {
        respondWith(200, { status: 'pending', interval: 5 });
        expect(await pollQaapGithubDeviceFlow('f1')).to.deep.equal({ status: 'pending', interval: 5 });
        expect(requests[0].url).to.equal('/qaap/api/github/device/poll');
        expect(JSON.parse(requests[0].body ?? '{}')).to.deep.equal({ flowId: 'f1' });
    });
});
