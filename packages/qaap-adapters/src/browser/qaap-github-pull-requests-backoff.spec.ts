// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { fetchQaapGithubPullRequests, fetchQaapGithubRepositories, searchQaapGithubPullRequests } from './qaap-github-auth-client';
import {
    activeGithubPullRequestsBackoff,
    recordGithubPullRequestsServerError,
    recordGithubPullRequestsSignInRequired,
    resetGithubPullRequestsBackoff,
} from './qaap-github-pull-requests-backoff';

describe('qaap-github-pull-requests-backoff', () => {
    const originalFetch = globalThis.fetch;
    const start = 1_700_000_000_000;
    let clock: sinon.SinonFakeTimers;
    let info: sinon.SinonStub;
    let fetchStub: sinon.SinonStub;

    beforeEach(() => {
        resetGithubPullRequestsBackoff();
        clock = sinon.useFakeTimers({ toFake: ['Date'], now: start });
        info = sinon.stub(console, 'info');
        fetchStub = sinon.stub();
        globalThis.fetch = fetchStub as typeof fetch;
    });

    afterEach(() => {
        sinon.restore();
        clock.restore();
        globalThis.fetch = originalFetch;
        resetGithubPullRequestsBackoff();
    });

    describe('state', () => {
        it('pauses the request for a minute after a 401 and never before', () => {
            recordGithubPullRequestsSignInRequired(start);
            expect(activeGithubPullRequestsBackoff(start + 59_000)?.reason).to.equal('sign-in');
            expect(activeGithubPullRequestsBackoff(start + 60_000)).to.equal(undefined);
        });

        it('doubles the server wait from 30 s and caps it at one minute', () => {
            const waits: number[] = [];
            for (let failure = 0; failure < 5; failure++) {
                const now = Date.now();
                recordGithubPullRequestsServerError(now);
                const retryAt = activeGithubPullRequestsBackoff(now)?.retryAt ?? now;
                waits.push(retryAt - now);
                // The request is allowed again at retryAt; the next 5xx then comes from that retry.
                clock.tick(retryAt - now);
            }
            expect(waits).to.deep.equal([30_000, 60_000, 60_000, 60_000, 60_000]);
        });

        it('logs one line per episode and a success starts a new one', () => {
            recordGithubPullRequestsServerError(start);
            recordGithubPullRequestsServerError(start + 5_000);
            recordGithubPullRequestsSignInRequired(start + 60_000);
            expect(info.callCount).to.equal(1);

            resetGithubPullRequestsBackoff();
            recordGithubPullRequestsSignInRequired(start + 120_000);
            expect(info.callCount).to.equal(2);
        });
    });

    describe('fetchQaapGithubPullRequests', () => {
        it('answers signed out for a minute after a 401 without sending another request', async () => {
            fetchStub.callsFake(async () => new Response('', { status: 401 }));
            expect((await fetchQaapGithubPullRequests(['acme/app'])).signedIn).to.equal(false);
            expect((await fetchQaapGithubPullRequests(['acme/app'])).signedIn).to.equal(false);
            expect(fetchStub.callCount).to.equal(1);

            clock.tick(60_000);
            await fetchQaapGithubPullRequests(['acme/app']);
            expect(fetchStub.callCount).to.equal(2);
        });

        it('throws on a 5xx, then sends nothing until the first backoff elapses', async () => {
            // A 500 is not retried by the GET transient layer (502/503/504 are), so one call is one answer.
            fetchStub.callsFake(async () => new Response('{}', { status: 500 }));
            let firstError: unknown;
            try {
                await fetchQaapGithubPullRequests(['acme/app']);
            } catch (err) {
                firstError = err;
            }
            expect(firstError).to.be.instanceOf(Error);

            let skipped: unknown;
            try {
                await fetchQaapGithubPullRequests(['acme/app']);
            } catch (err) {
                skipped = err;
            }
            expect((skipped as { code?: string }).code).to.equal('github_pull_requests_backoff');
            expect(fetchStub.callCount).to.equal(1);

            clock.tick(30_000);
            fetchStub.callsFake(async () => new Response(JSON.stringify({ pullRequests: [], signedIn: true }), { status: 200 }));
            expect((await fetchQaapGithubPullRequests(['acme/app'])).signedIn).to.equal(true);
            expect(fetchStub.callCount).to.equal(2);
        });
    });

    describe('searchQaapGithubPullRequests', () => {
        it('handles softAuth signedIn:false without 502 and pauses further requests for a minute', async () => {
            fetchStub.callsFake(async () => new Response(
                JSON.stringify({ pullRequests: [], page: 1, hasMore: false, signedIn: false, code: 'session_expired' }),
                { status: 200 },
            ));
            const first = await searchQaapGithubPullRequests({ state: 'open', view: 'all', page: 1 });
            const second = await searchQaapGithubPullRequests({ state: 'open', view: 'reviewing', page: 1 });
            expect(first.signedIn).to.equal(false);
            expect(second.signedIn).to.equal(false);
            expect(fetchStub.callCount).to.equal(1);
            expect(String(fetchStub.firstCall.args[0])).to.include('softAuth=1');
        });

        it('backs off after a 500 error', async () => {
            fetchStub.callsFake(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
            let firstError: unknown;
            try {
                await searchQaapGithubPullRequests({ state: 'open', view: 'all', page: 1 });
            } catch (err) {
                firstError = err;
            }
            expect(firstError).to.be.instanceOf(Error);

            let skipped: unknown;
            try {
                await searchQaapGithubPullRequests({ state: 'open', view: 'all', page: 1 });
            } catch (err) {
                skipped = err;
            }
            expect((skipped as { code?: string }).code).to.equal('github_pull_requests_backoff');
            expect(fetchStub.callCount).to.equal(1);
        });
    });

    describe('fetchQaapGithubRepositories', () => {
        it('deduplicates concurrent in-flight requests into one fetch', async () => {
            let resolveResponse: ((res: Response) => void) | undefined;
            fetchStub.callsFake(() => new Promise<Response>(resolve => { resolveResponse = resolve; }));
            const p1 = fetchQaapGithubRepositories({ softAuth: true });
            const p2 = fetchQaapGithubRepositories({ softAuth: true });
            expect(fetchStub.callCount).to.equal(1);
            resolveResponse!(new Response(JSON.stringify({ repositories: [] }), { status: 200 }));
            const [r1, r2] = await Promise.all([p1, p2]);
            expect(r1.repositories).to.deep.equal([]);
            expect(r2.repositories).to.deep.equal([]);
        });

        it('maps softAuth 200 signedIn:false to session_expired and skips repeats until bypassBackoff or expiry', async () => {
            fetchStub.callsFake(async () => new Response(
                JSON.stringify({ repositories: [], signedIn: false, code: 'session_expired' }),
                { status: 200 },
            ));
            let err1: unknown;
            try {
                await fetchQaapGithubRepositories({ softAuth: true });
            } catch (err) {
                err1 = err;
            }
            expect((err1 as { code?: string }).code).to.equal('session_expired');
            expect(fetchStub.callCount).to.equal(1);

            let err2: unknown;
            try {
                await fetchQaapGithubRepositories({ softAuth: true });
            } catch (err) {
                err2 = err;
            }
            expect((err2 as { code?: string }).code).to.equal('session_expired');
            expect(fetchStub.callCount).to.equal(1);

            let err3: unknown;
            try {
                await fetchQaapGithubRepositories({ softAuth: true, bypassBackoff: true });
            } catch (err) {
                err3 = err;
            }
            expect((err3 as { code?: string }).code).to.equal('session_expired');
            expect(fetchStub.callCount).to.equal(2);
        });
    });
});
