// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { fetchQaapGithubPullRequests } from './qaap-github-auth-client';
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
});
