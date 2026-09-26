// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGithubPullRequestStateFilter, QaapGithubPullRequestSummary } from './qaap-github-api-types';

/** GitHub rejects search queries longer than 256 characters (qualifiers included). */
export const GITHUB_SEARCH_QUERY_MAX_LENGTH = 256;

/** Upper bound of `org:` / `repo:` chunk queries, to stay friendly with the 30 req/min search limit. */
export const GITHUB_PULL_REQUEST_SEARCH_MAX_CHUNK_QUERIES = 2;

export const QAAP_GITHUB_PULL_REQUEST_STATE_FILTERS: readonly QaapGithubPullRequestStateFilter[] = ['all', 'open', 'merged', 'closed'];

const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export interface GithubPullRequestSearchQueryInput {
    /** Signed-in GitHub login; required, every query is scoped to it or to an explicit repo/org. */
    readonly login: string;
    readonly state: QaapGithubPullRequestStateFilter;
    /** Organizations the user belongs to (`org:` qualifiers). */
    readonly orgs?: readonly string[];
    /** Extra `owner/name` repositories (e.g. Work Hub projects) that may not be covered otherwise. */
    readonly repositories?: readonly string[];
    readonly maxChunkQueries?: number;
}

export function parseGithubPullRequestStateFilter(raw: unknown): QaapGithubPullRequestStateFilter {
    return typeof raw === 'string' && (QAAP_GITHUB_PULL_REQUEST_STATE_FILTERS as readonly string[]).includes(raw)
        ? raw as QaapGithubPullRequestStateFilter
        : 'all';
}

/** Search qualifiers for a state chip; `closed` excludes merged PRs (GitHub counts them as closed). */
export function githubPullRequestStateQualifiers(state: QaapGithubPullRequestStateFilter): string {
    switch (state) {
        case 'open': return 'is:open';
        case 'merged': return 'is:merged';
        case 'closed': return 'is:closed is:unmerged';
        default: return '';
    }
}

export function isValidGithubLogin(value: string): boolean {
    return GITHUB_LOGIN_PATTERN.test(value);
}

export function isValidGithubRepositoryKey(value: string): boolean {
    return GITHUB_REPOSITORY_PATTERN.test(value);
}

/**
 * GitHub search queries that together cover every pull request the user can reasonably care about:
 * PRs involving them (authored, assigned, mentioned, commented, review-requested), PRs in repositories
 * they own, PRs in their organizations and PRs in explicitly listed repositories. GitHub ORs repeated
 * `org:` / `repo:` qualifiers, so those are packed into as few queries as the 256-char limit allows.
 * Values that are not plain GitHub names are dropped so nothing can inject extra qualifiers.
 */
export function buildGithubPullRequestSearchQueries(input: GithubPullRequestSearchQueryInput): string[] {
    const login = input.login.trim();
    if (!isValidGithubLogin(login)) {
        return [];
    }
    const base = ['is:pr', githubPullRequestStateQualifiers(input.state)].filter(Boolean).join(' ');
    const queries = [`${base} involves:${login}`, `${base} user:${login}`];
    const maxChunkQueries = Math.max(0, input.maxChunkQueries ?? GITHUB_PULL_REQUEST_SEARCH_MAX_CHUNK_QUERIES);

    const loginLower = login.toLowerCase();
    const orgs = uniqueCaseInsensitive((input.orgs ?? []).map(org => org.trim()))
        .filter(org => isValidGithubLogin(org) && org.toLowerCase() !== loginLower);
    const coveredOwners = new Set([loginLower, ...orgs.map(org => org.toLowerCase())]);
    const repositories = uniqueCaseInsensitive((input.repositories ?? []).map(repo => repo.trim()))
        .filter(repo => isValidGithubRepositoryKey(repo) && !coveredOwners.has(repo.split('/', 1)[0].toLowerCase()));

    const chunks = [
        ...packQualifiers(base, orgs.map(org => `org:${org}`)),
        ...packQualifiers(base, repositories.map(repo => `repo:${repo}`)),
    ];
    queries.push(...chunks.slice(0, maxChunkQueries));
    return queries;
}

function packQualifiers(base: string, qualifiers: readonly string[]): string[] {
    const queries: string[] = [];
    let current = base;
    let count = 0;
    for (const qualifier of qualifiers) {
        const candidate = `${current} ${qualifier}`;
        if (candidate.length > GITHUB_SEARCH_QUERY_MAX_LENGTH && count > 0) {
            queries.push(current);
            current = `${base} ${qualifier}`;
            count = 1;
            continue;
        }
        if (candidate.length > GITHUB_SEARCH_QUERY_MAX_LENGTH) {
            // A single qualifier that cannot fit is skipped rather than producing an invalid query.
            continue;
        }
        current = candidate;
        count += 1;
    }
    if (count > 0) {
        queries.push(current);
    }
    return queries;
}

function uniqueCaseInsensitive(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const key = value.toLowerCase();
        if (value && !seen.has(key)) {
            seen.add(key);
            result.push(value);
        }
    }
    return result;
}

export function githubPullRequestSummaryKey(pullRequest: Pick<QaapGithubPullRequestSummary, 'owner' | 'repo' | 'number'>): string {
    return `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`.toLowerCase();
}

function updatedAtMs(pullRequest: QaapGithubPullRequestSummary): number {
    const value = Date.parse(pullRequest.updatedAt);
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/**
 * Deduplicates pull requests coming from several sources (search pages, per-repo polling, live
 * webhooks). The most recently updated copy wins; on a tie a full summary beats a partial one.
 * Output is sorted by `updatedAt`, newest first.
 */
export function mergeGithubPullRequestSummaries(...lists: ReadonlyArray<readonly QaapGithubPullRequestSummary[]>): QaapGithubPullRequestSummary[] {
    const merged = new Map<string, QaapGithubPullRequestSummary>();
    for (const list of lists) {
        for (const pullRequest of list) {
            const key = githubPullRequestSummaryKey(pullRequest);
            const existing = merged.get(key);
            if (!existing) {
                merged.set(key, pullRequest);
                continue;
            }
            const existingTime = updatedAtMs(existing);
            const candidateTime = updatedAtMs(pullRequest);
            if (candidateTime > existingTime || (candidateTime === existingTime && existing.partial && !pullRequest.partial)) {
                merged.set(key, pullRequest);
            }
        }
    }
    return [...merged.values()].sort((a, b) => updatedAtMs(b) - updatedAtMs(a));
}

export function matchesGithubPullRequestStateFilter(
    pullRequest: Pick<QaapGithubPullRequestSummary, 'state'>,
    filter: QaapGithubPullRequestStateFilter,
): boolean {
    switch (filter) {
        case 'open': return pullRequest.state === undefined || pullRequest.state === 'open';
        case 'merged': return pullRequest.state === 'merged';
        case 'closed': return pullRequest.state === 'closed';
        default: return true;
    }
}

/** Parses `https://api.github.com/repos/{owner}/{repo}` as returned in search results. */
export function parseGithubRepositoryApiUrl(url: string | undefined): { owner: string; repo: string } | undefined {
    const match = /\/repos\/([^/]+)\/([^/?#]+)\/?$/.exec(url ?? '');
    if (!match) {
        return undefined;
    }
    return { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]) };
}
