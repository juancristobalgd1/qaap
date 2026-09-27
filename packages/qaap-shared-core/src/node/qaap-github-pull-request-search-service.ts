// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapGithubPullRequestSearchResponse,
    QaapGithubPullRequestStateFilter,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    buildGithubPullRequestSearchQueries,
    mergeGithubPullRequestSummaries,
} from '@theia/qaap-adapters/lib/common/qaap-github-pull-request-search';
import {
    fetchGithubUserOrganizations,
    searchGithubPullRequests,
    type GithubApiError,
    type GithubPullRequestSearchPage,
} from './qaap-github-api';

export interface QaapGithubPullRequestSearchRequest {
    readonly accessToken: string;
    readonly login: string;
    readonly state: QaapGithubPullRequestStateFilter;
    /** 1-based. */
    readonly page: number;
    /** Extra `owner/name` repositories (Work Hub projects). */
    readonly repositories?: readonly string[];
    /** Skip fresh cache entries (explicit refresh). Stale entries still back a rate-limited answer. */
    readonly force?: boolean;
}

export interface QaapGithubPullRequestSearchServiceOptions {
    readonly search?: (accessToken: string, query: string, page: number, perPage: number) => Promise<GithubPullRequestSearchPage>;
    readonly organizations?: (accessToken: string) => Promise<string[]>;
    readonly now?: () => number;
    readonly perPage?: number;
    readonly ttlMs?: number;
    readonly staleTtlMs?: number;
    readonly orgsTtlMs?: number;
    readonly maxEntries?: number;
}

interface CacheEntry<T> {
    readonly value: T;
    readonly storedAt: number;
}

/** Hard cap on how many pages a client may request per query set (30 × 34 ≈ GitHub's 1000 cap). */
const MAX_SEARCH_PAGE = 34;

/**
 * Serves the Work Hub "all pull requests" navigator from the GitHub search API. Every underlying
 * query page is cached per user for a short TTL (GitHub allows 30 search requests per minute), and
 * kept a while longer so a rate-limited request can still answer with the last known results.
 * Tokens are only passed through to GitHub; they are never used as cache keys or logged.
 */
export class QaapGithubPullRequestSearchService {

    protected readonly searchPage: NonNullable<QaapGithubPullRequestSearchServiceOptions['search']>;
    protected readonly fetchOrganizations: NonNullable<QaapGithubPullRequestSearchServiceOptions['organizations']>;
    protected readonly now: () => number;
    readonly perPage: number;
    protected readonly ttlMs: number;
    protected readonly staleTtlMs: number;
    protected readonly orgsTtlMs: number;
    protected readonly maxEntries: number;

    protected readonly pages = new Map<string, CacheEntry<GithubPullRequestSearchPage>>();
    protected readonly orgs = new Map<string, CacheEntry<string[]>>();

    constructor(options: QaapGithubPullRequestSearchServiceOptions = {}) {
        this.searchPage = options.search ?? ((token, query, page, perPage) => searchGithubPullRequests(token, query, page, perPage));
        this.fetchOrganizations = options.organizations ?? (token => fetchGithubUserOrganizations(token));
        this.now = options.now ?? Date.now;
        this.perPage = options.perPage ?? 30;
        this.ttlMs = options.ttlMs ?? 60_000;
        this.staleTtlMs = options.staleTtlMs ?? 15 * 60_000;
        this.orgsTtlMs = options.orgsTtlMs ?? 10 * 60_000;
        this.maxEntries = options.maxEntries ?? 400;
    }

    async search(request: QaapGithubPullRequestSearchRequest): Promise<QaapGithubPullRequestSearchResponse> {
        const page = Math.min(MAX_SEARCH_PAGE, Math.max(1, Math.floor(request.page) || 1));
        const orgs = await this.resolveOrganizations(request);
        const queries = buildGithubPullRequestSearchQueries({
            login: request.login,
            state: request.state,
            orgs,
            repositories: request.repositories,
        });
        let rateLimited = false;
        let incompleteResults = false;
        let failures = 0;
        let hasMore = false;
        const pages: GithubPullRequestSearchPage[] = [];
        // Sequential on purpose: GitHub's secondary rate limits punish concurrent search bursts.
        for (const query of queries) {
            if (this.isExhausted(request.login, query, page)) {
                continue;
            }
            const key = this.pageKey(request.login, query, page);
            const cached = this.pages.get(key);
            let result: GithubPullRequestSearchPage | undefined;
            if (cached && !request.force && this.now() - cached.storedAt < this.ttlMs) {
                result = cached.value;
            } else if (rateLimited) {
                result = this.staleValue(cached);
            } else {
                try {
                    result = await this.searchPage(request.accessToken, query, page, this.perPage);
                    this.store(this.pages, key, result);
                } catch (err) {
                    failures++;
                    rateLimited = rateLimited || (err as Partial<GithubApiError>).rateLimited === true;
                    result = this.staleValue(cached);
                }
            }
            if (!result) {
                incompleteResults = true;
                continue;
            }
            incompleteResults = incompleteResults || result.incompleteResults;
            hasMore = hasMore || page * this.perPage < result.totalCount;
            pages.push(result);
        }
        if (queries.length > 0 && failures === queries.length && pages.length === 0 && !rateLimited) {
            throw new Error('GitHub pull request search failed');
        }
        return {
            pullRequests: mergeGithubPullRequestSummaries(...pages.map(result => result.pullRequests)),
            page,
            hasMore: hasMore && page < MAX_SEARCH_PAGE,
            signedIn: true,
            rateLimited: rateLimited || undefined,
            incompleteResults: incompleteResults || undefined,
        };
    }

    /** Drops every cached page of a user (e.g. after a merge changed a PR's state). */
    invalidateUser(login: string): void {
        const prefix = `${login.toLowerCase()}\n`;
        for (const key of [...this.pages.keys()]) {
            if (key.startsWith(prefix)) {
                this.pages.delete(key);
            }
        }
    }

    protected async resolveOrganizations(request: QaapGithubPullRequestSearchRequest): Promise<string[]> {
        const key = request.login.toLowerCase();
        const cached = this.orgs.get(key);
        if (cached && this.now() - cached.storedAt < this.orgsTtlMs) {
            return cached.value;
        }
        try {
            const orgs = await this.fetchOrganizations(request.accessToken);
            this.store(this.orgs, key, orgs);
            return orgs;
        } catch {
            // Org coverage is best effort; involvement and owned repositories still load.
            return cached?.value ?? [];
        }
    }

    /** A later page is skipped when an earlier page already proved the query has no more results. */
    protected isExhausted(login: string, query: string, page: number): boolean {
        if (page <= 1) {
            return false;
        }
        const previous = this.pages.get(this.pageKey(login, query, page - 1));
        if (!previous || this.now() - previous.storedAt >= this.staleTtlMs) {
            return false;
        }
        return (page - 1) * this.perPage >= previous.value.totalCount;
    }

    protected staleValue(entry: CacheEntry<GithubPullRequestSearchPage> | undefined): GithubPullRequestSearchPage | undefined {
        return entry && this.now() - entry.storedAt < this.staleTtlMs ? entry.value : undefined;
    }

    protected pageKey(login: string, query: string, page: number): string {
        return `${login.toLowerCase()}\n${query}\n${page}`;
    }

    protected store<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
        cache.delete(key);
        cache.set(key, { value, storedAt: this.now() });
        while (cache.size > this.maxEntries) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            cache.delete(oldest);
        }
    }
}
