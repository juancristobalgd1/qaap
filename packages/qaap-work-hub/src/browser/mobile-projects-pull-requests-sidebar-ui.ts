// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    fetchQaapGithubPullRequestDetail,
    searchQaapGithubPullRequests,
    startGithubOAuth,
    type QaapGithubPullRequestSearchRequest,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapGithubPullRequestSearchResponse,
    QaapGithubPullRequestStateFilter,
    QaapGithubPullRequestSummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    githubPullRequestSummaryKey,
    matchesGithubPullRequestStateFilter,
    mergeGithubPullRequestSummaries,
} from '@theia/qaap-adapters/lib/common/qaap-github-pull-request-search';
import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { QuickInputButtonLocation, type QuickInputButton, type QuickPick, type QuickPickItem } from '@theia/core/lib/common/quick-pick-service';

export type MobileProjectsPullRequestSidebarTab = 'all' | 'reviewing' | 'created';
export type MobileProjectsPullRequestSidebarState = QaapGithubPullRequestStateFilter;

export interface MobileProjectsPullRequestSidebarFilter {
    readonly state: MobileProjectsPullRequestSidebarState;
    readonly tab: MobileProjectsPullRequestSidebarTab;
    /** Signed-in GitHub login (compared case-insensitively). */
    readonly login?: string;
    readonly query?: string;
}

