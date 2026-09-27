// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import type { QuickInputButton, QuickInputService, QuickPick, QuickPickItem } from '@theia/core/lib/common/quick-pick-service';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapGithubPullRequestSearchRequest } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapGithubPullRequestSearchResponse,
    QaapGithubPullRequestSummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    filterMobileProjectsSidebarPullRequests,
    MobileProjectsPullRequestsSidebarUi,
    type MobileProjectsPullRequestsSidebarHost,
} from './mobile-projects-pull-requests-sidebar-ui';

disableImportJSDOM();

function createTestQuickPick(): {
    quickPick: QuickPick<QuickPickItem>;
    triggerButton(button: QuickInputButton): void;
    shown(): boolean;
} {
    const onDidAccept = new Emitter<{ inBackground: boolean } | undefined>();
    const onDidChangeValue = new Emitter<string>();
    const onDidTriggerButton = new Emitter<QuickInputButton>();
    const onDidTriggerItemButton = new Emitter<never>();
    const onDidChangeActive = new Emitter<QuickPickItem[]>();
    const onDidChangeSelection = new Emitter<QuickPickItem[]>();
    const onDidHide = new Emitter<{ reason: number }>();
    let visible = false;
    const quickPick = {
        value: '',
        placeholder: undefined,
        items: [] as QuickPickItem[],
        activeItems: [] as QuickPickItem[],
        selectedItems: [] as QuickPickItem[],
        canSelectMany: false,
        matchOnDescription: false,
        matchOnDetail: false,
        keepScrollPosition: false,
        buttons: [] as QuickInputButton[],
        title: undefined,
        description: undefined,
        step: undefined,
        totalSteps: undefined,
        enabled: true,
        busy: false,
        ignoreFocusOut: false,
        onDidAccept: onDidAccept.event,
        onDidChangeValue: onDidChangeValue.event,
        onDidTriggerButton: onDidTriggerButton.event,
        onDidTriggerItemButton: onDidTriggerItemButton.event,
        onDidChangeActive: onDidChangeActive.event,
        onDidChangeSelection: onDidChangeSelection.event,
        onDidHide: onDidHide.event,
        onDispose: new Emitter<void>().event,
        show: () => { visible = true; },
        hide: () => {
            visible = false;
            onDidHide.fire({ reason: 3 });
        },
        dispose: () => { visible = false; },
    } as unknown as QuickPick<QuickPickItem>;
    return {
        quickPick,
        triggerButton: button => onDidTriggerButton.fire(button),
        shown: () => visible,
    };
}

