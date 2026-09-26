// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapGithubPullRequestSummary } from './qaap-github-api-types';
import {
    GITHUB_SEARCH_QUERY_MAX_LENGTH,
    buildGithubPullRequestSearchQueries,
    githubPullRequestStateQualifiers,
    matchesGithubPullRequestStateFilter,
    mergeGithubPullRequestSummaries,
    parseGithubPullRequestStateFilter,
    parseGithubRepositoryApiUrl,
} from './qaap-github-pull-request-search';

function pr(overrides: Partial<QaapGithubPullRequestSummary> & { number: number }): QaapGithubPullRequestSummary {
    return {
        owner: 'octo',
        repo: 'app',
        title: `PR ${overrides.number}`,
        branch: 'feature',
        base: 'main',
        author: 'octo',
        files: 1,
        adds: 1,
        dels: 0,
        tests: 'unknown',
        state: 'open',
        htmlUrl: `https://github.com/octo/app/pull/${overrides.number}`,
        filesPreview: [],
        updatedAt: '2026-09-01T00:00:00Z',
        ...overrides,
    };
}

describe('qaap-github-pull-request-search', () => {

    describe('state filter', () => {
        it('maps chips to search qualifiers (closed excludes merged)', () => {
            expect(githubPullRequestStateQualifiers('all')).to.equal('');
            expect(githubPullRequestStateQualifiers('open')).to.equal('is:open');
            expect(githubPullRequestStateQualifiers('merged')).to.equal('is:merged');
            expect(githubPullRequestStateQualifiers('closed')).to.equal('is:closed is:unmerged');
        });

        it('parses unknown values as all', () => {
            expect(parseGithubPullRequestStateFilter('merged')).to.equal('merged');
            expect(parseGithubPullRequestStateFilter('bogus')).to.equal('all');
            expect(parseGithubPullRequestStateFilter(undefined)).to.equal('all');
        });

        it('matches summaries against each chip', () => {
            const open = { state: 'open' as const };
            const legacy = { state: undefined };
            const merged = { state: 'merged' as const };
            const closed = { state: 'closed' as const };
            expect([open, legacy, merged, closed].map(p => matchesGithubPullRequestStateFilter(p, 'all'))).to.deep.equal([true, true, true, true]);
            expect([open, legacy, merged, closed].map(p => matchesGithubPullRequestStateFilter(p, 'open'))).to.deep.equal([true, true, false, false]);
            expect([open, legacy, merged, closed].map(p => matchesGithubPullRequestStateFilter(p, 'merged'))).to.deep.equal([false, false, true, false]);
            expect([open, legacy, merged, closed].map(p => matchesGithubPullRequestStateFilter(p, 'closed'))).to.deep.equal([false, false, false, true]);
        });
    });

    describe('buildGithubPullRequestSearchQueries', () => {
        it('covers involvement and owned repositories for every state', () => {
            expect(buildGithubPullRequestSearchQueries({ login: 'octo', state: 'all' })).to.deep.equal([
                'is:pr involves:octo',
                'is:pr user:octo',
            ]);
            expect(buildGithubPullRequestSearchQueries({ login: 'octo', state: 'closed' })).to.deep.equal([
                'is:pr is:closed is:unmerged involves:octo',
                'is:pr is:closed is:unmerged user:octo',
            ]);
        });

        it('packs orgs and uncovered repositories into OR-ed chunk queries', () => {
            const queries = buildGithubPullRequestSearchQueries({
                login: 'octo',
                state: 'open',
                orgs: ['acme', 'ACME', 'octo'],
                repositories: ['octo/app', 'acme/web', 'other/lib', 'Other/Lib'],
            });
            expect(queries).to.deep.equal([
                'is:pr is:open involves:octo',
                'is:pr is:open user:octo',
                'is:pr is:open org:acme',
                'is:pr is:open repo:other/lib',
            ]);
        });

        it('drops values that could inject qualifiers and rejects an invalid login', () => {
            expect(buildGithubPullRequestSearchQueries({ login: 'bad login', state: 'all' })).to.deep.equal([]);
            const queries = buildGithubPullRequestSearchQueries({
                login: 'octo',
                state: 'all',
                orgs: ['evil org:x'],
                repositories: ['a/b is:open', 'no-slash', 'fine/repo.js'],
            });
            expect(queries).to.deep.equal(['is:pr involves:octo', 'is:pr user:octo', 'is:pr repo:fine/repo.js']);
        });

        it('keeps every query within the GitHub length limit and caps chunk queries', () => {
            const repositories = Array.from({ length: 60 }, (_, i) => `owner${i}/repository-with-a-long-name-${i}`);
            const queries = buildGithubPullRequestSearchQueries({ login: 'octo', state: 'merged', repositories });
            expect(queries).to.have.length(4);
            for (const query of queries) {
                expect(query.length).to.be.at.most(GITHUB_SEARCH_QUERY_MAX_LENGTH);
            }
            expect(buildGithubPullRequestSearchQueries({ login: 'octo', state: 'merged', repositories, maxChunkQueries: 0 })).to.have.length(2);
        });
    });

    describe('mergeGithubPullRequestSummaries', () => {
        it('dedupes case-insensitively, keeps the freshest copy and sorts newest first', () => {
            const stale = pr({ number: 1, state: 'open', updatedAt: '2026-09-01T00:00:00Z' });
            const fresh = pr({ number: 1, owner: 'Octo', state: 'merged', updatedAt: '2026-09-03T00:00:00Z', partial: true });
            const other = pr({ number: 2, updatedAt: '2026-09-02T00:00:00Z' });
            const merged = mergeGithubPullRequestSummaries([stale, other], [fresh]);
            expect(merged.map(p => [p.number, p.state])).to.deep.equal([[1, 'merged'], [2, 'open']]);
        });

        it('prefers a full summary over a partial one with the same timestamp', () => {
            const partial = pr({ number: 3, partial: true, branch: '' });
            const full = pr({ number: 3, branch: 'feature/x' });
            expect(mergeGithubPullRequestSummaries([partial], [full])[0].branch).to.equal('feature/x');
            expect(mergeGithubPullRequestSummaries([full], [partial])[0].branch).to.equal('feature/x');
        });

        it('sorts unparseable timestamps last', () => {
            const merged = mergeGithubPullRequestSummaries([pr({ number: 4, updatedAt: 'nope' }), pr({ number: 5 })]);
            expect(merged.map(p => p.number)).to.deep.equal([5, 4]);
        });
    });

    it('parses repository API urls from search results', () => {
        expect(parseGithubRepositoryApiUrl('https://api.github.com/repos/octo/app')).to.deep.equal({ owner: 'octo', repo: 'app' });
        expect(parseGithubRepositoryApiUrl('https://example.com/nope')).to.equal(undefined);
        expect(parseGithubRepositoryApiUrl(undefined)).to.equal(undefined);
    });
});