/** State chip, tab and free-text filtering of the sidebar list; newest first. */
export function filterMobileProjectsSidebarPullRequests(
    pullRequests: readonly QaapGithubPullRequestSummary[],
    filter: MobileProjectsPullRequestSidebarFilter,
): QaapGithubPullRequestSummary[] {
    const query = filter.query?.trim().toLowerCase() ?? '';
    const login = filter.login?.trim().toLowerCase();
    return pullRequests
        .filter(pullRequest => {
            if (!matchesGithubPullRequestStateFilter(pullRequest, filter.state)) {
                return false;
            }
            if (filter.tab === 'created' && (!login || pullRequest.author.toLowerCase() !== login)) {
                return false;
            }
            if (filter.tab === 'reviewing' && login && pullRequest.author.toLowerCase() === login) {
                return false;
            }
            if (!query) {
                return true;
            }
            return [
                pullRequest.title,
                pullRequest.author,
                pullRequest.branch,
                pullRequest.base,
                pullRequest.repo,
                pullRequest.owner,
                `${pullRequest.owner}/${pullRequest.repo}`,
                `#${pullRequest.number}`,
            ].some(value => value.toLowerCase().includes(query));
        })
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

interface PullRequestSearchPickItem extends QuickPickItem {
    readonly pullRequest: QaapGithubPullRequestSummary;
}

interface PullRequestFilterPickItem extends QuickPickItem {
    readonly state: MobileProjectsPullRequestSidebarState;
}

/** Paged search results of one state chip. */
interface PullRequestSearchListState {
    items: QaapGithubPullRequestSummary[];
    /** Last page loaded; 0 while the first page is still loading. */
    page: number;
    hasMore: boolean;
    loading: boolean;
    loaded: boolean;
    error?: string;
    rateLimited?: boolean;
}

export interface MobileProjectsPullRequestsSidebarHost {
    inboxPullRequests: QaapGithubPullRequestSummary[];
    inboxPullRequestsLoading: boolean;
    inboxPullRequestsLoaded: boolean;
    inboxGithubSignedIn: boolean | undefined;
    inboxGithubLogin?: string;
    pullRequestDetail?: QaapGithubPullRequestSummary;
    quickInputService?: import('@theia/core/lib/common/quick-pick-service').QuickInputService;

    refreshInboxPullRequests(projects?: import('@theia/qaap-shared-core/lib/browser/mobile-projects-types').MobileProjectEntry[], force?: boolean): Promise<void>;
    openPullRequestDetail(pullRequest: QaapGithubPullRequestSummary): void;
    /** Replaces the open detail with a hydrated copy when it is still the same pull request. */
    updatePullRequestDetail?(pullRequest: QaapGithubPullRequestSummary): void;
    /** Work Hub project repositories (`owner/name`) to include in the all-PRs search. */
    pullRequestRepoKeys?(): string[];
    /** Test seams; default to the GitHub client. */
    searchPullRequests?(request: QaapGithubPullRequestSearchRequest): Promise<QaapGithubPullRequestSearchResponse>;
    fetchPullRequestDetail?(owner: string, repo: string, number: number): Promise<QaapGithubPullRequestSummary | undefined>;
}

const STATE_CHIPS: ReadonlyArray<readonly [MobileProjectsPullRequestSidebarState, string, string]> = [
    ['all', 'qaap/pullRequests/stateAll', 'All'],
    ['open', 'qaap/pullRequests/stateOpen', 'Open'],
    ['merged', 'qaap/pullRequests/stateMerged', 'Merged'],
    ['closed', 'qaap/pullRequests/stateClosed', 'Closed'],
];

/**
 * Renders the ChatGPT-like pull-request navigator that lives inside the sessions sidebar. It lists
 * every pull request of the user's repositories (open, merged and closed) from the paged GitHub
 * search endpoint, merged with the live inbox pull requests polled for Work Hub projects.
 */
export class MobileProjectsPullRequestsSidebarUi {

    protected activeTab: MobileProjectsPullRequestSidebarTab = 'all';
    protected searchQuery = '';
    protected stateFilter: MobileProjectsPullRequestSidebarState = 'all';
    protected readonly searchLists = new Map<MobileProjectsPullRequestSidebarState, PullRequestSearchListState>();
    protected searchQuickPick: QuickPick<PullRequestSearchPickItem> | undefined;
    protected searchQuickPickCleanup: Disposable = Disposable.NULL;
    protected filterQuickPick: QuickPick<PullRequestFilterPickItem> | undefined;
    protected filterQuickPickCleanup: Disposable = Disposable.NULL;
    protected searchQuickPickAnchor: HTMLElement | undefined;
    protected container: HTMLElement | undefined;
    protected results: HTMLElement | undefined;

    constructor(protected readonly host: MobileProjectsPullRequestsSidebarHost) { }

    render(container: HTMLElement): void {
        this.container = container;
        container.replaceChildren();
        const root = document.createElement('div');
        root.className = 'theia-mobile-work-hub-pull-requests';

        const tabs = document.createElement('div');
        tabs.className = 'theia-mobile-work-hub-pull-requests-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', nls.localize('qaap/pullRequests/tabs', 'Pull request views'));
        for (const tab of [
            ['all', nls.localize('qaap/pullRequests/all', 'All')],
            ['reviewing', nls.localize('qaap/pullRequests/reviewing', 'Reviewing')],
            ['created', nls.localize('qaap/pullRequests/created', 'Created by you')],
        ] as const) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-mobile-work-hub-pull-requests-tab';
            button.textContent = tab[1];
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(this.activeTab === tab[0]));
            button.classList.toggle('theia-mod-active', this.activeTab === tab[0]);
            button.addEventListener('click', () => {
                this.activeTab = tab[0];
                this.rerender();
            });
            tabs.append(button);
        }

        const chips = document.createElement('div');
        chips.className = 'theia-mobile-work-hub-pull-requests-state-chips';
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-label', nls.localize('qaap/pullRequests/stateFilter', 'Pull request state'));
        for (const [state, key, label] of STATE_CHIPS) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'theia-mobile-work-hub-pull-requests-state-chip';
            chip.dataset.state = state;
            chip.textContent = nls.localize(key, label);
            chip.setAttribute('aria-pressed', String(this.stateFilter === state));
            chip.classList.toggle('theia-mod-active', this.stateFilter === state);
            chip.addEventListener('click', () => this.setStateFilter(state));
            chips.append(chip);
        }

        const results = document.createElement('div');
        results.className = 'theia-mobile-work-hub-pull-requests-results';
        results.setAttribute('aria-live', 'polite');

        root.append(tabs, chips, results);
        container.append(root);
        this.results = results;
        this.ensureSearchLoaded();
        this.renderPullRequestResults(results);
    }

    get currentStateFilter(): MobileProjectsPullRequestSidebarState {
        return this.stateFilter;
    }

    setStateFilter(state: MobileProjectsPullRequestSidebarState): void {
        if (this.stateFilter === state) {
            return;
        }
        this.stateFilter = state;
        this.rerender();
        if (this.searchQuickPick) {
            this.searchQuickPick.items = this.buildSearchPickItems();
        }
    }

    /** Re-runs the first search page of the active chip; `force` bypasses the backend cache. */
    reloadSearch(force = true): Promise<void> {
        return this.loadSearchPage(this.stateFilter, 1, force);
    }

    loadMore(): Promise<void> {
        const list = this.searchLists.get(this.stateFilter);
        if (!list || list.loading || !list.hasMore) {
            return Promise.resolve();
        }
        return this.loadSearchPage(this.stateFilter, list.page + 1, false);
    }

    toggleSearchPopup(anchor: HTMLElement): void {
        if (this.searchQuickPick) {
            this.closeSearchPopup();
            return;
        }

        const quickInputService = this.host.quickInputService;
        if (!quickInputService) {
            return;
        }

        const quickPick = quickInputService.createQuickPick<PullRequestSearchPickItem>();
        const filterButton: QuickInputButton = {
            iconClass: 'codicon-filter',
            location: QuickInputButtonLocation.Inline,
            alwaysVisible: true,
            tooltip: nls.localize('qaap/pullRequests/filter', 'Filter pull requests'),
        };
        const refreshButton: QuickInputButton = {
            iconClass: 'codicon-refresh',
            location: QuickInputButtonLocation.Inline,
            alwaysVisible: true,
            tooltip: nls.localize('qaap/pullRequests/refresh', 'Refresh pull requests'),
        };

        this.searchQuickPick = quickPick;
        this.searchQuickPickAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        quickPick.placeholder = nls.localize('qaap/pullRequests/search', 'Search pull requests');
        quickPick.value = this.searchQuery;
        quickPick.items = this.buildSearchPickItems();
        quickPick.buttons = [filterButton, refreshButton];
        quickPick.canSelectMany = false;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.ignoreFocusOut = true;

        this.searchQuickPickCleanup = new DisposableCollection(
            quickPick.onDidChangeValue(value => {
                this.searchQuery = value;
                this.renderPullRequestResults();
            }),
            quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
                if (selected) {
                    this.openPullRequest(selected.pullRequest);
                }
                this.closeSearchPopup();
            }),
            quickPick.onDidTriggerButton(button => {
                if (button === filterButton) {
                    this.openFilterQuickPick();
                } else if (button === refreshButton) {
                    this.refreshSearchQuickPick(quickPick);
                }
            }),
            quickPick.onDidHide(() => {
                if (!this.filterQuickPick) {
                    this.resetSearchQuickPick(quickPick);
                }
            }),
        );
        quickPick.show();
    }

    closeSearchPopup(): void {
        const quickPick = this.searchQuickPick;
        this.searchQuickPick = undefined;
        this.searchQuickPickAnchor?.setAttribute('aria-expanded', 'false');
        this.searchQuickPickAnchor = undefined;
        this.searchQuickPickCleanup.dispose();
        this.searchQuickPickCleanup = Disposable.NULL;
        this.closeFilterQuickPick();
        quickPick?.hide();
        quickPick?.dispose();
    }

    protected rerender(): void {
        if (this.container) {
            this.render(this.container);
        }
    }

    protected ensureSearchLoaded(): void {
        if (this.host.inboxGithubSignedIn === false) {
            return;
        }
        const list = this.searchLists.get(this.stateFilter);
        if (!list || (!list.loaded && !list.loading && !list.error)) {
            void this.loadSearchPage(this.stateFilter, 1, false);
        }
    }

    protected async loadSearchPage(state: MobileProjectsPullRequestSidebarState, page: number, force: boolean): Promise<void> {
        const previous = this.searchLists.get(state);
        // A fresh object per request: a response is applied only while its list is still current,
        // so a refresh or a newer page request makes older in-flight responses harmless.
        const list: PullRequestSearchListState = {
            items: previous?.items ?? [],
            page: previous?.page ?? 0,
            hasMore: previous?.hasMore ?? false,
            loaded: previous?.loaded ?? false,
            rateLimited: previous?.rateLimited,
            loading: true,
        };
        this.searchLists.set(state, list);
        if (state === this.stateFilter) {
            this.renderPullRequestResults();
        }
        const search = this.host.searchPullRequests?.bind(this.host) ?? searchQaapGithubPullRequests;
        try {
            const response = await search({
                state,
                page,
                repositories: this.host.pullRequestRepoKeys?.() ?? [],
                force,
            });
            if (this.searchLists.get(state) !== list) {
                return;
            }
            if (!response.signedIn) {
                this.host.inboxGithubSignedIn = false;
                list.items = [];
                list.hasMore = false;
            } else {
                list.items = page === 1
                    ? mergeGithubPullRequestSummaries(response.pullRequests)
                    : mergeGithubPullRequestSummaries(list.items, response.pullRequests);
                list.page = response.page;
                list.hasMore = response.hasMore;
                list.rateLimited = response.rateLimited;
            }
            list.error = undefined;
            list.loaded = true;
        } catch (err) {
            if (this.searchLists.get(state) !== list) {
                return;
            }
            list.error = err instanceof Error ? err.message : String(err);
        } finally {
            if (this.searchLists.get(state) === list) {
                list.loading = false;
                if (state === this.stateFilter) {
                    this.renderPullRequestResults();
                    if (this.searchQuickPick) {
                        this.searchQuickPick.items = this.buildSearchPickItems();
                    }
                }
            }
        }
    }

    protected openPullRequest(pullRequest: QaapGithubPullRequestSummary): void {
        this.host.openPullRequestDetail(pullRequest);
        if (pullRequest.partial) {
            void this.hydratePullRequest(pullRequest);
        }
    }

    /**
     * A PR merged from the detail view: flip it to `merged` in every cached chip list, drop it from
     * `open`, and forget the `merged` list so its next visit fetches the fresh server results.
     */
    markPullRequestMerged(pullRequest: QaapGithubPullRequestSummary): void {
        const key = githubPullRequestSummaryKey(pullRequest);
        for (const [state, list] of this.searchLists) {
            if (state === 'merged') {
                continue;
            }
            list.items = state === 'open'
                ? list.items.filter(item => githubPullRequestSummaryKey(item) !== key)
                : list.items.map(item => githubPullRequestSummaryKey(item) === key ? { ...item, state: 'merged' } : item);
        }
        if (!this.searchLists.get('merged')?.loading) {
            this.searchLists.delete('merged');
        }
        if (this.stateFilter === 'merged') {
            this.ensureSearchLoaded();
        }
        this.renderPullRequestResults();
    }

    /** Search results lack branches, stats, mergeability and files; fetch them once the PR is opened. */
    protected async hydratePullRequest(pullRequest: QaapGithubPullRequestSummary): Promise<void> {
        const fetchDetail = this.host.fetchPullRequestDetail?.bind(this.host) ?? fetchQaapGithubPullRequestDetail;
        const full = await fetchDetail(pullRequest.owner, pullRequest.repo, pullRequest.number).catch(() => undefined);
        if (!full) {
            return;
        }
        const key = githubPullRequestSummaryKey(full);
        for (const list of this.searchLists.values()) {
            list.items = list.items.map(item => githubPullRequestSummaryKey(item) === key ? full : item);
        }
        const current = this.host.pullRequestDetail;
        if (current && githubPullRequestSummaryKey(current) === key) {
            this.host.updatePullRequestDetail?.(full);
        }
        this.renderPullRequestResults();
    }

    protected resetSearchQuickPick(quickPick: QuickPick<PullRequestSearchPickItem>): void {
        if (this.searchQuickPick !== quickPick) {
            return;
        }
        this.searchQuickPick = undefined;
        this.searchQuickPickAnchor?.setAttribute('aria-expanded', 'false');
        this.searchQuickPickAnchor = undefined;
        this.searchQuickPickCleanup.dispose();
        this.searchQuickPickCleanup = Disposable.NULL;
        quickPick.dispose();
    }

    protected openFilterQuickPick(): void {
        const quickInputService = this.host.quickInputService;
        const searchQuickPick = this.searchQuickPick;
        if (!quickInputService || !searchQuickPick || this.filterQuickPick) {
            return;
        }

        const filterQuickPick = quickInputService.createQuickPick<PullRequestFilterPickItem>();
        this.filterQuickPick = filterQuickPick;
        filterQuickPick.placeholder = nls.localize('qaap/pullRequests/filterPlaceholder', 'Filter pull requests');
        const filterItems: PullRequestFilterPickItem[] = STATE_CHIPS.map(([state, key, label]) => ({
            label: nls.localize(key, label),
            state,
        }));
        filterQuickPick.items = filterItems;
        const active = filterItems.find(item => item.state === this.stateFilter);
        if (active) {
            filterQuickPick.activeItems = [active];
        }
        filterQuickPick.canSelectMany = false;
        filterQuickPick.ignoreFocusOut = true;
        this.filterQuickPickCleanup = new DisposableCollection(
            filterQuickPick.onDidAccept(() => {
                const selected = filterQuickPick.selectedItems[0] ?? filterQuickPick.activeItems[0];
                if (selected) {
                    this.setStateFilter(selected.state);
                    searchQuickPick.items = this.buildSearchPickItems();
                }
                filterQuickPick.hide();
            }),
            filterQuickPick.onDidHide(() => {
                if (this.filterQuickPick !== filterQuickPick) {
                    return;
                }
                this.filterQuickPick = undefined;
                this.filterQuickPickCleanup.dispose();
                this.filterQuickPickCleanup = Disposable.NULL;
                filterQuickPick.dispose();
                if (this.searchQuickPick) {
                    this.searchQuickPick.show();
                    this.searchQuickPickAnchor?.setAttribute('aria-expanded', 'true');
                }
            }),
        );
        filterQuickPick.show();
    }

    protected closeFilterQuickPick(): void {
        const filterQuickPick = this.filterQuickPick;
        this.filterQuickPick = undefined;
        this.filterQuickPickCleanup.dispose();
        this.filterQuickPickCleanup = Disposable.NULL;
        filterQuickPick?.hide();
        filterQuickPick?.dispose();
    }

    protected refreshSearchQuickPick(quickPick: QuickPick<PullRequestSearchPickItem>): void {
        quickPick.busy = true;
        void Promise.all([this.host.refreshInboxPullRequests(undefined, true), this.reloadSearch(true)])
            .finally(() => {
                if (this.searchQuickPick === quickPick) {
                    quickPick.items = this.buildSearchPickItems();
                    quickPick.busy = false;
                }
            });
    }

    protected buildSearchPickItems(): PullRequestSearchPickItem[] {
        return this.filteredPullRequests(false).map(pullRequest => ({
            label: pullRequest.title,
            description: `${pullRequest.owner}/${pullRequest.repo} · #${pullRequest.number}`,
            detail: [
                this.stateLabel(pullRequest),
                pullRequest.branch ? `${pullRequest.branch} → ${pullRequest.base}` : undefined,
                `@${pullRequest.author}`,
                pullRequest.partial ? undefined : `+${pullRequest.adds} -${pullRequest.dels}`,
            ].filter(Boolean).join(' · '),
            iconClasses: ['codicon', this.statusIconClass(pullRequest)],
            pullRequest,
        }));
    }

    protected renderPullRequestResults(results = this.results): void {
        if (!results) {
            return;
        }
        const previousScrollTop = results.scrollTop;
        results.replaceChildren();
        const list = this.searchLists.get(this.stateFilter);
        const pullRequests = this.filteredPullRequests();
        const searchLoading = list?.loading === true && !list.loaded;
        const inboxLoading = !this.host.inboxPullRequestsLoaded && this.host.inboxPullRequestsLoading;
        if (this.host.inboxGithubSignedIn === false) {
            results.append(this.createSignInState());
            return;
        }
        if (pullRequests.length === 0 && (searchLoading || (inboxLoading && !list?.loaded))) {
            results.append(this.createStatus(
                'codicon-loading codicon-mod-spin',
                nls.localize('qaap/pullRequests/loading', 'Loading pull requests…'),
                nls.localize('qaap/pullRequests/loadingBody', 'Fetching pull requests from GitHub.'),
            ));
            return;
        }
        if (pullRequests.length === 0) {
            if (list?.error) {
                results.append(this.createErrorState(list.error));
                return;
            }
            const filtered = this.searchQuery !== '' || this.activeTab !== 'all' || this.stateFilter !== 'all';
            results.append(this.createStatus(
                'codicon-git-pull-request',
                filtered
                    ? nls.localize('qaap/pullRequests/noResults', 'No matching pull requests')
                    : nls.localize('qaap/pullRequests/empty', 'No pull requests yet'),
                filtered
                    ? nls.localize('qaap/pullRequests/noResultsBody', 'Try another title, branch, author, or filter.')
                    : nls.localize('qaap/pullRequests/emptyAllBody', 'Pull requests from your GitHub repositories will appear here.'),
            ));
            const footer = this.createListFooter(list);
            if (footer) {
                results.append(footer);
            }
            return;
        }
        const listElement = document.createElement('div');
        listElement.className = 'theia-mobile-work-hub-pull-requests-list';
        for (const pullRequest of pullRequests) {
            listElement.append(this.createPullRequestItem(pullRequest));
        }
        results.append(listElement);
        const footer = this.createListFooter(list);
        if (footer) {
            results.append(footer);
        }
        results.scrollTop = previousScrollTop;
    }

    protected createListFooter(list: PullRequestSearchListState | undefined): HTMLElement | undefined {
        if (!list) {
            return undefined;
        }
        const footer = document.createElement('div');
        footer.className = 'theia-mobile-work-hub-pull-requests-footer';
        if (list.rateLimited) {
            footer.append(this.createFooterNote(nls.localize('qaap/pullRequests/rateLimited', 'GitHub rate limit reached; showing cached results.')));
        }
        if (list.error) {
            const note = this.createFooterNote(list.error);
            note.classList.add('theia-mod-error');
            footer.append(note);
        }
        if (list.loading) {
            const loading = this.createFooterNote(nls.localize('qaap/pullRequests/loadingMore', 'Loading…'));
            const icon = document.createElement('span');
            icon.className = 'codicon codicon-loading codicon-mod-spin';
            icon.setAttribute('aria-hidden', 'true');
            loading.prepend(icon);
            footer.append(loading);
        } else if (list.hasMore || list.error) {
            const retry = list.error !== undefined && !list.hasMore;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-mobile-work-hub-pull-requests-load-more';
            button.textContent = retry
                ? nls.localize('qaap/pullRequests/retry', 'Retry')
                : nls.localize('qaap/pullRequests/loadMore', 'Load more');
            button.addEventListener('click', () => {
                void (retry ? this.reloadSearch(false) : this.loadMore());
            });
            footer.append(button);
        }
        return footer.childElementCount > 0 ? footer : undefined;
    }

    protected createFooterNote(text: string): HTMLElement {
        const note = document.createElement('span');
        note.className = 'theia-mobile-work-hub-pull-requests-footer-note';
        note.textContent = text;
        return note;
    }

    protected createErrorState(message: string): HTMLElement {
        const state = this.createStatus(
            'codicon-warning',
            nls.localize('qaap/pullRequests/errorTitle', 'Could not load pull requests'),
            message,
        );
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-pull-requests-sign-in';
        button.textContent = nls.localize('qaap/pullRequests/retry', 'Retry');
        button.addEventListener('click', () => void this.reloadSearch(false));
        state.append(button);
        return state;
    }

    /** Search results of the active chip merged with the live inbox pull requests of Work Hub projects. */
    protected filteredPullRequests(includeSearchQuery = true): QaapGithubPullRequestSummary[] {
        const searched = this.searchLists.get(this.stateFilter)?.items ?? [];
        return filterMobileProjectsSidebarPullRequests(
            mergeGithubPullRequestSummaries(searched, this.host.inboxPullRequests),
            {
                state: this.stateFilter,
                tab: this.activeTab,
                login: this.host.inboxGithubLogin,
                query: includeSearchQuery ? this.searchQuery : '',
            },
        );
    }

    protected statusModifier(pullRequest: QaapGithubPullRequestSummary): string {
        if (pullRequest.state === 'merged') {
            return 'theia-mod-merged';
        }
        if (pullRequest.state === 'closed') {
            return 'theia-mod-closed';
        }
        return pullRequest.draft ? 'theia-mod-draft' : 'theia-mod-open';
    }

    protected statusIconClass(pullRequest: QaapGithubPullRequestSummary): string {
        if (pullRequest.state === 'merged') {
            return 'codicon-git-merge';
        }
        if (pullRequest.state === 'closed') {
            return 'codicon-git-pull-request-closed';
        }
        return pullRequest.draft ? 'codicon-git-pull-request-draft' : 'codicon-git-pull-request';
    }

    protected stateLabel(pullRequest: QaapGithubPullRequestSummary): string {
        if (pullRequest.state === 'merged') {
            return nls.localize('qaap/pullRequests/badgeMerged', 'Merged');
        }
        if (pullRequest.state === 'closed') {
            return nls.localize('qaap/pullRequests/badgeClosed', 'Closed');
        }
        return pullRequest.draft
            ? nls.localize('qaap/pullRequests/badgeDraft', 'Draft')
            : nls.localize('qaap/pullRequests/badgeOpen', 'Open');
    }

    protected createPullRequestItem(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'theia-mobile-work-hub-pull-request-item';
        const selectedPullRequest = this.host.pullRequestDetail;
        const selected = selectedPullRequest !== undefined
            && githubPullRequestSummaryKey(selectedPullRequest) === githubPullRequestSummaryKey(pullRequest);
        item.classList.toggle('theia-mod-selected', selected);
        if (selected) {
            item.setAttribute('aria-current', 'true');
        }
        item.addEventListener('click', () => this.openPullRequest(pullRequest));

        const status = document.createElement('span');
        status.className = 'theia-mobile-work-hub-pull-request-status';
        status.classList.add(this.statusModifier(pullRequest));
        const statusIcon = document.createElement('span');
        statusIcon.className = `codicon ${this.statusIconClass(pullRequest)}`;
        statusIcon.setAttribute('aria-hidden', 'true');
        status.append(statusIcon);

        const content = document.createElement('span');
        content.className = 'theia-mobile-work-hub-pull-request-content';
        const titleRow = document.createElement('span');
        titleRow.className = 'theia-mobile-work-hub-pull-request-title-row';
        const title = document.createElement('span');
        title.className = 'theia-mobile-work-hub-pull-request-title';
        title.textContent = pullRequest.title;
        const since = document.createElement('span');
        since.className = 'theia-mobile-work-hub-pull-request-since';
        since.textContent = this.formatRelativeTime(pullRequest.updatedAt);
        titleRow.append(title, since);

        const meta = document.createElement('span');
        meta.className = 'theia-mobile-work-hub-pull-request-meta';
        const repoName = document.createElement('span');
        repoName.className = 'theia-mobile-work-hub-pull-request-repo';
        repoName.textContent = `${pullRequest.owner}/${pullRequest.repo}`;
        meta.append(repoName);
        if (pullRequest.branch) {
            meta.append(document.createTextNode(` · ${pullRequest.branch} → ${pullRequest.base}`));
        }

        const statsRow = document.createElement('span');
        statsRow.className = 'theia-mobile-work-hub-pull-request-stats-row';
        const badge = document.createElement('span');
        badge.className = `theia-mobile-work-hub-pull-request-badge ${this.statusModifier(pullRequest)}`;
        badge.textContent = this.stateLabel(pullRequest);
        const stats = document.createElement('span');
        stats.className = 'theia-mobile-work-hub-pull-request-stats';
        stats.textContent = pullRequest.partial
            ? nls.localize('qaap/pullRequests/statsShort', '#{0} · @{1}', String(pullRequest.number), pullRequest.author)
            : nls.localize(
                'qaap/pullRequests/stats',
                '#{0} · @{1} · +{2} -{3}',
                String(pullRequest.number),
                pullRequest.author,
                String(pullRequest.adds),
                String(pullRequest.dels),
            );
        statsRow.append(badge, stats);
        content.append(titleRow, meta, statsRow);
        item.append(status, content);
        item.setAttribute('aria-label', nls.localize(
            'qaap/pullRequests/openWithState',
            'Open pull request {0} ({1}, {2}/{3})',
            pullRequest.title,
            this.stateLabel(pullRequest),
            pullRequest.owner,
            pullRequest.repo,
        ));
        return item;
    }

    protected createStatus(iconClass: string, titleText: string, bodyText: string): HTMLElement {
        const status = document.createElement('div');
        status.className = 'theia-mobile-work-hub-pull-requests-status-state';
        const icon = document.createElement('span');
        icon.className = `codicon ${iconClass}`;
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.textContent = titleText;
        const body = document.createElement('span');
        body.textContent = bodyText;
        status.append(icon, title, body);
        return status;
    }

    protected createSignInState(): HTMLElement {
        const state = this.createStatus(
            'codicon-github',
            nls.localize('qaap/pullRequests/signInTitle', 'Connect GitHub'),
            nls.localize('qaap/pullRequests/signInBody', 'Sign in with GitHub to see your pull requests.'),
        );
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-pull-requests-sign-in';
        button.textContent = nls.localize('qaap/pullRequests/signIn', 'Sign in with GitHub');
        button.addEventListener('click', () => startGithubOAuth());
        state.append(button);
        return state;
    }

    protected formatRelativeTime(updatedAt: string): string {
        const timestamp = Date.parse(updatedAt);
        if (!Number.isFinite(timestamp)) {
            return '';
        }
        const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
        if (minutes < 1) {
            return nls.localize('qaap/pullRequests/justNow', 'now');
        }
        if (minutes < 60) {
            return nls.localize('qaap/pullRequests/minutesAgo', '{0}m', String(minutes));
        }
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return nls.localize('qaap/pullRequests/hoursAgo', '{0}h', String(hours));
        }
        const days = Math.floor(hours / 24);
        if (days < 365) {
            return nls.localize('qaap/pullRequests/daysAgo', '{0}d', String(days));
        }
        return nls.localize('qaap/pullRequests/yearsAgo', '{0}y', String(Math.floor(days / 365)));
    }
}