describe('mobile-projects-pull-requests-sidebar-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('keeps search controls out of the sidebar until the header button opens them', () => {
        let refreshCalls = 0;
        const searchPick = createTestQuickPick();
        const host: MobileProjectsPullRequestsSidebarHost = {
            inboxPullRequests: [],
            inboxPullRequestsLoading: false,
            inboxPullRequestsLoaded: true,
            inboxGithubSignedIn: true,
            quickInputService: {
                createQuickPick: () => searchPick.quickPick,
            } as unknown as QuickInputService,
            refreshInboxPullRequests: async (_projects?: MobileProjectEntry[], _force?: boolean) => {
                refreshCalls++;
            },
            openPullRequestDetail: () => undefined,
            searchPullRequests: async request => ({ pullRequests: [], page: request.page ?? 1, hasMore: false, signedIn: true }),
        };
        const ui = new MobileProjectsPullRequestsSidebarUi(host);
        const container = document.createElement('div');
        const anchor = document.createElement('button');
        document.body.append(container, anchor);

        ui.render(container);

        expect(container.querySelector('.theia-mobile-work-hub-pull-requests-search-row')).to.equal(null);
        expect(container.querySelector('.theia-mobile-work-hub-pull-requests-tabs')).to.not.equal(null);

        ui.toggleSearchPopup(anchor);

        expect(searchPick.shown()).to.equal(true);
        expect(searchPick.quickPick.placeholder).to.equal('Search pull requests');
        expect(searchPick.quickPick.buttons).to.have.length(2);
        searchPick.triggerButton(searchPick.quickPick.buttons[1]);
        expect(refreshCalls).to.equal(1);
        expect(anchor.getAttribute('aria-expanded')).to.equal('true');

        ui.closeSearchPopup();
        expect(searchPick.shown()).to.equal(false);
        expect(anchor.getAttribute('aria-expanded')).to.equal('false');
    });

    function pullRequest(overrides: Partial<QaapGithubPullRequestSummary> & Pick<QaapGithubPullRequestSummary, 'number'>): QaapGithubPullRequestSummary {
        return {
            owner: 'acme',
            repo: 'app',
            title: `PR ${overrides.number}`,
            branch: '',
            base: '',
            author: 'octo',
            files: 0,
            adds: 0,
            dels: 0,
            tests: 'unknown',
            state: 'open',
            htmlUrl: `https://github.com/acme/app/pull/${overrides.number}`,
            filesPreview: [],
            updatedAt: new Date(Date.UTC(2026, 0, overrides.number)).toISOString(),
            partial: true,
            ...overrides,
        };
    }

    async function flush(): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    function createSearchHost(
        respond: (request: QaapGithubPullRequestSearchRequest) => QaapGithubPullRequestSearchResponse,
    ): { host: MobileProjectsPullRequestsSidebarHost; requests: QaapGithubPullRequestSearchRequest[]; opened: QaapGithubPullRequestSummary[] } {
        const requests: QaapGithubPullRequestSearchRequest[] = [];
        const opened: QaapGithubPullRequestSummary[] = [];
        const host: MobileProjectsPullRequestsSidebarHost = {
            inboxPullRequests: [],
            inboxPullRequestsLoading: false,
            inboxPullRequestsLoaded: true,
            inboxGithubSignedIn: true,
            inboxGithubLogin: 'octo',
            refreshInboxPullRequests: async () => undefined,
            openPullRequestDetail: pr => {
                opened.push(pr);
                host.pullRequestDetail = pr;
            },
            pullRequestRepoKeys: () => ['other/lib'],
            searchPullRequests: async request => {
                requests.push(request);
                return respond(request);
            },
        };
        return { host, requests, opened };
    }

    it('filters by state chip, distinguishing merged from closed', () => {
        const list = [
            pullRequest({ number: 1, state: 'open' }),
            pullRequest({ number: 2, state: 'merged' }),
            pullRequest({ number: 3, state: 'closed' }),
        ];
        const numbers = (state: 'all' | 'open' | 'merged' | 'closed'): number[] =>
            filterMobileProjectsSidebarPullRequests(list, { state, tab: 'all' }).map(pr => pr.number);
        expect(numbers('all')).to.deep.equal([3, 2, 1]);
        expect(numbers('open')).to.deep.equal([1]);
        expect(numbers('merged')).to.deep.equal([2]);
        expect(numbers('closed')).to.deep.equal([3]);
        expect(filterMobileProjectsSidebarPullRequests(list, { state: 'all', tab: 'all', query: 'acme/app' })).to.have.length(3);
    });

    it('loads all states by default, shows repo names and pages with "Load more"', async () => {
        const { host, requests } = createSearchHost(request => request.page === 1
            ? {
                pullRequests: [pullRequest({ number: 5, state: 'merged' }), pullRequest({ number: 4, repo: 'web', state: 'closed' })],
                page: 1,
                hasMore: true,
                signedIn: true,
            }
            : { pullRequests: [pullRequest({ number: 1 })], page: 2, hasMore: false, signedIn: true });
        const ui = new MobileProjectsPullRequestsSidebarUi(host);
        const container = document.createElement('div');
        document.body.append(container);

        ui.render(container);
        await flush();

        expect(requests[0]).to.deep.include({ state: 'all', page: 1, force: false });
        expect(requests[0].repositories).to.deep.equal(['other/lib']);
        const activeChip = container.querySelector('.theia-mobile-work-hub-pull-requests-state-chip.theia-mod-active') as HTMLElement;
        expect(activeChip.dataset.state).to.equal('all');
        const repos = [...container.querySelectorAll('.theia-mobile-work-hub-pull-request-repo')].map(element => element.textContent);
        expect(repos).to.deep.equal(['acme/app', 'acme/web']);

        const loadMore = container.querySelector('.theia-mobile-work-hub-pull-requests-load-more') as HTMLButtonElement;
        expect(loadMore.textContent).to.equal('Load more');
        loadMore.click();
        await flush();

        expect(requests[1]).to.deep.include({ state: 'all', page: 2 });
        expect(container.querySelectorAll('.theia-mobile-work-hub-pull-request-item')).to.have.length(3);
        expect(container.querySelector('.theia-mobile-work-hub-pull-requests-load-more')).to.equal(null);
    });

    it('keeps a separate paged list per state chip', async () => {
        const { host, requests } = createSearchHost(request => ({
            pullRequests: request.state === 'merged' ? [pullRequest({ number: 9, state: 'merged' })] : [pullRequest({ number: 1 })],
            page: 1,
            hasMore: false,
            signedIn: true,
        }));
        const ui = new MobileProjectsPullRequestsSidebarUi(host);
        const container = document.createElement('div');
        document.body.append(container);
        ui.render(container);
        await flush();

        ui.setStateFilter('merged');
        await flush();
        expect(requests.map(request => request.state)).to.deep.equal(['all', 'merged']);
        expect(container.querySelector('.theia-mobile-work-hub-pull-request-title')?.textContent).to.equal('PR 9');

        ui.setStateFilter('all');
        await flush();
        // Cached per chip: switching back does not search again.
        expect(requests).to.have.length(2);
        expect(container.querySelector('.theia-mobile-work-hub-pull-request-title')?.textContent).to.equal('PR 1');
    });

    it('shows an error state with retry when the search fails', async () => {
        let fail = true;
        const { host } = createSearchHost(() => {
            if (fail) {
                throw new Error('boom');
            }
            return { pullRequests: [pullRequest({ number: 2 })], page: 1, hasMore: false, signedIn: true };
        });
        const ui = new MobileProjectsPullRequestsSidebarUi(host);
        const container = document.createElement('div');
        document.body.append(container);
        ui.render(container);
        await flush();

        expect(container.textContent).to.contain('Could not load pull requests');
        fail = false;
        (container.querySelector('.theia-mobile-work-hub-pull-requests-sign-in') as HTMLButtonElement).click();
        await flush();
        expect(container.querySelectorAll('.theia-mobile-work-hub-pull-request-item')).to.have.length(1);
    });

    it('hydrates a partial pull request from another repository when it is opened', async () => {
        const { host, opened } = createSearchHost(() => ({
            pullRequests: [pullRequest({ number: 7, owner: 'someone', repo: 'elsewhere' })],
            page: 1,
            hasMore: false,
            signedIn: true,
        }));
        const updated: QaapGithubPullRequestSummary[] = [];
        host.updatePullRequestDetail = pr => updated.push(pr);
        host.fetchPullRequestDetail = async (owner, repo, number) =>
            pullRequest({ number, owner, repo, branch: 'feature', base: 'main', adds: 3, dels: 1, partial: undefined });
        const ui = new MobileProjectsPullRequestsSidebarUi(host);
        const container = document.createElement('div');
        document.body.append(container);
        ui.render(container);
        await flush();

        (container.querySelector('.theia-mobile-work-hub-pull-request-item') as HTMLButtonElement).click();
        await flush();

        expect(opened[0]).to.deep.include({ owner: 'someone', repo: 'elsewhere', number: 7, partial: true });
        expect(updated).to.have.length(1);
        expect(updated[0]).to.deep.include({ owner: 'someone', repo: 'elsewhere', branch: 'feature' });
        expect(container.querySelector('.theia-mobile-work-hub-pull-request-meta')?.textContent).to.contain('feature → main');
    });
});
