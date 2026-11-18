// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { invalidateQaapAuthConfigCache } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileProjectsInboxPrUi, type MobileProjectsInboxPrHost } from './mobile-projects-inbox-pr-ui';

disableJSDOM();

const pullRequest = {
    owner: 'octo', repo: 'hello', number: 7, title: 'Fix', branch: 'fix', base: 'main', author: 'octo',
    files: 1, adds: 1, dels: 0, tests: 'unknown', state: 'open', draft: false,
    htmlUrl: 'https://github.com/octo/hello/pull/7', filesPreview: [], updatedAt: '2026-11-18T00:00:00Z',
} as unknown as QaapGithubPullRequestSummary;

const project = { id: 'github:octo/hello', github: { owner: 'octo', name: 'hello' } } as unknown as MobileProjectEntry;

const makeHost = (): MobileProjectsInboxPrHost => ({
    visible: false,
    hubView: 'review',
    transcriptSheet: undefined,
    inboxLoadGeneration: 0,
    inboxPullRequests: [],
    inboxPullRequestsLoading: false,
    inboxPullRequestsLoaded: false,
    inboxGithubSignedIn: undefined,
    inboxPullRequestsAbort: undefined,
    inboxStream: undefined,
    hubQueryUi: { projectsForCurrentHubList: () => [project] } as unknown as MobileProjectsInboxPrHost['hubQueryUi'],
    renderList: () => undefined,
});

describe('MobileProjectsInboxPrUi under skip-auth', () => {

    let requests: string[];
    let session: unknown;
    let previousFetch: typeof fetch;

    before(() => {
        disableJSDOM = enableJSDOM();
    });
    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        invalidateQaapAuthConfigCache();
        requests = [];
        previousFetch = globalThis.fetch;
        const respond = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
            const url = String(input);
            requests.push(url);
            if (url.includes('/auth/config')) {
                return respond({ skipAuth: true, githubOAuth: false });
            }
            if (url.includes('/auth/session')) {
                return respond(session);
            }
            if (url.includes('/pull-requests')) {
                return respond({ pullRequests: [pullRequest], signedIn: true });
            }
            return respond({});
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = previousFetch;
        invalidateQaapAuthConfigCache();
    });

    it('loads the pull requests of the hub repositories with the desktop GitHub credential', async () => {
        session = {
            signedIn: true,
            user: { provider: 'gitlab', login: 'dev', name: 'Dev User' },
            githubCredential: { source: 'gh-cli', user: { provider: 'github', login: 'octo', name: 'Octo' } },
        };
        const host = makeHost();
        await new MobileProjectsInboxPrUi(host).refreshInboxPullRequests();
        expect(host.inboxPullRequests.map(pr => pr.number)).to.deep.equal([7]);
        expect(host.inboxGithubSignedIn).to.equal(true);
        expect(host.inboxGithubLogin).to.equal('octo');
        expect(requests.filter(url => url.includes('/auth/session'))).to.have.length(1);
    });

    it('keeps the empty skip-auth inbox without a desktop credential', async () => {
        session = { signedIn: true, user: { provider: 'gitlab', login: 'dev', name: 'Dev User' } };
        const host = makeHost();
        await new MobileProjectsInboxPrUi(host).refreshInboxPullRequests();
        expect(host.inboxPullRequests).to.deep.equal([]);
        expect(host.inboxGithubSignedIn).to.equal(undefined);
        expect(requests.some(url => url.includes('/pull-requests'))).to.equal(false);
    });
});
