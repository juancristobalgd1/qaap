// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { QaapGithubRepositorySummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapGithubOAuthConfig } from './qaap-github-oauth-config';
import { exchangeGithubCode, fetchGithubPullRequests, mergeGithubPullRequest, fetchGithubRepositoryRequest, resolveGithubApiTimeoutMs } from './qaap-github-api';

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

    const MERGE_INPUT = { owner: 'octocat', repo: 'hello', number: 7 };

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
        expect(calls).to.deep.equal([
            'PUT https://api.github.com/repos/octocat/hello/pulls/7/merge',
            'GET https://api.github.com/repos/octocat/hello/pulls/7',
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
            return json({ message: 'Pull Request is not mergeable' }, 405);
        };
        expect((await mergeRejection()).message).to.equal('Pull Request is not mergeable');
        expect(calls).to.have.length(1);
    });

    it('reads the per-request timeout from QAAP_GITHUB_API_TIMEOUT_MS', () => {
        expect(resolveGithubApiTimeoutMs({})).to.equal(30_000);
        expect(resolveGithubApiTimeoutMs({ QAAP_GITHUB_API_TIMEOUT_MS: '5000' })).to.equal(5_000);
        expect(resolveGithubApiTimeoutMs({ QAAP_GITHUB_API_TIMEOUT_MS: 'nope' })).to.equal(30_000);
    });
});
