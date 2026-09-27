// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { GithubApiError, type GithubPullRequestSearchPage } from './qaap-github-api';
import { QaapGithubPullRequestSearchService } from './qaap-github-pull-request-search-service';

function summary(repo: string, number: number, updatedAt: string, state: QaapGithubPullRequestSummary['state'] = 'open'): QaapGithubPullRequestSummary {
    return {
        owner: 'octo', repo, number, title: `${repo}#${number}`, branch: '', base: '', author: 'octo',
        files: 0, adds: 0, dels: 0, tests: 'unknown', state, htmlUrl: '', filesPreview: [], updatedAt, partial: true,
    };
}

describe('QaapGithubPullRequestSearchService', () => {
    let now = 0;
    let calls: Array<{ query: string; page: number }> = [];
    let results: Record<string, GithubPullRequestSearchPage | Error>;

    function createService(): QaapGithubPullRequestSearchService {
        return new QaapGithubPullRequestSearchService({
            now: () => now,
            perPage: 2,
            organizations: async () => ['acme'],
            search: async (_token, query, page) => {
                calls.push({ query, page });
                const result = results[`${query}@${page}`] ?? { pullRequests: [], totalCount: 0, incompleteResults: false };
                if (result instanceof Error) {
                    throw result;
                }
                return result;
            },
        });
    }

    beforeEach(() => {
        now = 1_000_000;
        calls = [];
        results = {
            'is:pr involves:octo@1': {
                pullRequests: [summary('a', 1, '2026-09-02T00:00:00Z'), summary('b', 2, '2026-09-04T00:00:00Z', 'merged')],
                totalCount: 3,
                incompleteResults: false,
            },
            'is:pr user:octo@1': {
                pullRequests: [summary('a', 1, '2026-09-02T00:00:00Z')],
                totalCount: 1,
                incompleteResults: false,
            },
            'is:pr org:acme@1': {
                pullRequests: [summary('c', 3, '2026-09-03T00:00:00Z', 'closed')],
                totalCount: 1,
                incompleteResults: false,
            },
            'is:pr involves:octo@2': {
                pullRequests: [summary('d', 4, '2026-08-01T00:00:00Z')],
                totalCount: 3,
                incompleteResults: false,
            },
        };
    });

    it('merges and dedupes every query, newest first, with pagination hint', async () => {
        const service = createService();
        const response = await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1 });
        expect(response.pullRequests.map(pr => pr.title)).to.deep.equal(['b#2', 'c#3', 'a#1']);
        expect(response.hasMore).to.equal(true);
        expect(calls.map(call => call.query)).to.deep.equal(['is:pr involves:octo', 'is:pr user:octo', 'is:pr org:acme']);
    });

    it('only re-queries searches that still have pages', async () => {
        const service = createService();
        await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1 });
        calls = [];
        const response = await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 2 });
        expect(calls).to.deep.equal([{ query: 'is:pr involves:octo', page: 2 }]);
        expect(response.pullRequests.map(pr => pr.title)).to.deep.equal(['d#4']);
        expect(response.hasMore).to.equal(false);
    });

    it('serves fresh pages from cache and bypasses it on force', async () => {
        const service = createService();
        await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1 });
        calls = [];
        await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1 });
        expect(calls).to.have.length(0);
        await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1, force: true });
        expect(calls).to.have.length(3);
        now += 61_000;
        calls = [];
        await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1 });
        expect(calls).to.have.length(3);
    });

    it('falls back to stale results and stops querying when rate limited', async () => {
        const service = createService();
        await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1 });
        now += 61_000;
        calls = [];
        results['is:pr involves:octo@1'] = new GithubApiError('rate limited', 403, true);
        const response = await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1 });
        expect(response.rateLimited).to.equal(true);
        expect(calls).to.have.length(1);
        expect(response.pullRequests.map(pr => pr.title)).to.deep.equal(['b#2', 'c#3', 'a#1']);
    });

    it('does not share cached pages between users', async () => {
        const service = createService();
        await service.search({ accessToken: 't', login: 'octo', state: 'all', page: 1 });
        calls = [];
        await service.search({ accessToken: 't2', login: 'someone', state: 'all', page: 1 });
        expect(calls.map(call => call.query)).to.deep.equal(['is:pr involves:someone', 'is:pr user:someone', 'is:pr org:acme']);
    });

    it('fails when every query fails without a rate limit', async () => {
        results = new Proxy({}, { get: () => new GithubApiError('boom', 500) }) as typeof results;
        const service = createService();
        let error: unknown;
        try {
            await service.search({ accessToken: 't', login: 'octo', state: 'open', page: 1 });
        } catch (err) {
            error = err;
        }
        expect(error).to.be.instanceOf(Error);
    });
});
