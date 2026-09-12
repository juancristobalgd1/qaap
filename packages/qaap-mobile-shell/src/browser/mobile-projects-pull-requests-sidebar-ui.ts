// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { nls } from '@theia/core/lib/common/nls';

export type MobileProjectsPullRequestSidebarTab = 'all' | 'reviewing' | 'created';
export type MobileProjectsPullRequestSidebarState = 'open' | 'closed' | 'all';

export interface MobileProjectsPullRequestsSidebarHost {
    inboxPullRequests: QaapGithubPullRequestSummary[];
    inboxPullRequestsLoading: boolean;
    inboxPullRequestsLoaded: boolean;
    inboxGithubSignedIn: boolean | undefined;
    inboxGithubLogin?: string;
    pullRequestDetail?: QaapGithubPullRequestSummary;

    refreshInboxPullRequests(projects?: import('./mobile-projects-types').MobileProjectEntry[], force?: boolean): Promise<void>;
    openPullRequestDetail(pullRequest: QaapGithubPullRequestSummary): void;
}

/** Renders the ChatGPT-like pull-request navigator that lives inside the sessions sidebar. */
export class MobileProjectsPullRequestsSidebarUi {

    protected activeTab: MobileProjectsPullRequestSidebarTab = 'all';
    protected searchQuery = '';
    protected stateFilter: MobileProjectsPullRequestSidebarState = 'open';
    protected filterMenuOpen = false;

    constructor(protected readonly host: MobileProjectsPullRequestsSidebarHost) { }

