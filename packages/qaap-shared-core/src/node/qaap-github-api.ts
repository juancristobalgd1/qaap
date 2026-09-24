// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapAuthSessionUser,
    QaapGithubMergePullRequestResponse,
    QaapGithubPullRequestFile,
    QaapGithubPullRequestLine,
    QaapGithubPullRequestSummary,
    QaapGithubRepositorySummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapGithubOAuthConfig } from './qaap-github-oauth-config';

interface GithubTokenResponse {
    access_token?: string;
    error?: string;
    error_description?: string;
}

interface GithubUserResponse {
    login: string;
    name?: string | null;
    avatar_url?: string;
}

interface GithubRepoResponse {
    id: number;
    full_name: string;
    name: string;
    owner: { login: string };
    clone_url: string;
    html_url: string;
    default_branch: string;
    private: boolean;
    description?: string | null;
    updated_at: string;
}

interface GithubCreateRepoResponse extends GithubRepoResponse {
}

interface GithubPullResponse {
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    updated_at: string;
    user?: { login?: string | null } | null;
    head: { ref: string; sha: string; repo?: { full_name?: string | null } | null };
    base: { ref: string };
    changed_files: number;
    additions: number;
    deletions: number;
    mergeable?: boolean | null;
    state: 'open' | 'closed';
    draft?: boolean;
    merged_at?: string | null;
}

interface GithubPullFileResponse {
    filename: string;
    additions: number;
    deletions: number;
    patch?: string;
}

interface GithubMergePullResponse {
    merged?: boolean;
    message?: string;
    sha?: string;
}

/**
 * Per-request bound (headers + body) for every GitHub REST / OAuth call made by the backend.
 * Override with `QAAP_GITHUB_API_TIMEOUT_MS` (see packages/qaap-cloud-workspace/README.md).
 */
export function resolveGithubApiTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
    const configured = Number.parseInt(env.QAAP_GITHUB_API_TIMEOUT_MS?.trim() ?? '', 10);
    return Number.isInteger(configured) && configured > 0 ? configured : 30_000;
}

/** Overall budget for the pull request listing; stays below the browser's 60 s request timeout. */
const GITHUB_PULL_REQUESTS_DEADLINE_MS = 45_000;
/** Repositories scanned concurrently by the pull request listing. */
const GITHUB_PULL_REQUESTS_CONCURRENCY = 4;

/** Statuses whose `Response` must be constructed without a body. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * GitHub request with one deadline covering the headers AND the body: the body is buffered before
 * the timer is cleared, so a connection that stalls mid-body cannot hang the caller. Exported for tests.
 */
export async function fetchGithubRepositoryRequest(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs = resolveGithubApiTimeoutMs(),
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(input, { ...init, signal: controller.signal });
        const body = NULL_BODY_STATUSES.has(response.status) ? undefined : await response.arrayBuffer();
        return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    } catch (err) {
        if (controller.signal.aborted) {
            throw new Error(`GitHub repository request timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

export async function exchangeGithubCode(
    config: QaapGithubOAuthConfig,
    code: string
): Promise<string> {
    const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl,
    });
    const response = await fetchGithubRepositoryRequest('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });
    // GitHub answers errors (5xx, rate limits, maintenance) with HTML; parsing that as JSON used to
    // surface an opaque "Unexpected token <" instead of an OAuth error.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('json')) {
        throw new Error(`GitHub token exchange failed (HTTP ${response.status}${contentType ? `, ${contentType.split(';', 1)[0]}` : ''}).`);
    }
    const data = await response.json().catch(() => undefined) as GithubTokenResponse | undefined;
    if (!data) {
        throw new Error(`GitHub token exchange failed (HTTP ${response.status}, invalid JSON).`);
    }
    if (!response.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || `GitHub token exchange failed (HTTP ${response.status}).`);
    }
    return data.access_token;
}

export async function fetchGithubUser(accessToken: string): Promise<QaapAuthSessionUser> {
    const response = await fetchGithubRepositoryRequest('https://api.github.com/user', {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'Qaap-Theia',
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub user API failed (${response.status})`);
    }
    const user = await response.json() as GithubUserResponse;
    return {
        provider: 'github',
        login: user.login,
        name: user.name?.trim() || user.login,
        avatarUrl: user.avatar_url,
    };
}

