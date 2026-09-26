// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { QaapGithubRepositorySummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapGithubOAuthConfig } from './qaap-github-oauth-config';
import {
    GithubApiError,
    exchangeGithubCode,
    fetchGithubPullRequests,
    mergeGithubPullRequest,
    fetchGithubRepositoryRequest,
    resolveGithubApiTimeoutMs,
    searchGithubPullRequests,
} from './qaap-github-api';

describe('fetchGithubRepositoryRequest', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeEach(async () => {
        server = http.createServer((req, res) => {
            if (req.url === '/stall-body') {
                // Headers arrive promptly, then the body never finishes.
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.write('[{"id":');
                return;
            }
            if (req.url === '/no-content') {
                res.writeHead(204).end();
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Not Found' }));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    it('bounds the body read, not only the wait for headers', async () => {
        let error: unknown;
        try {
            await fetchGithubRepositoryRequest(`${baseUrl}/stall-body`, {}, 150);
        } catch (err) {
            error = err;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.contain('timed out');
    });

    it('returns a readable response with the upstream status', async () => {
        const response = await fetchGithubRepositoryRequest(`${baseUrl}/missing`, {}, 2_000);
        expect(response.ok).to.equal(false);
        expect(response.status).to.equal(404);
        expect(await response.json()).to.deep.equal({ message: 'Not Found' });
    });

    it('handles bodiless statuses', async () => {
        const response = await fetchGithubRepositoryRequest(`${baseUrl}/no-content`, {}, 2_000);
        expect(response.status).to.equal(204);
    });
});

describe('GitHub API wrappers with a stubbed fetch', () => {
    const originalFetch = globalThis.fetch;
    let handler: (url: string, init?: RequestInit) => Promise<Response>;

    beforeEach(() => {
        globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function repository(index: number): QaapGithubRepositorySummary {
        return {
            id: index,
            fullName: `octocat/repo-${index}`,
            owner: 'octocat',
            name: `repo-${index}`,
            cloneUrl: `https://github.com/octocat/repo-${index}.git`,
            htmlUrl: `https://github.com/octocat/repo-${index}`,
            defaultBranch: 'main',
            private: false,
            updatedAt: '2026-01-01T00:00:00Z',
        };
    }

    function pull(number: number): Record<string, unknown> {
        return {
            number, title: `PR ${number}`, body: undefined, head: { ref: 'feature' }, base: { ref: 'main' },
            user: { login: 'octocat' }, changed_files: 1, additions: 1, deletions: 0, state: 'open',
            html_url: `https://github.com/pr/${number}`, updated_at: '2026-01-01T00:00:00Z',
        };
    }

    function json(value: unknown, status = 200): Response {
        return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    }

    it('scans repositories with bounded parallelism and keeps repository order', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        handler = async url => {
            if (url.includes('/files')) {
                return json([]);
            }
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(resolve => setTimeout(resolve, 10));
            inFlight--;
            const index = Number(/repo-(\d+)/.exec(url)?.[1]);
            return json([pull(index)]);
        };
        const pulls = await fetchGithubPullRequests('token', Array.from({ length: 10 }, (_, index) => repository(index)));
        expect(maxInFlight).to.equal(4);
        expect(pulls.map(item => item.repo)).to.deep.equal(Array.from({ length: 10 }, (_, index) => `repo-${index}`));
    });

    it('returns what it has once the overall deadline passes', async () => {
        handler = async (url, init) => {
            if (url.includes('repo-0/pulls') && !url.includes('/files')) {
                return json([pull(1)]);
            }
            if (url.includes('/files')) {
                return json([]);
            }
            // Every other repository hangs until aborted.
            return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
        };
        const started = Date.now();
        const pulls = await fetchGithubPullRequests('token', [repository(0), repository(1), repository(2)], 150);
        expect(Date.now() - started).to.be.below(2_000);
        expect(pulls.map(item => item.repo)).to.deep.equal(['repo-0']);
    });

    it('turns an HTML error page from the OAuth token endpoint into a clear error', async () => {
        handler = async () => new Response('<html>Unicorn!</html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        let error: unknown;
        try {
            await exchangeGithubCode({ clientId: 'id', clientSecret: 'secret', callbackUrl: 'https://qaap.test/cb' } as QaapGithubOAuthConfig, 'code');
        } catch (err) {
            error = err;
        }
        expect((error as Error).message).to.equal('GitHub token exchange failed (HTTP 503, text/html).');
    });

    it('surfaces the OAuth error description from a JSON error', async () => {
        handler = async () => json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
        let error: unknown;
        try {
            await exchangeGithubCode({ clientId: 'id', clientSecret: 'secret', callbackUrl: 'https://qaap.test/cb' } as QaapGithubOAuthConfig, 'code');
        } catch (err) {
            error = err;
        }
        expect((error as Error).message).to.equal('The code passed is incorrect or expired.');
    });

    // The allowed merge methods are cached per repository, so every test uses its own repository.
    let mergeRepoCounter = 0;
    let MERGE_INPUT = { owner: 'octocat', repo: 'hello', number: 7 };
    beforeEach(() => {
        MERGE_INPUT = { owner: 'octocat', repo: `hello-${++mergeRepoCounter}`, number: 7 };
    });

    async function mergeRejection(): Promise<Error> {
        try {
            await mergeGithubPullRequest('token', MERGE_INPUT);
        } catch (err) {
            return err as Error;
        }
        throw new Error('expected a rejection');
    }

    it('reports success when the merge call failed but the pull request is merged', async () => {
        const calls: string[] = [];
        handler = async (url, init) => {
            calls.push(`${init?.method ?? 'GET'} ${url}`);
            if (url.endsWith('/merge')) {
                throw new TypeError('fetch failed');
            }
            return json({ ...pull(7), state: 'closed', merged_at: '2026-01-01T00:00:00Z', merge_commit_sha: 'abc123' });
        };
        const result = await mergeGithubPullRequest('token', MERGE_INPUT);
        expect(result).to.deep.equal({ merged: true, message: 'Pull request merged.', sha: 'abc123' });
        const repoUrl = `https://api.github.com/repos/octocat/${MERGE_INPUT.repo}`;
        expect(calls).to.deep.equal([
            `GET ${repoUrl}`,
            `PUT ${repoUrl}/pulls/7/merge`,
            `GET ${repoUrl}/pulls/7`,
        ]);
    });

    it('re-checks after a GitHub 5xx and says the pull request is still open', async () => {
        handler = async url => url.endsWith('/merge')
            ? json({ message: 'Server Error' }, 502)
            : json(pull(7));
        expect((await mergeRejection()).message).to.equal('Pull request #7 was not merged (Server Error). It is still open; try again.');
    });

    it('says the outcome is unknown when the re-check fails too', async () => {
        handler = async () => { throw new TypeError('fetch failed'); };
        expect((await mergeRejection()).message).to.contain('Could not confirm whether pull request #7 was merged');
    });

    it('does not re-check a definitive GitHub refusal', async () => {
        const calls: string[] = [];
        handler = async url => {
            calls.push(url);
            return url.endsWith('/merge') ? json({ message: 'Pull Request is not mergeable' }, 405) : json({});
        };
        expect((await mergeRejection()).message).to.equal('Pull Request is not mergeable');
        // Repository settings, then the merge; no re-read of the pull request.
        expect(calls.filter(url => url.endsWith('/merge'))).to.have.length(1);
        expect(calls.filter(url => url.includes('/pulls/7') && !url.endsWith('/merge'))).to.have.length(0);
    });

    function mergeMethodHandler(settings: Record<string, boolean>, bodies: string[], counts: { settings: number }): typeof handler {
        return async (url, init) => {
            if (url.endsWith('/merge')) {
                bodies.push(String(init?.body));
                return json({ merged: true, sha: 's', message: 'ok' });
            }
            counts.settings++;
            return json(settings);
        };
    }

    it('uses the first allowed merge method (merge, then squash, then rebase)', async () => {
        const cases: Array<[Record<string, boolean>, string]> = [
            [{}, 'merge'],
            [{ allow_merge_commit: false }, 'squash'],
            [{ allow_merge_commit: false, allow_squash_merge: false }, 'rebase'],
            [{ allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false }, 'merge'],
        ];
        for (const [settings, expected] of cases) {
            const bodies: string[] = [];
            handler = mergeMethodHandler(settings, bodies, { settings: 0 });
            const input = { owner: 'octocat', repo: `method-${++mergeRepoCounter}`, number: 1 };
            await mergeGithubPullRequest('token', input);
            expect(JSON.parse(bodies[0]).merge_method, JSON.stringify(settings)).to.equal(expected);
        }
    });

    it('reads the repository merge settings once and reuses them', async () => {
        const bodies: string[] = [];
        const counts = { settings: 0 };
        handler = mergeMethodHandler({ allow_merge_commit: false }, bodies, counts);
        await mergeGithubPullRequest('token', MERGE_INPUT);
        await mergeGithubPullRequest('token', MERGE_INPUT);
        expect(counts.settings).to.equal(1);
        expect(bodies.map(body => JSON.parse(body).merge_method)).to.deep.equal(['squash', 'squash']);
    });

    it('falls back to merge without caching when the settings cannot be read', async () => {
        const bodies: string[] = [];
        let settingsCalls = 0;
        handler = async (url, init) => {
            if (url.endsWith('/merge')) {
                bodies.push(String(init?.body));
                return json({ merged: true });
            }
            settingsCalls++;
            return json({ message: 'Not Found' }, 404);
        };
        await mergeGithubPullRequest('token', MERGE_INPUT);
        await mergeGithubPullRequest('token', MERGE_INPUT);
        expect(settingsCalls).to.equal(2);
        expect(bodies.map(body => JSON.parse(body).merge_method)).to.deep.equal(['merge', 'merge']);
    });

    it('reads the per-request timeout from QAAP_GITHUB_API_TIMEOUT_MS', () => {
        expect(resolveGithubApiTimeoutMs({})).to.equal(30_000);
        expect(resolveGithubApiTimeoutMs({ QAAP_GITHUB_API_TIMEOUT_MS: '5000' })).to.equal(5_000);
        expect(resolveGithubApiTimeoutMs({ QAAP_GITHUB_API_TIMEOUT_MS: 'nope' })).to.equal(30_000);
    });
});

describe('searchGithubPullRequests', () => {
    const originalFetch = globalThis.fetch;
    let handler: (url: string) => Promise<Response>;
    let lastUrl = '';

    beforeEach(() => {
        globalThis.fetch = ((input: RequestInfo | URL) => {
            lastUrl = String(input);
            return handler(lastUrl);
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('sends a sorted, paged search and maps items to partial summaries with merged state', async () => {
        handler = async () => new Response(JSON.stringify({
            total_count: 5000,
            incomplete_results: false,
            items: [
                {
                    number: 7, title: 'Merged one', html_url: 'https://github.com/octo/app/pull/7', updated_at: '2026-09-01T00:00:00Z',
                    state: 'closed', user: { login: 'octo' }, repository_url: 'https://api.github.com/repos/octo/app',
                    pull_request: { merged_at: '2026-09-01T00:00:00Z', html_url: 'https://github.com/octo/app/pull/7' },
                },
                {
                    number: 8, title: 'Closed one', html_url: 'https://github.com/acme/web/pull/8', updated_at: '2026-08-01T00:00:00Z',
                    state: 'closed', draft: false, user: { login: 'dev' }, repository_url: 'https://api.github.com/repos/acme/web',
                    pull_request: { merged_at: null },
                },
                { number: 9, title: 'An issue', state: 'open', updated_at: '2026-08-01T00:00:00Z', repository_url: 'https://api.github.com/repos/acme/web' },
            ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        const page = await searchGithubPullRequests('token', 'is:pr involves:octo', 2, 30);
        const url = new URL(lastUrl);
        expect(url.pathname).to.equal('/search/issues');
        expect(url.searchParams.get('q')).to.equal('is:pr involves:octo');
        expect(url.searchParams.get('sort')).to.equal('updated');
        expect(url.searchParams.get('order')).to.equal('desc');
        expect(url.searchParams.get('page')).to.equal('2');
        expect(page.totalCount).to.equal(1000);
        expect(page.pullRequests.map(pr => [pr.owner, pr.repo, pr.number, pr.state, pr.partial])).to.deep.equal([
            ['octo', 'app', 7, 'merged', true],
            ['acme', 'web', 8, 'closed', true],
        ]);
    });

    it('flags rate limits and treats pages past the search window as empty', async () => {
        handler = async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
        let error: unknown;
        try {
            await searchGithubPullRequests('token', 'is:pr involves:octo', 1, 30);
        } catch (err) {
            error = err;
        }
        expect(error).to.be.instanceOf(GithubApiError);
        expect((error as GithubApiError).rateLimited).to.equal(true);

        handler = async () => new Response('{}', { status: 422 });
        expect((await searchGithubPullRequests('token', 'is:pr involves:octo', 40, 30)).pullRequests).to.deep.equal([]);
    });
});
