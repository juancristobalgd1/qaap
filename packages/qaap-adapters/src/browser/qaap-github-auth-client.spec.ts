// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
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

    it('marks an open as explicit only when the caller asks (the server never re-clones a removed project otherwise)', async () => {
        const bodies: Array<BodyInit | null | undefined> = [];
        nextFetch = async init => {
            bodies.push(init?.body);
            return new Response(JSON.stringify({ repository: {}, workspaceUri: 'file:///w' }), { status: 200 });
        };
        await openQaapGithubRepository('a', 'b');
        await openQaapGithubRepository('a', 'b', { explicit: true });
        expect(bodies).to.deep.equal([undefined, JSON.stringify({ explicit: true })]);
    });

    it('reports a tenant proxy 504 on open/create as the same timeout, not a raw status', async () => {
        nextFetch = async () => new Response(JSON.stringify({ error: 'Tenant backend timed out' }), { status: 504 });
        expect((await rejection(openQaapGithubRepository('a', 'b'))).message).to.contain('took too long');
        expect((await rejection(createQaapGithubRepository({ name: 'demo' }))).message).to.contain('took too long');
    });

    it('retries a transient gateway response when loading project sessions', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let calls = 0;
        try {
            nextFetch = async () => calls++ === 0
                ? new Response('{}', { status: 503 })
                : new Response('{"sessions":[]}', { status: 200 });
            const pending = fetchQaapProjectSessions();
            await clock.tickAsync(1_000);
            expect((await pending).sessions).to.deep.equal([]);
            expect(calls).to.equal(2);
        } finally {
            clock.restore();
        }
    });

    it('keeps non-abort network errors unchanged after the bounded transient retries', async () => {
        // A dropped connection is retried with backoff (qaap-transient-get); fake the backoff timers so
        // the test checks the final error instead of waiting out real retry delays.
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            let attempts = 0;
            nextFetch = async () => { attempts++; throw new TypeError('Failed to fetch'); };
            const pending = rejection(fetchQaapGithubPullRequests());
            await clock.tickAsync(60_000);
            expect((await pending).message).to.equal('Failed to fetch');
            expect(attempts).to.be.greaterThan(1);
        } finally {
            clock.restore();
        }
    });

    it('bounds the body read, not only the wait for headers', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            nextFetch = async init => {
                // Headers arrive, then the body stalls until the request is aborted.
                const body = new ReadableStream<Uint8Array>({
                    start: controller => {
                        controller.enqueue(new TextEncoder().encode('{"pullRequests":['));
                        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
                    },
                });
                return new Response(body, { status: 200 });
            };
            const pending = rejection(fetchQaapGithubPullRequests());
            await clock.tickAsync(60_000);
            expect((await pending).message).to.contain('took too long');
        } finally {
            clock.restore();
        }
    });
});
