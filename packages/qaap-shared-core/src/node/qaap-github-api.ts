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
import { parseGithubRepositoryApiUrl } from '@theia/qaap-adapters/lib/common/qaap-github-pull-request-search';
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
    /** Merge settings; only reported to callers with push access. Absent means "unknown". */
    allow_merge_commit?: boolean;
    allow_squash_merge?: boolean;
    allow_rebase_merge?: boolean;
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
    merge_commit_sha?: string | null;
}

interface GithubSearchIssueItem {
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    updated_at: string;
    state: 'open' | 'closed';
    draft?: boolean;
    user?: { login?: string | null } | null;
    repository_url?: string;
    pull_request?: { merged_at?: string | null; html_url?: string } | null;
}

interface GithubSearchIssuesResponse {
    total_count?: number;
    incomplete_results?: boolean;
    items?: GithubSearchIssueItem[];
}

interface GithubOrgResponse {
    login?: string;
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

/** Error carrying the GitHub HTTP status and whether it was a (primary or secondary) rate limit. */
export class GithubApiError extends Error {
    constructor(message: string, readonly status: number, readonly rateLimited = false) {
        super(message);
    }
}

function isGithubRateLimitResponse(response: Response): boolean {
    if (response.status === 429) {
        return true;
    }
    return response.status === 403
        && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'));
}

/** GitHub search never serves more than the first 1000 results of a query. */
export const GITHUB_SEARCH_RESULT_CAP = 1000;

export interface GithubPullRequestSearchPage {
    pullRequests: QaapGithubPullRequestSummary[];
    /** GitHub `total_count`, capped at what search can actually page through. */
    totalCount: number;
    incompleteResults: boolean;
}

/**
 * One page of `GET /search/issues` for a pull-request query, sorted by last update. Items are mapped
 * to partial summaries (search omits branches, diff stats and files). Pages beyond the 1000-result
 * cap come back empty instead of failing.
 */
export async function searchGithubPullRequests(
    accessToken: string,
    query: string,
    page: number,
    perPage: number,
    timeoutMs = resolveGithubApiTimeoutMs(),
): Promise<GithubPullRequestSearchPage> {
    const url = new URL('https://api.github.com/search/issues');
    url.searchParams.set('q', query);
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    const response = await fetchGithubRepositoryRequest(url.toString(), { headers: githubHeaders(accessToken) }, timeoutMs);
    if (response.status === 422) {
        // Past the 1000-result window (or a query GitHub refuses): nothing more to show.
        return { pullRequests: [], totalCount: 0, incompleteResults: false };
    }
    if (!response.ok) {
        const rateLimited = isGithubRateLimitResponse(response);
        throw new GithubApiError(
            rateLimited ? 'GitHub search rate limit reached' : `GitHub search API failed (${response.status})`,
            response.status,
            rateLimited,
        );
    }
    const body = await response.json() as GithubSearchIssuesResponse;
    const pullRequests: QaapGithubPullRequestSummary[] = [];
    for (const item of body.items ?? []) {
        const repository = parseGithubRepositoryApiUrl(item.repository_url);
        if (!repository || !item.pull_request) {
            continue;
        }
        pullRequests.push({
            owner: repository.owner,
            repo: repository.repo,
            number: item.number,
            title: item.title,
            description: item.body ?? undefined,
            branch: '',
            base: '',
            author: item.user?.login || 'unknown',
            files: 0,
            adds: 0,
            dels: 0,
            tests: 'unknown',
            state: item.pull_request.merged_at ? 'merged' : item.state,
            draft: item.draft === true,
            htmlUrl: item.pull_request.html_url || item.html_url,
            filesPreview: [],
            updatedAt: item.updated_at,
            partial: true,
        });
    }
    return {
        pullRequests,
        totalCount: Math.min(GITHUB_SEARCH_RESULT_CAP, Math.max(0, body.total_count ?? 0)),
        incompleteResults: body.incomplete_results === true,
    };
}

/** Logins of the organizations the user belongs to (public memberships unless `read:org` was granted). */
export async function fetchGithubUserOrganizations(accessToken: string, timeoutMs = resolveGithubApiTimeoutMs()): Promise<string[]> {
    const response = await fetchGithubRepositoryRequest('https://api.github.com/user/orgs?per_page=100', {
        headers: githubHeaders(accessToken),
    }, timeoutMs);
    if (!response.ok) {
        throw new GithubApiError(`GitHub organizations API failed (${response.status})`, response.status, isGithubRateLimitResponse(response));
    }
    const orgs = await response.json() as GithubOrgResponse[];
    return Array.isArray(orgs) ? orgs.map(org => org.login ?? '').filter(Boolean) : [];
}

/** Full summary (branches, diff stats, mergeability, files preview) for one pull request. */
export async function fetchGithubPullRequestDetail(
    accessToken: string,
    owner: string,
    repo: string,
    number: number,
): Promise<QaapGithubPullRequestSummary> {
    const response = await fetchGithubRepositoryRequest(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
        { headers: githubHeaders(accessToken) },
    );
    if (!response.ok) {
        throw new GithubApiError(`GitHub pull request API failed (${response.status})`, response.status, isGithubRateLimitResponse(response));
    }
    const pull = await response.json() as GithubPullResponse;
    const filesPreview = await fetchGithubPullRequestFiles(accessToken, owner, repo, number);
    return githubPullToSummary(owner, repo, pull, filesPreview);
}

function githubPullToSummary(
    owner: string,
    repo: string,
    pull: GithubPullResponse,
    filesPreview: QaapGithubPullRequestFile[],
): QaapGithubPullRequestSummary {
    return {
        owner,
        repo,
        number: pull.number,
        title: pull.title,
        description: pull.body ?? undefined,
        branch: pull.head.ref,
        base: pull.base.ref,
        author: pull.user?.login || 'unknown',
        files: pull.changed_files ?? 0,
        adds: pull.additions ?? 0,
        dels: pull.deletions ?? 0,
        tests: 'unknown',
        state: pull.merged_at ? 'merged' : pull.state,
        draft: pull.draft === true,
        htmlUrl: pull.html_url,
        mergeable: pull.mergeable ?? undefined,
        filesPreview,
        updatedAt: pull.updated_at,
    };
}

export type GithubMergeMethod = 'merge' | 'squash' | 'rebase';

/** How long a repository's allowed merge methods are reused before GitHub is asked again. */
const GITHUB_MERGE_METHOD_TTL_MS = 5 * 60_000;
const githubMergeMethodCache = new Map<string, { method: GithubMergeMethod; expiresAt: number }>();

/**
 * Pick the first merge method the repository allows, in the order merge → squash → rebase, so repos
 * that disable merge commits no longer fail with 405. The answer is cached per repository for a few
 * minutes; if GitHub cannot be asked, fall back to `merge` without caching.
 */
export async function resolveGithubMergeMethod(accessToken: string, owner: string, repo: string): Promise<GithubMergeMethod> {
    const key = `${owner}/${repo}`.toLowerCase();
    const cached = githubMergeMethodCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.method;
    }
    let settings: GithubRepoResponse | undefined;
    try {
        const response = await fetchGithubRepositoryRequest(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
            { headers: githubHeaders(accessToken) },
        );
        settings = response.ok ? await response.json() as GithubRepoResponse : undefined;
    } catch {
        settings = undefined;
    }
    if (!settings) {
        return 'merge';
    }
    const method: GithubMergeMethod = settings.allow_merge_commit !== false ? 'merge'
        : settings.allow_squash_merge !== false ? 'squash'
            : settings.allow_rebase_merge !== false ? 'rebase'
                : 'merge';
    githubMergeMethodCache.set(key, { method, expiresAt: Date.now() + GITHUB_MERGE_METHOD_TTL_MS });
    return method;
}