export async function fetchGithubRepositories(accessToken: string): Promise<QaapGithubRepositorySummary[]> {
    const repos: QaapGithubRepositorySummary[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
        const url = new URL('https://api.github.com/user/repos');
        url.searchParams.set('per_page', String(perPage));
        url.searchParams.set('page', String(page));
        url.searchParams.set('sort', 'updated');
        url.searchParams.set('direction', 'desc');
        const response = await fetchGithubRepositoryRequest(url.toString(), {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${accessToken}`,
                'User-Agent': 'Qaap-Theia',
            },
        });
        if (!response.ok) {
            const error = new Error(`GitHub repositories API failed (${response.status})`) as Error & { status?: number };
            error.status = response.status;
            throw error;
        }
        const batch = await response.json() as GithubRepoResponse[];
        if (batch.length === 0) {
            break;
        }
        for (const repo of batch) {
            repos.push({
                id: repo.id,
                fullName: repo.full_name,
                owner: repo.owner.login,
                name: repo.name,
                cloneUrl: repo.clone_url,
                htmlUrl: repo.html_url,
                defaultBranch: repo.default_branch,
                private: repo.private,
                description: repo.description ?? undefined,
                updatedAt: repo.updated_at,
            });
        }
        if (batch.length < perPage) {
            break;
        }
        page += 1;
    }
    return repos;
}

export async function fetchGithubRepository(accessToken: string | undefined, owner: string, name: string): Promise<QaapGithubRepositorySummary> {
    const response = await fetchGithubRepositoryRequest(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        { headers: githubHeaders(accessToken) },
    );
    if (!response.ok) {
        throw new Error(`GitHub repository API failed (${response.status})`);
    }
    return githubRepoToSummary(await response.json() as GithubRepoResponse);
}

export async function createGithubRepository(
    accessToken: string,
    input: { name: string; private?: boolean; description?: string }
): Promise<QaapGithubRepositorySummary> {
    const response = await fetchGithubRepositoryRequest('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Qaap-Theia',
        },
        body: JSON.stringify({
            name: input.name,
            private: input.private ?? true,
            description: input.description || undefined,
            auto_init: true,
        }),
    });
    const data = await response.json() as GithubCreateRepoResponse & { message?: string };
    if (!response.ok) {
        throw new Error(data.message || `GitHub create repository API failed (${response.status})`);
    }
    return githubRepoToSummary(data);
}

export async function fetchGithubPullRequests(
    accessToken: string,
    repositories: QaapGithubRepositorySummary[],
    deadlineMs = GITHUB_PULL_REQUESTS_DEADLINE_MS,
): Promise<QaapGithubPullRequestSummary[]> {
    const reposToScan = repositories.slice(0, 30);
    const maxTotal = Math.min(24, Math.max(8, repositories.length * 2));
    const deadline = Date.now() + deadlineMs;
    // Results stay in repository order even though repositories are scanned concurrently.
    const perRepository: QaapGithubPullRequestSummary[][] = [];
    let collected = 0;
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (nextIndex < reposToScan.length && collected < maxTotal && deadline > Date.now()) {
            const index = nextIndex++;
            // One slow or failing repository must not fail the whole listing.
            const pulls = await fetchRepositoryPullRequests(accessToken, reposToScan[index], deadline).catch(() => []);
            perRepository[index] = pulls;
            collected += pulls.length;
        }
    };
    await Promise.all(Array.from({ length: Math.min(GITHUB_PULL_REQUESTS_CONCURRENCY, reposToScan.length) }, worker));
    return perRepository.flat().slice(0, maxTotal);
}

/** Time left before `deadline`, capped at the per-request GitHub timeout. */
function githubRequestBudgetMs(deadline: number): number {
    return Math.min(resolveGithubApiTimeoutMs(), deadline - Date.now());
}

async function fetchRepositoryPullRequests(
    accessToken: string,
    repo: QaapGithubRepositorySummary,
    deadline: number,
): Promise<QaapGithubPullRequestSummary[]> {
    const budget = githubRequestBudgetMs(deadline);
    if (budget <= 0) {
        return [];
    }
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('per_page', '3');
    const response = await fetchGithubRepositoryRequest(url.toString(), {
        headers: githubHeaders(accessToken),
    }, budget);
    if (!response.ok) {
        return [];
    }
    const batch = await response.json() as GithubPullResponse[];
    return Promise.all(batch.map(async pull => {
        const filesBudget = githubRequestBudgetMs(deadline);
        const filesPreview = filesBudget > 0
            ? await fetchGithubPullRequestFiles(accessToken, repo.owner, repo.name, pull.number, filesBudget)
            : [];
        return {
            owner: repo.owner,
            repo: repo.name,
            number: pull.number,
            title: pull.title,
            description: pull.body ?? undefined,
            branch: pull.head.ref,
            base: pull.base.ref,
            author: pull.user?.login || 'unknown',
            files: pull.changed_files,
            adds: pull.additions,
            dels: pull.deletions,
            tests: 'unknown' as const,
            state: pull.merged_at ? 'merged' as const : pull.state,
            draft: pull.draft === true,
            htmlUrl: pull.html_url,
            mergeable: pull.mergeable ?? undefined,
            filesPreview,
            updatedAt: pull.updated_at,
        };
    }));
}

export async function mergeGithubPullRequest(
    accessToken: string,
    input: { owner: string; repo: string; number: number }
): Promise<QaapGithubMergePullRequestResponse> {
    const response = await fetchGithubRepositoryRequest(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.number}/merge`,
        {
            method: 'PUT',
            headers: {
                ...githubHeaders(accessToken),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                merge_method: 'merge',
                commit_title: `Merge pull request #${input.number}`,
            }),
        }
    );
    const body = await response.json().catch(() => ({})) as GithubMergePullResponse;
    if (!response.ok) {
        throw new Error(body.message || `GitHub merge API failed (${response.status})`);
    }
    return {
        merged: body.merged === true,
        message: body.message || 'Pull request merged.',
        sha: body.sha,
    };
}

export async function fetchGithubPullRequestFiles(
    accessToken: string,
    owner: string,
    repo: string,
    number: number,
    timeoutMs = resolveGithubApiTimeoutMs(),
): Promise<QaapGithubPullRequestFile[]> {
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files`);
    url.searchParams.set('per_page', '8');
    let response: Response;
    try {
        response = await fetchGithubRepositoryRequest(url.toString(), {
            headers: githubHeaders(accessToken),
        }, timeoutMs);
    } catch {
        // The files preview is optional; a slow or failed call must not fail the whole PR list.
        return [];
    }
    if (!response.ok) {
        return [];
    }
    const files = await response.json() as GithubPullFileResponse[];
    return files.slice(0, 8).map(file => ({
        f: file.filename,
        ext: fileExtension(file.filename),
        adds: file.additions,
        dels: file.deletions,
        preview: parseGithubPatch(file.patch),
    }));
}

function parseGithubPatch(patch: string | undefined): QaapGithubPullRequestLine[] {
    if (!patch) {
        return [];
    }
    const preview: QaapGithubPullRequestLine[] = [];
    let oldLine = 0;
    let newLine = 0;
    for (const line of patch.split('\n')) {
        if (preview.length >= 16) {
            break;
        }
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) {
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[2]);
            continue;
        }
        if (line.startsWith('+++') || line.startsWith('---')) {
            continue;
        }
        if (line.startsWith('+')) {
            preview.push({ t: 'add', n: newLine++, s: line.slice(1) });
        } else if (line.startsWith('-')) {
            preview.push({ t: 'del', n: oldLine++, s: line.slice(1) });
        } else {
            preview.push({ t: 'ctx', n: newLine, s: line.startsWith(' ') ? line.slice(1) : line });
            oldLine += 1;
            newLine += 1;
        }
    }
    return preview;
}

function fileExtension(filename: string): string {
    const basename = filename.split('/').pop() || filename;
    const dot = basename.lastIndexOf('.');
    return dot > 0 ? basename.slice(dot + 1, dot + 5).toLowerCase() : 'file';
}

function githubHeaders(accessToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Qaap-Theia',
    };
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }
    return headers;
}

function githubRepoToSummary(repo: GithubRepoResponse): QaapGithubRepositorySummary {
    return {
        id: repo.id,
        fullName: repo.full_name,
        owner: repo.owner.login,
        name: repo.name,
        cloneUrl: repo.clone_url,
        htmlUrl: repo.html_url,
        defaultBranch: repo.default_branch,
        private: repo.private,
        description: repo.description ?? undefined,
        updatedAt: repo.updated_at,
    };
}
