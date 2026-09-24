// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    createQaapGithubRepository,
    deleteQaapGithubRepository,
    fetchQaapGithubPullRequests,
    fetchQaapProjectSessions,
    openQaapGithubRepository,
} from './qaap-github-auth-client';

describe('qaap-github-auth-client timeouts', () => {
    const originalFetch = globalThis.fetch;
    let nextFetch: (init: RequestInit | undefined) => Promise<Response>;
    let seenSignals: Array<AbortSignal | undefined>;

    beforeEach(() => {
        seenSignals = [];
        globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
            seenSignals.push(init?.signal ?? undefined);
            return nextFetch(init);
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function abortError(): Error {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        return error;
    }

    async function rejection(promise: Promise<unknown>): Promise<Error> {
        try {
            await promise;
        } catch (err) {
            return err as Error;
        }
        throw new Error('expected a rejection');
    }

    it('passes an abort signal on every request that used to be unbounded', async () => {
        nextFetch = async () => new Response(JSON.stringify({ sessions: [], pullRequests: [] }), { status: 200 });
        await fetchQaapProjectSessions();
        await fetchQaapGithubPullRequests(['a/b']);
        await deleteQaapGithubRepository('a', 'b');
        expect(seenSignals).to.have.length(3);
        expect(seenSignals.every(signal => signal instanceof AbortSignal)).to.equal(true);
    });

    it('maps an aborted request to a readable timeout error', async () => {
        nextFetch = async () => { throw abortError(); };
        expect((await rejection(fetchQaapGithubPullRequests())).message).to.contain('took too long');
        expect((await rejection(deleteQaapGithubRepository('a', 'b'))).message).to.contain('took too long');
        expect((await rejection(createQaapGithubRepository({ name: 'demo' }))).message).to.contain('took too long');
        expect((await rejection(fetchQaapProjectSessions())).message).to.contain('took too long');
    });

    it('reports a tenant proxy 504 on open/create as the same timeout, not a raw status', async () => {
        nextFetch = async () => new Response(JSON.stringify({ error: 'Tenant backend timed out' }), { status: 504 });
        expect((await rejection(openQaapGithubRepository('a', 'b'))).message).to.contain('took too long');
        expect((await rejection(createQaapGithubRepository({ name: 'demo' }))).message).to.contain('took too long');
    });

    it('keeps non-abort network errors unchanged', async () => {
        nextFetch = async () => { throw new TypeError('Failed to fetch'); };
        expect((await rejection(fetchQaapGithubPullRequests())).message).to.equal('Failed to fetch');
    });
});
