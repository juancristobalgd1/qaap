// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectsCardMenuHost } from './mobile-projects-card-menu-ui';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MobileProjectsCardMenuUi } = require('./mobile-projects-card-menu-ui') as typeof import('./mobile-projects-card-menu-ui');

disableImportJSDOM();

const project = (overrides: Partial<MobileProjectEntry> = {}): MobileProjectEntry => ({
    id: 'proj-1',
    name: 'proj-1',
    color: '#000',
    branch: 'main',
    status: 'idle',
    task: '',
    progress: 0,
    agents: [],
    lastActive: '—',
    tokens: '—',
    cost: '—',
    pinned: false,
    isCurrent: false,
    ...overrides,
});

describe('MobileProjectsCardMenuUi.buildProjectOptionsMenu', () => {

    useSuiteJSDOM();

    it('lists Pin first (New agent is now a standalone row button)', () => {
        const target = project({ id: 'alpha' });
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = (query: string): MediaQueryList => ({
            matches: query === '(max-width: 767px), (pointer: coarse)',
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        } as MediaQueryList);
        const host = {
            projectsService: { canRemove: () => true },
            conversationIndexUi: {
                conversationsForProject: () => [],
                countFailedTasks: () => 0,
            },
            onTogglePin: async () => undefined,
            onRemoveProject: async () => undefined,
            onClearProjectChats: async () => undefined,
            onClearFailedTasks: async () => undefined,
            closeCurrentWorkspace: async () => undefined,
        } as unknown as MobileProjectsCardMenuHost;

        const ui = new MobileProjectsCardMenuUi(host);
        try {
            const menu = ui.buildProjectOptionsMenu(target);
            const items = [...menu.querySelectorAll('.theia-mobile-projects-card-menu-item')];
            expect(items.map(item => item.textContent?.trim())).to.deep.equal([
                'Open project',
                'Pin',
                'Remove',
                'Clear all tasks',
            ]);
            expect(items[0]?.querySelector('.codicon-add')).to.equal(null);

            window.matchMedia = (query: string): MediaQueryList => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            } as MediaQueryList);
            const desktopMenu = ui.buildProjectOptionsMenu(target);
            expect([...desktopMenu.querySelectorAll('.theia-mobile-projects-card-menu-item')]
                .map(item => item.textContent?.trim())).to.include('Open in IDE');
        } finally {
            window.matchMedia = originalMatchMedia;
        }
    });
});

describe('MobileProjectsCardMenuUi project Open project item', () => {

    useSuiteJSDOM();

    it('opens the project from the menu and hides the sessions overlay', async () => {
        const target = project({ id: 'alpha' });
        const selected: string[] = [];
        let hidOverlay = false;
        const host = {
            projectsService: { canRemove: () => true },
            conversationIndexUi: {
                conversationsForProject: () => [],
                countFailedTasks: () => 0,
            },
            sessionsSidebar: { hideForMobileOverlay: () => { hidOverlay = true; } },
            selectSessionsSidebarProject: async (entry: MobileProjectEntry) => { selected.push(entry.id); },
            onTogglePin: async () => undefined,
            onRemoveProject: async () => undefined,
            onClearProjectChats: async () => undefined,
            onClearFailedTasks: async () => undefined,
            closeCurrentWorkspace: async () => undefined,
        } as unknown as MobileProjectsCardMenuHost;

        const ui = new MobileProjectsCardMenuUi(host);
        const menu = ui.buildProjectOptionsMenu(target);
        const openItem = [...menu.querySelectorAll<HTMLElement>('.theia-mobile-projects-card-menu-item')]
            .find(item => item.textContent?.trim() === 'Open project');
        expect(openItem).to.not.equal(undefined);
        openItem!.click();
        await new Promise<void>(resolve => { setTimeout(resolve, 0); });

        expect(selected).to.deep.equal(['alpha']);
        expect(hidOverlay).to.equal(true);
    });
});

