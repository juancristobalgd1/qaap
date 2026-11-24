// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as qaapAuthSession from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import * as qaapGithubAuthClient from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { QAAP_GITHUB_SIGN_IN_REQUIRED_CODE } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapUserFacingError } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';
import { loadGithubProjectsExtracted, resetGithubSignInRequiredBackoffForTests } from './mobile-projects-service-timeline';
import type { MobileProjectsServiceContext } from './mobile-projects-service-context';

describe('mobile-projects-service-timeline: GitHub sign-in required backoff', () => {

    const ctx = {
        readPinnedProjectIds: () => new Set<string>(),
        currentGithubRepositoryFullName: () => undefined,
    } as unknown as MobileProjectsServiceContext;

    const signInRequired = (): Error => new qaapGithubAuthClient.QaapApiRequestError(
        'Sign in with GitHub to import your repositories.',
        401,
        QAAP_GITHUB_SIGN_IN_REQUIRED_CODE,
    );

    let clock: sinon.SinonFakeTimers;
    let signedIn: sinon.SinonStub;
    let fetchRepositories: sinon.SinonStub;
    let info: sinon.SinonStub;
    let warn: sinon.SinonStub;

    beforeEach(() => {
        resetGithubSignInRequiredBackoffForTests();
        clock = sinon.useFakeTimers({ toFake: ['Date'], now: 1_700_000_000_000 });
        signedIn = sinon.stub(qaapAuthSession, 'readQaapSignedIn').returns(true);
        fetchRepositories = sinon.stub(qaapGithubAuthClient, 'fetchQaapGithubRepositories').rejects(signInRequired());
        info = sinon.stub(console, 'info');
        warn = sinon.stub(console, 'warn');
    });

    afterEach(() => {
        sinon.restore();
        clock.restore();
    });

    it('does not repeat the request or the log while GitHub sign-in is required', async () => {
        for (let call = 0; call < 5; call++) {
            expect(await loadGithubProjectsExtracted(ctx, new Map(), false)).to.deep.equal([]);
        }
        expect(fetchRepositories.callCount).to.equal(1);
        expect(info.callCount).to.equal(1);
        expect(warn.callCount).to.equal(0);
    });

    it('backs off the same way when the stored GitHub token expired (session_expired)', async () => {
        fetchRepositories.rejects(new QaapUserFacingError('Your GitHub session expired. Please sign in again.', 401, 'session_expired'));
        for (let call = 0; call < 5; call++) {
            expect(await loadGithubProjectsExtracted(ctx, new Map(), false)).to.deep.equal([]);
        }
        expect(fetchRepositories.callCount).to.equal(1);
        expect(info.callCount).to.equal(1);
        expect(warn.callCount).to.equal(0);
    });

    it('retries once the backoff has elapsed', async () => {
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        clock.tick(59_000);
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        expect(fetchRepositories.callCount).to.equal(1);
        clock.tick(2_000);
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        expect(fetchRepositories.callCount).to.equal(2);
    });

    it('always asks when the import dialog surfaces the sign-in requirement', async () => {
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        let thrown: unknown;
        try {
            await loadGithubProjectsExtracted(ctx, new Map(), true, true);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).to.be.instanceOf(qaapGithubAuthClient.QaapApiRequestError);
        expect(fetchRepositories.callCount).to.equal(2);
    });

    it('hands an expired GitHub token to the import dialog instead of an empty list', async () => {
        fetchRepositories.rejects(new QaapUserFacingError('Your GitHub session expired. Please sign in again.', 401, 'session_expired'));
        let thrown: unknown;
        try {
            await loadGithubProjectsExtracted(ctx, new Map(), true, true);
        } catch (err) {
            thrown = err;
        }
        // Was: an empty list, so the dialog said "Sign in with GitHub" under "Connected as <login>".
        expect((thrown as { code?: string } | undefined)?.code).to.equal('session_expired');
    });

    it('stops backing off after a local sign-out and logs again on the next episode', async () => {
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        signedIn.returns(false);
        expect(await loadGithubProjectsExtracted(ctx, new Map(), false)).to.deep.equal([]);
        expect(fetchRepositories.callCount).to.equal(1);
        signedIn.returns(true);
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        expect(fetchRepositories.callCount).to.equal(2);
        expect(info.callCount).to.equal(2);
    });

    it('clears the backoff after a successful load', async () => {
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        fetchRepositories.resolves({ repositories: [] });
        clock.tick(60_000);
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        fetchRepositories.rejects(signInRequired());
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        expect(fetchRepositories.callCount).to.equal(3);
        expect(info.callCount).to.equal(2);
    });

    it('keeps warning for other failures on every call', async () => {
        fetchRepositories.rejects(new Error('boom'));
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        await loadGithubProjectsExtracted(ctx, new Map(), false);
        expect(fetchRepositories.callCount).to.equal(2);
        expect(warn.callCount).to.equal(2);
    });
});