    render(container: HTMLElement): void {
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
                this.render(root.parentElement ?? container);
            });
            tabs.append(button);
        }

        const searchRow = document.createElement('div');
        searchRow.className = 'theia-mobile-work-hub-pull-requests-search-row';
        const searchWrap = document.createElement('label');
        searchWrap.className = 'theia-mobile-work-hub-pull-requests-search';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'codicon codicon-search';
        searchIcon.setAttribute('aria-hidden', 'true');
        const input = document.createElement('input');
        input.type = 'search';
        input.value = this.searchQuery;
        input.placeholder = nls.localize('qaap/pullRequests/search', 'Search pull requests');
        input.setAttribute('aria-label', input.placeholder);
        input.addEventListener('input', () => {
            this.searchQuery = input.value;
            renderResults();
        });
        searchWrap.append(searchIcon, input);

        const filterButton = document.createElement('button');
        filterButton.type = 'button';
        filterButton.className = 'theia-mobile-work-hub-pull-requests-icon-button';
        filterButton.title = nls.localize('qaap/pullRequests/filter', 'Filter pull requests');
        filterButton.setAttribute('aria-label', filterButton.title);
        filterButton.setAttribute('aria-haspopup', 'menu');
        filterButton.setAttribute('aria-expanded', String(this.filterMenuOpen));
        const filterIcon = document.createElement('span');
        filterIcon.className = 'codicon codicon-filter';
        filterIcon.setAttribute('aria-hidden', 'true');
        filterButton.append(filterIcon);

        const refreshButton = document.createElement('button');
        refreshButton.type = 'button';
        refreshButton.className = 'theia-mobile-work-hub-pull-requests-icon-button';
        refreshButton.title = nls.localize('qaap/pullRequests/refresh', 'Refresh pull requests');
        refreshButton.setAttribute('aria-label', refreshButton.title);
        const refreshIcon = document.createElement('span');
        refreshIcon.className = 'codicon codicon-refresh';
        refreshIcon.setAttribute('aria-hidden', 'true');
        refreshButton.append(refreshIcon);
        refreshButton.addEventListener('click', () => {
            refreshButton.disabled = true;
            void this.host.refreshInboxPullRequests(undefined, true).finally(() => {
                refreshButton.disabled = false;
            });
        });

        const filterMenu = document.createElement('div');
        filterMenu.className = 'theia-mobile-work-hub-pull-requests-filter-menu';
        filterMenu.hidden = !this.filterMenuOpen;
        filterMenu.setAttribute('role', 'menu');
        for (const filter of [
            ['open', nls.localize('qaap/pullRequests/filterOpen', 'Open')],
            ['all', nls.localize('qaap/pullRequests/filterAll', 'All states')],
            ['closed', nls.localize('qaap/pullRequests/filterClosed', 'Closed')],
        ] as const) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'theia-mobile-work-hub-pull-requests-filter-item';
            item.textContent = filter[1];
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', String(this.stateFilter === filter[0]));
            item.classList.toggle('theia-mod-selected', this.stateFilter === filter[0]);
            item.addEventListener('click', () => {
                this.stateFilter = filter[0];
                this.filterMenuOpen = false;
                filterMenu.hidden = true;
                filterButton.setAttribute('aria-expanded', 'false');
                renderResults();
            });
            filterMenu.append(item);
        }
        filterButton.addEventListener('click', () => {
            this.filterMenuOpen = !this.filterMenuOpen;
            filterMenu.hidden = !this.filterMenuOpen;
            filterButton.setAttribute('aria-expanded', String(this.filterMenuOpen));
        });

        searchRow.append(searchWrap, filterButton, refreshButton, filterMenu);
        const results = document.createElement('div');
        results.className = 'theia-mobile-work-hub-pull-requests-results';
        results.setAttribute('aria-live', 'polite');

        const renderResults = (): void => {
            results.replaceChildren();
            if (!this.host.inboxPullRequestsLoaded && this.host.inboxPullRequestsLoading) {
                results.append(this.createStatus(
                    'codicon-loading codicon-mod-spin',
                    nls.localize('qaap/pullRequests/loading', 'Loading pull requests…'),
                    nls.localize('qaap/pullRequests/loadingBody', 'Fetching pull requests from GitHub.'),
                ));
                return;
            }
            if (this.host.inboxGithubSignedIn === false) {
                results.append(this.createSignInState());
                return;
            }
            const pullRequests = this.filteredPullRequests();
            if (pullRequests.length === 0) {
                results.append(this.createStatus(
                    'codicon-git-pull-request',
                    this.searchQuery || this.activeTab !== 'all'
                        ? nls.localize('qaap/pullRequests/noResults', 'No matching pull requests')
                        : nls.localize('qaap/pullRequests/empty', 'No pull requests yet'),
                    this.searchQuery || this.activeTab !== 'all'
                        ? nls.localize('qaap/pullRequests/noResultsBody', 'Try another title, branch, author, or filter.')
                        : nls.localize('qaap/pullRequests/emptyBody', 'Pull requests from your linked repositories will appear here.'),
                ));
                return;
            }
            const list = document.createElement('div');
            list.className = 'theia-mobile-work-hub-pull-requests-list';
            for (const pullRequest of pullRequests) {
                list.append(this.createPullRequestItem(pullRequest));
            }
            results.append(list);
        };

        root.append(tabs, searchRow, results);
        container.append(root);
        renderResults();
    }

    protected filteredPullRequests(): QaapGithubPullRequestSummary[] {
        const query = this.searchQuery.trim().toLowerCase();
        const login = this.host.inboxGithubLogin?.trim().toLowerCase();
        return [...this.host.inboxPullRequests]
            .filter(pullRequest => {
                if (this.stateFilter === 'open' && (pullRequest.state === 'closed' || pullRequest.state === 'merged')) {
                    return false;
                }
                if (this.stateFilter === 'closed' && pullRequest.state !== 'closed' && pullRequest.state !== 'merged') {
                    return false;
                }
                if (this.activeTab === 'created' && (!login || pullRequest.author.toLowerCase() !== login)) {
                    return false;
                }
                if (this.activeTab === 'reviewing' && login && pullRequest.author.toLowerCase() === login) {
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
                    `#${pullRequest.number}`,
                ].some(value => value.toLowerCase().includes(query));
            })
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }

    protected createPullRequestItem(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'theia-mobile-work-hub-pull-request-item';
        const selectedPullRequest = this.host.pullRequestDetail;
        const selected = selectedPullRequest !== undefined
            && selectedPullRequest.owner === pullRequest.owner
            && selectedPullRequest.repo === pullRequest.repo
            && selectedPullRequest.number === pullRequest.number;
        item.classList.toggle('theia-mod-selected', selected);
        if (selected) {
            item.setAttribute('aria-current', 'true');
        }
        item.addEventListener('click', () => this.host.openPullRequestDetail(pullRequest));

        const status = document.createElement('span');
        status.className = 'theia-mobile-work-hub-pull-request-status';
        status.classList.add(pullRequest.state === 'merged' ? 'theia-mod-merged' : pullRequest.draft ? 'theia-mod-draft' : 'theia-mod-open');
        const statusIcon = document.createElement('span');
        statusIcon.className = `codicon ${pullRequest.state === 'merged' ? 'codicon-git-merge' : 'codicon-git-pull-request'}`;
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
        meta.textContent = `${pullRequest.owner}/${pullRequest.repo} · ${pullRequest.branch} → ${pullRequest.base}`;

        const stats = document.createElement('span');
        stats.className = 'theia-mobile-work-hub-pull-request-stats';
        stats.textContent = nls.localize(
            'qaap/pullRequests/stats',
            '#{0} · @{1} · +{2} -{3}',
            String(pullRequest.number),
            pullRequest.author,
            String(pullRequest.adds),
            String(pullRequest.dels),
        );
        content.append(titleRow, meta, stats);
        item.append(status, content);
        item.setAttribute('aria-label', nls.localize('qaap/pullRequests/open', 'Open pull request {0}', pullRequest.title));
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
        return nls.localize('qaap/pullRequests/daysAgo', '{0}d', String(Math.floor(hours / 24)));
    }
}