describe('MobileProjectsCardMenuUi.buildConversationMenu', () => {

    useSuiteJSDOM();

    it('offers Retry for self-reported stop failures even when status is idle', () => {
        const target = project({ id: 'alpha' });
        let retried = false;
        const host = {
            chatService: undefined,
            conversations: undefined,
            conversationIndexUi: {
                resolveConversationFlags: () => ({ priority: false, paused: false }),
                findSummaryById: () => undefined,
            },
            conversationFlags: undefined,
            ensureOverlayUi: () => ({ parallel: { openVariantChooseSheet: () => undefined } }),
            onRetryConversation: async () => { retried = true; },
            onForkConversation: async () => undefined,
            onRenameConversation: async () => undefined,
            onSetConversationPriority: async () => undefined,
            onSetConversationPaused: async () => undefined,
            onCancelConversation: async () => undefined,
            onArchiveConversation: async () => undefined,
            onDeleteConversation: async () => undefined,
            openConversationSummary: async () => undefined,
        } as unknown as MobileProjectsCardMenuHost;

        const ui = new MobileProjectsCardMenuUi(host);
        const menu = ui.buildConversationMenu(target, {
            id: 'c1',
            title: 'Find and fix a bug',
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
            agentId: 'qaiq',
            cwd: '/repo',
            source: 'vps',
            lastMessageRole: 'agent',
            lastMessagePreview: 'Stopped: tool failed',
        } as never);
        const retry = [...menu.querySelectorAll('.theia-mobile-projects-card-menu-item')]
            .find(item => item.textContent?.includes('Retry'));
        expect(retry).to.not.equal(undefined);
        (retry as HTMLElement).click();
        expect(retried).to.equal(true);
    });

    it('offers Continue task next to Retry for an interrupted turn, and only Retry for a plain failure', () => {
        const target = project({ id: 'alpha' });
        let continued = 0;
        const host = {
            chatService: undefined,
            conversations: undefined,
            conversationIndexUi: {
                resolveConversationFlags: () => ({ priority: false, paused: false }),
                findSummaryById: () => undefined,
            },
            conversationFlags: undefined,
            ensureOverlayUi: () => ({ parallel: { openVariantChooseSheet: () => undefined } }),
            onRetryConversation: async () => undefined,
            onContinueConversation: async () => { continued++; },
        } as unknown as MobileProjectsCardMenuHost;
        const ui = new MobileProjectsCardMenuUi(host);
        const failed = (lastMessageError: string): never => ({
            id: 'c1',
            title: 'Task',
            status: 'failed',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
            agentId: 'qaiq',
            cwd: '/repo',
            source: 'vps',
            lastMessageRole: 'agent',
            lastMessageError,
        } as never);
        const labels = (menu: HTMLElement): string[] => [...menu.querySelectorAll('.theia-mobile-projects-card-menu-item')]
            .map(item => item.textContent ?? '');

        const interrupted = ui.buildConversationMenu(target, failed('Stopped automatically after 46 min: the turn exceeded the maximum allowed time.'));
        expect(labels(interrupted).some(label => label.includes('Continue task'))).to.equal(true);
        expect(labels(interrupted).some(label => label.includes('Retry task'))).to.equal(true);
        const item = [...interrupted.querySelectorAll('.theia-mobile-projects-card-menu-item')]
            .find(candidate => candidate.textContent?.includes('Continue task')) as HTMLElement;
        item.click();
        expect(continued).to.equal(1);

        const plain = ui.buildConversationMenu(target, failed('Bash exited with code 1.'));
        expect(labels(plain).some(label => label.includes('Continue task'))).to.equal(false);
        expect(labels(plain).some(label => label.includes('Retry task'))).to.equal(true);
    });

    it('re-reads the summary on Continue / Retry and skips a run that is already recovering', () => {
        const target = project({ id: 'alpha' });
        const failed = {
            id: 'c1', title: 'Task', status: 'failed', createdAt: 1, updatedAt: 2, messageCount: 2, agentId: 'qaiq',
            cwd: '/repo', source: 'vps', lastMessageRole: 'agent',
            lastMessageError: 'Stopped automatically after 46 min: the turn exceeded the maximum allowed time.',
        };
        let latest: object = failed;
        const calls: string[] = [];
        const host = {
            chatService: undefined,
            conversations: undefined,
            conversationIndexUi: {
                resolveConversationFlags: () => ({ priority: false, paused: false }),
                findSummaryById: () => latest,
            },
            conversationFlags: undefined,
            ensureOverlayUi: () => ({ parallel: { openVariantChooseSheet: () => undefined } }),
            onRetryConversation: async () => { calls.push('retry'); },
            onContinueConversation: async () => { calls.push('continue'); },
        } as unknown as MobileProjectsCardMenuHost;
        const menu = new MobileProjectsCardMenuUi(host).buildConversationMenu(target, failed as never);
        const item = (label: string): HTMLElement => [...menu.querySelectorAll('.theia-mobile-projects-card-menu-item')]
            .find(candidate => candidate.textContent?.includes(label)) as HTMLElement;

        // A first recovery flipped the summary to streaming while the menu stayed open.
        latest = { ...failed, status: 'streaming' };
        item('Continue task').click();
        item('Retry task').click();
        expect(calls).to.deep.equal([]);

        latest = failed;
        item('Retry task').click();
        expect(calls).to.deep.equal(['retry']);
    });

    it('uses pin icons for the high-priority (pin) action', () => {
        const target = project({ id: 'alpha' });
        const host = {
            chatService: undefined,
            conversations: undefined,
            conversationIndexUi: {
                resolveConversationFlags: () => ({ priority: false, paused: false }),
            },
            conversationFlags: { /* present so flag actions stay enabled */ },
            ensureOverlayUi: () => ({ parallel: { openVariantChooseSheet: () => undefined } }),
            onRetryConversation: async () => undefined,
            onForkConversation: async () => undefined,
            onRenameConversation: async () => undefined,
            onSetConversationPriority: async () => undefined,
            onSetConversationPaused: async () => undefined,
            onCancelConversation: async () => undefined,
            onArchiveConversation: async () => undefined,
            onDeleteConversation: async () => undefined,
            openConversationSummary: async () => undefined,
        } as unknown as MobileProjectsCardMenuHost;

        const ui = new MobileProjectsCardMenuUi(host);
        const menu = ui.buildConversationMenu(target, {
            id: 'c1',
            title: 'Find and fix a bug',
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
            agentId: 'qaiq',
            cwd: '/repo',
            source: 'vps',
            lastMessageRole: 'agent',
            lastMessagePreview: 'Hello',
        } as never);
        const priority = [...menu.querySelectorAll('.theia-mobile-projects-card-menu-item')]
            .find(item => item.textContent?.trim() === 'Pin');
        expect(priority).to.not.equal(undefined);
        expect(priority?.querySelector('.codicon-pin')).to.not.equal(null);
        expect(priority?.querySelector('.codicon-star-empty')).to.equal(null);
        const removedRunVariants = [...menu.querySelectorAll('.theia-mobile-projects-card-menu-item')]
            .find(item => item.textContent?.includes('Run variants'));
        expect(removedRunVariants).to.equal(undefined);
    });
});

