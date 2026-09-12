// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { QuickInputButtonLocation, type QuickInputButton, type QuickPick, type QuickPickItem } from '@theia/core/lib/common/quick-pick-service';

export type MobileProjectsPullRequestSidebarTab = 'all' | 'reviewing' | 'created';
export type MobileProjectsPullRequestSidebarState = 'open' | 'closed' | 'all';

interface PullRequestSearchPickItem extends QuickPickItem {
    readonly pullRequest: QaapGithubPullRequestSummary;
}

interface PullRequestFilterPickItem extends QuickPickItem {
    readonly state: MobileProjectsPullRequestSidebarState;
}

export interface MobileProjectsPullRequestsSidebarHost {
    inboxPullRequests: QaapGithubPullRequestSummary[];
    inboxPullRequestsLoading: boolean;
    inboxPullRequestsLoaded: boolean;
    inboxGithubSignedIn: boolean | undefined;
    inboxGithubLogin?: string;
    pullRequestDetail?: QaapGithubPullRequestSummary;
    quickInputService?: import('@theia/core/lib/common/quick-pick-service').QuickInputService;

    refreshInboxPullRequests(projects?: import('./mobile-projects-types').MobileProjectEntry[], force?: boolean): Promise<void>;
    openPullRequestDetail(pullRequest: QaapGithubPullRequestSummary): void;
}

/** Renders the ChatGPT-like pull-request navigator that lives inside the sessions sidebar. */
export class MobileProjectsPullRequestsSidebarUi {

    protected activeTab: MobileProjectsPullRequestSidebarTab = 'all';
    protected searchQuery = '';
    protected stateFilter: MobileProjectsPullRequestSidebarState = 'open';
    protected searchQuickPick: QuickPick<PullRequestSearchPickItem> | undefined;
    protected searchQuickPickCleanup: Disposable = Disposable.NULL;
    protected filterQuickPick: QuickPick<PullRequestFilterPickItem> | undefined;
    protected filterQuickPickCleanup: Disposable = Disposable.NULL;
    protected searchQuickPickAnchor: HTMLElement | undefined;
    protected results: HTMLElement | undefined;

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

        const results = document.createElement('div');
        results.className = 'theia-mobile-work-hub-pull-requests-results';
        results.setAttribute('aria-live', 'polite');

        root.append(tabs, results);
        container.append(root);
        this.results = results;
        this.renderPullRequestResults(results);
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
                    this.host.openPullRequestDetail(selected.pullRequest);
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
        const filterItems: PullRequestFilterPickItem[] = [
            { label: nls.localize('qaap/pullRequests/filterOpen', 'Open'), state: 'open' },
            { label: nls.localize('qaap/pullRequests/filterAll', 'All states'), state: 'all' },
            { label: nls.localize('qaap/pullRequests/filterClosed', 'Closed'), state: 'closed' },
        ];
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
                    this.stateFilter = selected.state;
                    this.renderPullRequestResults();
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
        void this.host.refreshInboxPullRequests(undefined, true)
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
            detail: `${pullRequest.branch} → ${pullRequest.base} · @${pullRequest.author} · +${pullRequest.adds} -${pullRequest.dels}`,
            iconClasses: [
                'codicon',
                pullRequest.state === 'merged'
                    ? 'codicon-git-merge'
                    : 'codicon-git-pull-request',
            ],
            pullRequest,
        }));
    }

    protected renderPullRequestResults(results = this.results): void {
        if (!results) {
            return;
        }
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
    }

    protected filteredPullRequests(includeSearchQuery = true): QaapGithubPullRequestSummary[] {
        const query = includeSearchQuery ? this.searchQuery.trim().toLowerCase() : '';
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
