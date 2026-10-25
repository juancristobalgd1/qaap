// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import {
    MobileWorkHubSessionsSidebar,
    type MobileWorkHubSettingsSidebarOptions,
    QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY,
    QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS,
    QAAP_SESSIONS_SIDEBAR_DISMISS_HINT_KEY,
    hasSeenSessionsSidebarDismissHint,
    markSessionsSidebarDismissHintSeen,
    isDesktopSessionsSidebarLayout,
    shouldKeepSessionsSidebarOpenAfterNavigation,
} from './mobile-work-hub-sessions-sidebar';
import { ensureWorkHubSessionsSidebarExtracted } from './mobile-projects-sessions-sidebar-ui-render';
import { MobileProjectsPullRequestsSidebarUi } from './mobile-projects-pull-requests-sidebar-ui';
import type { MobileProjectsSessionsSidebarUiContext } from './mobile-projects-sessions-sidebar-ui-context';

disableImportJSDOM();

describe('mobile-work-hub-sessions-sidebar', () => {
    let disableJSDOM: (() => void) | undefined;
    let jsdomWindow: Window | undefined;
    const storage = new Map<string, string>();

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        storage.clear();
        jsdomWindow = window;
        (global as { window?: Window }).window = {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
                key: () => null,
                length: 0,
            },
            requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0) as unknown as number,
            cancelAnimationFrame: (id: number) => {
                clearTimeout(id);
            },
        } as unknown as Window;
        document.body.innerHTML = '';
        FrontendApplicationConfigProvider.set({ applicationName: 'Qaap' });
    });

    afterEach(() => {
        (global as { window?: Window }).window = jsdomWindow;
        jsdomWindow = undefined;
    });

    it('shows dismiss hint only until marked seen', () => {
        expect(hasSeenSessionsSidebarDismissHint()).to.equal(false);
        markSessionsSidebarDismissHintSeen();
        expect(storage.get(QAAP_SESSIONS_SIDEBAR_DISMISS_HINT_KEY)).to.equal('1');
        expect(hasSeenSessionsSidebarDismissHint()).to.equal(true);
    });

    it('keeps a wide coarse-pointer viewport in the mobile sheet layout', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            matchMedia: (query: string) => ({
                matches: query === '(min-width: 768px)' ? true : false,
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            }),
        } as unknown as Window;

        expect(QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY).to.equal('(min-width: 768px) and (pointer: fine)');
        expect(isDesktopSessionsSidebarLayout()).to.equal(false);
    });

    it('uses the persistent sidebar only for a wide precise-pointer viewport', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            matchMedia: (query: string) => ({
                matches: query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY,
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            }),
        } as unknown as Window;

        expect(isDesktopSessionsSidebarLayout()).to.equal(true);
    });

    it('keeps the appearance mode switch out of the sidebar footer', () => {
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        expect(sidebar.node.querySelector('.theia-qaap-appearance-mode-switch')).to.equal(null);
        expect(sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-foot .theia-workbench-account-btn')).to.not.equal(null);
    });

    describe('backend update chip', () => {
        const originalFetch = (global as { fetch?: unknown }).fetch;

        afterEach(() => {
            (global as { fetch?: unknown }).fetch = originalFetch;
        });

        async function renderWithRuntimeStatus(update: object): Promise<Element | null> {
            (global as { fetch?: unknown }).fetch = async (input: string) => ({
                ok: true,
                json: async () => (String(input).includes('runtime/status') ? { runtime: {}, update } : { build: 'abc1234' }),
            });
            const sidebar = new MobileWorkHubSessionsSidebar({
                renderSessionList: () => undefined,
                onNewChat: () => undefined,
                onClose: () => undefined,
            });
            document.body.append(sidebar.node);
            await (sidebar as unknown as { loadBackendUpdateStatus(): Promise<void> }).loadBackendUpdateStatus();
            return sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-update');
        }

        it('shows a non-blocking chip with the reason and the builds while a newer build waits', async () => {
            const chip = await renderWithRuntimeStatus({
                backendBuild: 'old5678',
                controlPlaneBuild: 'abc1234',
                updatePending: true,
                reason: 'agent-turns-running',
            });
            expect(chip).to.not.equal(null);
            expect(chip?.textContent).to.equal('Update ready');
            expect(chip?.getAttribute('role')).to.equal('status');
            expect(chip?.getAttribute('title')).to.contain('Update ready — applies when your running tasks finish');
            expect(chip?.getAttribute('title')).to.contain('Running build old5678; new build abc1234');
        });

        it('shows no chip when the backend already runs the deployed build', async () => {
            const chip = await renderWithRuntimeStatus({ backendBuild: 'abc1234', controlPlaneBuild: 'abc1234', updatePending: false });
            expect(chip).to.equal(null);
        });
    });

    it('keeps the deployed build out of the footer and exposes it in the account tooltip', () => {
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        (sidebar as unknown as { deployedBuildSha: string | undefined }).deployedBuildSha = 'b72a749af00e';
        sidebar.updateAccountAvatar();
        expect(sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-build')).to.equal(null);
        expect(sidebar.node.textContent).to.not.contain('b72a749af00e');
        const label = sidebar.node.querySelector<HTMLElement>('.theia-mobile-work-hub-sessions-sidebar-account-label');
        expect(label?.title).to.contain('b72a749af00e');
    });

    it('restores the normal sidebar controls when Settings is hidden', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        const options: MobileWorkHubSettingsSidebarOptions = {
            sections: [{ id: 'general', label: 'General', icon: 'settings-gear' }],
            activeSectionId: () => 'general',
            onBack: () => undefined,
            onClose: () => undefined,
            onSectionSelected: () => undefined,
            onSearch: () => undefined,
        };
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);

        sidebar.showSettings(options);
        expect((sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-settings') as HTMLElement).hidden).to.equal(false);

        sidebar.showSessions();

        const settingsHost = sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-settings') as HTMLElement;
        expect(settingsHost.hidden).to.equal(true);
        expect((sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-nav') as HTMLElement).hidden).to.equal(false);
        sidebar.hide();
    });

    it('moves the Settings selection when the owner selects another section', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        let active = 'general';
        const options: MobileWorkHubSettingsSidebarOptions = {
            sections: [
                { id: 'general', label: 'General', icon: 'settings-gear' },
                { id: 'harness', label: 'Harness', icon: 'tools' },
            ],
            activeSectionId: () => active,
            onBack: () => undefined,
            onClose: () => undefined,
            onSectionSelected: sectionId => {
                active = sectionId;
                sidebar.refreshSettingsNavigation();
            },
            onSearch: () => undefined,
        };
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.showSettings(options);

        const item = (id: string): HTMLElement => sidebar.node.querySelector(`[data-qaap-settings-section="${id}"]`) as HTMLElement;
        const harness = item('harness');
        harness.click();

        expect(item('harness')).to.equal(harness, 'items are updated in place');
        expect(harness.classList.contains('theia-mod-selected')).to.equal(true);
        expect(harness.getAttribute('aria-current')).to.equal('page');
        expect(item('general').classList.contains('theia-mod-selected')).to.equal(false);
        expect(item('general').getAttribute('aria-current')).to.equal('false');
        sidebar.hide();
    });

    it('places the Settings close control at the trailing edge', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        const options: MobileWorkHubSettingsSidebarOptions = {
            sections: [],
            activeSectionId: () => 'general',
            onBack: () => undefined,
            onClose: () => undefined,
            onSectionSelected: () => undefined,
            onSearch: () => undefined,
        };
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);

        sidebar.showSettings(options);

        const closeButton = sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-close') as HTMLElement;
        expect(closeButton.parentElement?.classList.contains('theia-mobile-work-hub-sessions-sidebar-head')).to.equal(true);
        expect(sidebar.node.classList.contains('theia-mod-settings')).to.equal(true);
        sidebar.hide();
    });

    it('keeps Pull requests active while the sidebar is collapsed', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            renderPullRequestList: host => { host.textContent = 'Pull requests'; },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);

        sidebar.showPullRequests();
        sidebar.show();
        sidebar.hide();

        expect(sidebar.isPullRequestsModeActive()).to.equal(true);
        expect(sidebar.isPullRequestsVisible()).to.equal(false);

        sidebar.show();
        expect(sidebar.isPullRequestsModeActive()).to.equal(true);
        expect(sidebar.isPullRequestsVisible()).to.equal(true);
        expect(sidebar.node.classList.contains('theia-mod-pull-requests')).to.equal(true);
        sidebar.hide();
    });

    it('does not rebuild the pull request list under a touch scroll, only once it settles', async () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        let renders = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            renderPullRequestList: host => {
                renders++;
                const results = document.createElement('div');
                results.className = 'theia-mobile-work-hub-pull-requests-results';
                host.replaceChildren(results);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        try {
            sidebar.showPullRequests();
            sidebar.show();
            const rendersBeforeGesture = renders;
            const touched = sidebar.node.querySelector('.theia-mobile-work-hub-pull-requests-results')!;
            // `window` is stubbed in these tests: take the Event constructor from the jsdom document.
            const DomEvent = touched.ownerDocument.defaultView!.Event;

            touched.dispatchEvent(new DomEvent('touchstart'));
            // Inbox polling and search pages always force the refresh.
            sidebar.refreshList({ force: true });
            expect(renders, 'rebuilt under the finger').to.equal(rendersBeforeGesture);

            touched.dispatchEvent(new DomEvent('touchend'));
            touched.dispatchEvent(new DomEvent('scroll'));
            sidebar.refreshList({ force: true });
            expect(renders, 'rebuilt during momentum').to.equal(rendersBeforeGesture);

            await new Promise(resolve => setTimeout(resolve, 900));
            expect(renders, 'deferred refresh never ran').to.equal(rendersBeforeGesture + 1);
        } finally {
            sidebar.hide();
            sidebar.node.remove();
        }
    });

    it('syncs the embedded state when the viewport layout changes while open', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);

        sidebar.show();
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(true);

        sidebar.syncEmbeddedState(true);
        expect(sidebar.node.classList.contains('theia-mod-embedded')).to.equal(true);
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(false);

        sidebar.syncEmbeddedState(false);
        expect(sidebar.node.classList.contains('theia-mod-embedded')).to.equal(false);
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(true);

        sidebar.hide();
    });

    it('removes orphan sidebar nodes when reconciling the current panel mount', () => {
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        const orphan = document.createElement('aside');
        orphan.className = 'theia-mobile-work-hub-sessions-sidebar';
        document.body.append(orphan, sidebar.node);

        ensureWorkHubSessionsSidebarExtracted({
            host: {
                sessionsSidebar: sidebar,
                sessionsSidebarContainer: () => undefined,
            },
        } as unknown as MobileProjectsSessionsSidebarUiContext);

        expect(document.querySelectorAll('.theia-mobile-work-hub-sessions-sidebar')).to.have.length(1);
        expect(document.body.contains(sidebar.node)).to.equal(true);
    });

    it('scheduleRefreshList coalesces multiple refresh requests into one render pass', async () => {
        let renderCalls = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                host.append(document.createElement('div'));
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);

        sidebar.scheduleRefreshList();
        sidebar.scheduleRefreshList();
        sidebar.scheduleRefreshList();
        await new Promise<void>(resolve => setTimeout(resolve, 20));

        expect(renderCalls).to.equal(1);
    });

    it('skips DOM rebuild when delegate reports unchanged sidebar fingerprint', () => {
        let renderCalls = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                host.append(document.createElement('div'));
            },
            shouldSkipSessionListRefresh: () => renderCalls > 0,
            rememberSessionListFingerprint: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        sidebar.refreshList();
        expect(renderCalls).to.equal(1);
    });

    it('force refresh bypasses sidebar fingerprint short-circuit', () => {
        let renderCalls = 0;
        let skipEnabled = false;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                host.append(document.createElement('div'));
            },
            shouldSkipSessionListRefresh: () => skipEnabled,
            rememberSessionListFingerprint: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        skipEnabled = true;
        sidebar.refreshList();
        sidebar.refreshList({ force: true });
        expect(renderCalls).to.equal(2);
    });

    it('preserves scroll and focused conversation across list refresh', () => {
        let label = 'First';
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                const spacer = document.createElement('div');
                spacer.style.height = '400px';
                const row = document.createElement('div');
                row.dataset.qaapConversationId = 'conv-1';
                const button = document.createElement('button');
                button.textContent = label;
                row.append(button);
                host.append(spacer, row);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        sidebar.getScrollElement().scrollTop = 120;
        sidebar.node.querySelector<HTMLButtonElement>('[data-qaap-conversation-id="conv-1"] button')?.focus();

        label = 'Updated';
        sidebar.refreshList({ force: true });

        expect(sidebar.getScrollElement().scrollTop).to.equal(120);
        expect(document.activeElement?.textContent).to.equal('Updated');
    });

    it('does not re-focus a conversation the pointer selected when the list refreshes', () => {
        // A script focus after the swap matches :focus-visible, which runs the hover marquee on
        // the selected row (title clipped and shifted left, no ellipsis, fade block at the end).
        let label = 'First';
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                const row = document.createElement('div');
                row.dataset.qaapConversationId = 'conv-1';
                const button = document.createElement('button');
                button.textContent = label;
                row.append(button);
                host.append(row);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        const clicked = sidebar.node.querySelector<HTMLButtonElement>('[data-qaap-conversation-id="conv-1"] button')!;
        const matches = clicked.matches.bind(clicked);
        clicked.matches = (selector: string) => selector === ':focus-visible' ? false : matches(selector);
        clicked.focus();

        label = 'Updated';
        sidebar.refreshList({ force: true });

        expect(sidebar.node.querySelector('[data-qaap-conversation-id="conv-1"] button')?.textContent).to.equal('Updated');
        expect(document.activeElement).to.equal(document.body);
    });

    it('keeps the live list when only the title marquee measurement differs', () => {
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                const row = document.createElement('div');
                row.dataset.qaapConversationId = 'conv-1';
                const title = document.createElement('span');
                title.className = 'theia-mobile-projects-task-title';
                title.textContent = 'Count the number of files in the repo root';
                row.append(title);
                host.append(row);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        const liveRow = sidebar.node.querySelector('[data-qaap-conversation-id="conv-1"]');
        const liveTitle = liveRow!.querySelector<HTMLElement>('.theia-mobile-projects-task-title')!;
        // What the marquee measurement leaves on the live (laid out) title only.
        liveTitle.classList.add('theia-mod-title-overflow');
        liveTitle.style.setProperty('--qaap-task-title-overflow', '42px');

        sidebar.refreshList();

        expect(sidebar.node.querySelector('[data-qaap-conversation-id="conv-1"]')).to.equal(liveRow);
    });

    it('keeps the live list when only stamped fingerprints, the heading tooltip or icon ids differ', () => {
        let render = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                render++;
                const label = document.createElement('span');
                label.className = 'theia-mobile-tasks-inbox-section-label';
                label.textContent = 'Projects';
                const row = document.createElement('div');
                row.dataset.qaapConversationId = 'conv-1';
                // Agent icons get a fresh gradient id suffix on every render (uniquifySvgIds).
                row.innerHTML = `<svg><linearGradient id="qaiq__ear-gradient-${render}"></linearGradient><path fill="url(#qaiq__ear-gradient-${render})"></path></svg>`;
                host.append(label, row);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        const liveRow = sidebar.node.querySelector<HTMLElement>('[data-qaap-conversation-id="conv-1"]')!;
        // Written on the live list only, after it is painted.
        liveRow.setAttribute('data-qaap-sessions-sidebar-row-fp', 'fp-1');
        liveRow.setAttribute('data-qaap-inbox-row-fp', 'fp-2');
        sidebar.node.querySelector<HTMLElement>('.theia-mobile-tasks-inbox-section-label')!.title = 'Projects';

        sidebar.refreshList();

        expect(render).to.equal(2);
        expect(sidebar.node.querySelector('[data-qaap-conversation-id="conv-1"]')).to.equal(liveRow);
    });

    it('replaces the list when only a conversation id suffix differs (not an icon id)', () => {
        let render = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                render++;
                const row = document.createElement('div');
                // Ids ending in `-<digits>` look like the per-render icon suffix, but are real data.
                row.dataset.qaapConversationId = `conv-${render}`;
                host.append(row);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();

        sidebar.refreshList();

        expect(sidebar.node.querySelector('[data-qaap-conversation-id="conv-2"]')).to.not.equal(null);
    });

    it('does not touch DOM when refreshed markup is unchanged', () => {
        let renderCalls = 0;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                const row = document.createElement('div');
                row.dataset.qaapConversationId = 'conv-1';
                row.textContent = 'Stable';
                host.append(row);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        const firstRow = sidebar.node.querySelector('[data-qaap-conversation-id="conv-1"]');
        sidebar.refreshList();
        const secondRow = sidebar.node.querySelector('[data-qaap-conversation-id="conv-1"]');

        expect(renderCalls).to.equal(2);
        expect(secondRow).to.equal(firstRow);
    });

    it('renders pull requests into the live list host so async results stay visible', () => {
        const hosts: HTMLElement[] = [];
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            renderPullRequestList: host => {
                hosts.push(host);
                host.replaceChildren();
                const results = document.createElement('div');
                results.className = 'results';
                results.textContent = 'Loading…';
                host.append(results);
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.showPullRequests();
        sidebar.refreshList();
        sidebar.refreshList();

        const lastHost = hosts[hosts.length - 1];
        expect(lastHost.isConnected).to.equal(true);
        // A late GitHub answer paints into the node the UI rendered into last.
        lastHost.querySelector('.results')!.textContent = 'No pull requests';
        expect(sidebar.node.textContent).to.contain('No pull requests');
        sidebar.hide();
    });

    it('keeps an embedded pull-request sidebar open when a view tab or state chip is pressed', () => {
        const currentWindow = (global as { window?: Window }).window;
        (global as { window?: Window }).window = {
            ...currentWindow,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        const pullRequestsUi = new MobileProjectsPullRequestsSidebarUi({
            inboxPullRequests: [],
            inboxPullRequestsLoading: false,
            inboxPullRequestsLoaded: true,
            inboxGithubSignedIn: true,
            refreshInboxPullRequests: async () => undefined,
            openPullRequestDetail: () => undefined,
            searchPullRequests: async request => ({ pullRequests: [], page: request.page ?? 1, hasMore: false, signedIn: true }),
        });
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            renderPullRequestList: host => pullRequestsUi.render(host),
            onNewChat: () => undefined,
            onClose: () => undefined,
            isEmbedded: () => true,
        });
        document.body.append(sidebar.node);
        sidebar.showPullRequests();
        sidebar.show();
        expect(sidebar.isPullRequestsVisible()).to.equal(true);

        // Pressing a control re-renders the list, detaching the pressed node before the document click handler runs.
        sidebar.node.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-pull-requests-tab[data-view="reviewing"]')!.click();
        expect(pullRequestsUi.currentStateFilter).to.equal('all');
        expect(sidebar.isPullRequestsVisible()).to.equal(true);
        expect(sidebar.node.querySelector('.theia-mobile-work-hub-pull-requests-tab[data-view="reviewing"]')!.getAttribute('aria-selected')).to.equal('true');

        sidebar.node.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-pull-requests-state-chip[data-state="open"]')!.click();
        expect(pullRequestsUi.currentStateFilter).to.equal('open');
        expect(sidebar.isPullRequestsVisible()).to.equal(true);
        expect(sidebar.node.querySelector('.theia-mobile-work-hub-pull-requests-state-chip[data-state="open"]')!.getAttribute('aria-pressed')).to.equal('true');
        sidebar.hide();
    });

    it('runs tryPatch before shouldSkip so live progress can update without full rebuild', () => {
        let renderCalls = 0;
        let patchCalls = 0;
        let allowPatch = false;
        let skipAfterInitialRender = false;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                skipAfterInitialRender = true;
                host.append(document.createElement('div'));
            },
            shouldSkipSessionListRefresh: () => skipAfterInitialRender,
            tryPatchSessionList: () => {
                patchCalls++;
                return allowPatch;
            },
            rememberSessionListFingerprint: () => {
                allowPatch = true;
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        sidebar.refreshList();
        expect(renderCalls).to.equal(1);
        expect(patchCalls).to.equal(2);
    });

    it('patches rows in place when tryPatch succeeds', () => {
        let renderCalls = 0;
        let patchCalls = 0;
        let allowPatch = false;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => {
                renderCalls++;
                const row = document.createElement('div');
                row.className = 'theia-mobile-projects-task-row';
                row.dataset.qaapConversationId = 'conv-1';
                row.textContent = 'Initial';
                host.append(row);
            },
            tryPatchSessionList: () => {
                patchCalls++;
                return allowPatch;
            },
            rememberSessionListFingerprint: () => {
                allowPatch = true;
            },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.refreshList();
        sidebar.refreshList();
        expect(renderCalls).to.equal(1);
        expect(patchCalls).to.equal(2);
    });

    it('keeps the sidebar open when navigation happens on desktop layout', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            matches: query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY
                || query === '(max-width: 767px)' && false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;

        expect(shouldKeepSessionsSidebarOpenAfterNavigation()).to.equal(true);

        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.show();
        expect(sidebar.isVisible()).to.equal(true);

        sidebar.hideForMobileOverlay();

        expect(sidebar.isVisible()).to.equal(true);
        expect(sidebar.node.classList.contains('theia-mod-visible')).to.equal(true);
        sidebar.hide();
    });

    it('keeps the sidebar open on wide coarse-pointer viewports after task navigation', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            // Wide enough, but not the fine-pointer desktop sidebar layout.
            matches: query === '(max-width: 767px)' ? false : false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;

        expect(isDesktopSessionsSidebarLayout()).to.equal(false);
        expect(shouldKeepSessionsSidebarOpenAfterNavigation()).to.equal(true);

        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.show();
        sidebar.hideForMobileOverlay();
        expect(sidebar.isVisible()).to.equal(true);
        sidebar.hide();
    });

    it('closes the sessions sheet after navigation on a narrow viewport', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            matches: query === '(max-width: 767px)',
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;

        expect(shouldKeepSessionsSidebarOpenAfterNavigation()).to.equal(false);

        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.show();
        sidebar.hideForMobileOverlay();
        expect(sidebar.isVisible()).to.equal(false);
        sidebar.hide();
    });

    it('closes the embedded chat sidebar after navigation in the classic IDE', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            matches: query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY
                || (query === '(max-width: 767px)' ? false : false),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;
        document.body.classList.add('theia-mobile-mod-desktop-ide');

        expect(shouldKeepSessionsSidebarOpenAfterNavigation()).to.equal(false);

        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        sidebar.show();

        sidebar.hideForMobileOverlay();

        expect(sidebar.isVisible()).to.equal(false);
        expect(sidebar.node.classList.contains('theia-mod-visible')).to.equal(false);
        sidebar.hide();
        document.body.classList.remove('theia-mobile-mod-desktop-ide');
    });

    it('hide always clears the sessions-sidebar body class even when embedded mode flips', () => {
        const matchMedia = (query: string): MediaQueryList => ({
            matches: query.includes('min-width: 768px'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        });
        (global as { window?: Window }).window = {
            ...(global as { window?: Window }).window,
            matchMedia,
            setTimeout: (callback: (...args: unknown[]) => void, delayMs?: number) =>
                setTimeout(callback, delayMs ?? 0) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id),
        } as unknown as Window;

        let embedded = false;
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => { host.append(document.createElement('div')); },
            onNewChat: () => undefined,
            onClose: () => undefined,
            isEmbedded: () => embedded,
        });
        document.body.append(sidebar.node);
        sidebar.show();
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(true);
        embedded = true;
        sidebar.hide();
        expect(document.body.classList.contains(QAAP_MOBILE_SESSIONS_SIDEBAR_BODY_CLASS)).to.equal(false);
    });

    it('keeps the IDE/Agents switch out of the sidebar header', () => {
        const sidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: () => undefined,
            onNewChat: () => undefined,
            onClose: () => undefined,
        });
        document.body.append(sidebar.node);
        const head = sidebar.node.querySelector('.theia-mobile-work-hub-sessions-sidebar-head');
        expect(head).to.not.equal(null);
        expect(head!.querySelector('.theia-mobile-work-hub-sessions-sidebar-view-switch')).to.equal(null);
        expect(head!.querySelector('.theia-qaap-segmented-bar')).to.equal(null);
        expect(head!.querySelector('.theia-mobile-work-hub-sessions-sidebar-brand')).to.not.equal(null);
        expect(head!.querySelector('.theia-mobile-work-hub-sessions-sidebar-close')).to.not.equal(null);
    });
});