/** Budget for re-reading a pull request after an ambiguous merge outcome. */
const GITHUB_MERGE_RECHECK_TIMEOUT_MS = 15_000;

/**
 * Merge a pull request. A timeout, network error or GitHub 5xx leaves the outcome unknown (GitHub
 * may have merged it anyway), so the pull request is re-read once: already merged reports success,
 * which makes a retried merge idempotent; otherwise the error says whether it is still open.
 */
export async function mergeGithubPullRequest(
    accessToken: string,
    input: { owner: string; repo: string; number: number }
): Promise<QaapGithubMergePullRequestResponse> {
    const pullUrl = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.number}`;
    const mergeMethod = await resolveGithubMergeMethod(accessToken, input.owner, input.repo);
    let response: Response;
    try {
        response = await fetchGithubRepositoryRequest(`${pullUrl}/merge`, {
            method: 'PUT',
            headers: {
                ...githubHeaders(accessToken),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                merge_method: mergeMethod,
                commit_title: `Merge pull request #${input.number}`,
            }),
        });
    } catch (err) {
        return confirmGithubPullRequestMerged(accessToken, pullUrl, input.number, err instanceof Error ? err.message : String(err));
    }
    const body = await response.json().catch(() => ({})) as GithubMergePullResponse;
    if (response.status >= 500) {
        return confirmGithubPullRequestMerged(accessToken, pullUrl, input.number, body.message || `GitHub merge API failed (${response.status})`);
    }
    if (!response.ok) {
        if (response.status === 405) {
            // Possibly a stale cached method (settings changed): ask GitHub again next time.
            githubMergeMethodCache.delete(`${input.owner}/${input.repo}`.toLowerCase());
        }
        throw new Error(body.message || `GitHub merge API failed (${response.status})`);
    }
    return {
        merged: body.merged === true,
        message: body.message || 'Pull request merged.',
        sha: body.sha,
    };
}

async function confirmGithubPullRequestMerged(
    accessToken: string,
    pullUrl: string,
    number: number,
    failure: string,
): Promise<QaapGithubMergePullRequestResponse> {
    let pull: GithubPullResponse | undefined;
    try {
        const response = await fetchGithubRepositoryRequest(pullUrl, { headers: githubHeaders(accessToken) }, GITHUB_MERGE_RECHECK_TIMEOUT_MS);
        pull = response.ok ? await response.json() as GithubPullResponse : undefined;
    } catch {
        pull = undefined;
    }
    if (pull?.merged_at) {
        return { merged: true, message: 'Pull request merged.', sha: pull.merge_commit_sha ?? undefined };
    }
    if (pull) {
        throw new Error(`Pull request #${number} was not merged (${failure}). It is still ${pull.state}; try again.`);
    }
    throw new Error(`Could not confirm whether pull request #${number} was merged (${failure}). Check it on GitHub before retrying.`);
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