describe('MobileProjectsCardMenuUi task pull request items', () => {

    useSuiteJSDOM();

    function menuFor(summary: Record<string, unknown>, calls: string[]): HTMLElement {
        const host = {
            chatService: undefined,
            conversations: undefined,
            conversationIndexUi: { resolveConversationFlags: () => ({ priority: false, paused: false }) },
            conversationFlags: {},
            ensureOverlayUi: () => ({ parallel: { openVariantChooseSheet: () => undefined } }),
            onSetConversationTaskPullRequest: async (_summary: unknown, enabled: boolean) => { calls.push(`enabled:${enabled}`); },
            onRespondTaskPullRequestConsent: async (_summary: unknown, allow: boolean) => { calls.push(`allow:${allow}`); },
        } as unknown as MobileProjectsCardMenuHost;
        return new MobileProjectsCardMenuUi(host).buildConversationMenu(project({ id: 'alpha' }), {
            id: 'c1', title: 'T', status: 'idle', createdAt: 1, updatedAt: 2, messageCount: 2, agentId: 'qaiq', cwd: '/repo', source: 'vps',
            ...summary,
        } as never);
    }

    function click(menu: HTMLElement, label: string): void {
        const item = [...menu.querySelectorAll('.theia-mobile-projects-card-menu-item')].find(entry => entry.textContent?.trim() === label);
        expect(item, label).to.not.equal(undefined);
        (item as HTMLElement).click();
    }

    it('toggles "Create PR when done", on by default', () => {
        const calls: string[] = [];
        const menu = menuFor({}, calls);
        expect(menu.querySelector('.codicon-check')).to.not.equal(null);
        click(menu, 'Create PR when done');
        click(menuFor({ taskPullRequestEnabled: false }, calls), 'Create PR when done');
        expect(calls).to.deep.equal(['enabled:false', 'enabled:true']);
    });

    it('offers Allow / Not now while the task PR waits for consent', () => {
        const calls: string[] = [];
        const pr = { owner: 'acme', repo: 'demo', branch: 'qaap/task/c1', state: 'awaiting-consent', updatedAt: 1 };
        click(menuFor({ taskPullRequest: pr }, calls), 'Allow PRs on acme/demo');
        click(menuFor({ taskPullRequest: pr }, calls), 'Not now');
        expect(calls).to.deep.equal(['allow:true', 'allow:false']);
        const open = menuFor({ taskPullRequest: { ...pr, state: 'open' } }, calls);
        expect([...open.querySelectorAll('.theia-mobile-projects-card-menu-item')].map(item => item.textContent?.trim())).not.to.include('Not now');
    });
});

describe('MobileProjectsCardMenuUi.toggleCardMenu', () => {

    useSuiteJSDOM();

    it('closes when the same anchor is clicked with a new menu instance', () => {
        window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        }) as typeof window.requestAnimationFrame;
        const root = document.createElement('div');
        document.body.appendChild(root);
        const host = {
            root,
            scroll: root,
            sessionsSidebar: undefined,
        } as unknown as MobileProjectsCardMenuHost;
        const ui = new MobileProjectsCardMenuUi(host);
        const card = document.createElement('div');
        const btn = document.createElement('button');
        root.append(card, btn);
        const menu1 = document.createElement('div');
        ui.toggleCardMenu(card, menu1, btn);
        expect(menu1.classList.contains('theia-mod-open')).to.equal(true);
        const menu2 = document.createElement('div');
        ui.toggleCardMenu(card, menu2, btn);
        expect(menu1.classList.contains('theia-mod-open')).to.equal(false);
        expect(menu2.classList.contains('theia-mod-open')).to.equal(false);
    });
});
