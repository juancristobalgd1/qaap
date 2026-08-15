// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import {
    MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT,
    MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE,
    MobileProjectsSessionsSidebarUi,
    type MobileProjectsSessionsSidebarHost,
} from './mobile-projects-sessions-sidebar-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('mobile-projects-sessions-sidebar-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    beforeEach(() => {
        document.body.innerHTML = '';
        window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        }) as typeof window.requestAnimationFrame;
        window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
    });

    it('show more forces a sidebar refresh after increasing the visible conversation limit', () => {
        const project = { id: 'proj-1', name: 'Mockup', status: 'working' } as MobileProjectEntry;
        let refreshOptions: { force?: boolean } | undefined;
        const visibleCounts = new Map<string, number>();
        const host = {
            sessionsSidebarVisibleConversationCountByProjectId: visibleCounts,
            hubQueryUi: {
                projectsForCurrentHubList: () => [{ id: 'a' }, { id: 'b' }],
            },
            conversationIndexUi: {
                conversationsForProject: () => [],
            },
            sessionsSidebar: {
                refreshList: (options?: { force?: boolean }) => { refreshOptions = options; },
            },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        const button = ui.createSessionsSidebarShowMoreControl(project, 20, 25);

        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(visibleCounts.get(project.id)).to.equal(
            MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT
            + MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE,
        );
        expect(refreshOptions).to.deep.equal({ force: true });
    });

    it('prepareSessionsSidebarData merges the composer current workspace when loadProjects is empty', async () => {
        const ephemeral = {
            id: 'ws:file:///Users/jc/qaap',
            name: 'qaap',
            status: 'working',
            uri: { toString: () => 'file:///Users/jc/qaap' },
            isCurrent: true,
        } as MobileProjectEntry;
        const host = {
            projects: [] as MobileProjectEntry[],
            activeTasks: { start: () => undefined },
            conversations: {
                start: () => undefined,
                refreshTheiaChatSessionsForProjects: async () => undefined,
            },
            projectsService: {
                loadProjects: async () => [],
                peekCachedProjects: () => [],
                resolveCurrentWorkspaceProject: () => ephemeral,
            },
            chatServiceSummariesUi: {
                refreshChatServiceSessionSummaries: async () => undefined,
            },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);

        await ui.prepareSessionsSidebarData();

        expect(host.projects).to.deep.equal([ephemeral]);
    });

    it('renders Projects section for projects that have no agent sessions yet', () => {
        const project = {
            id: 'ws:file:///Users/jc/qaap',
            name: 'qaap',
            status: 'working',
            color: '#3B6FA0',
            isCurrent: true,
        } as MobileProjectEntry;
        const host = {
            projects: [project],
            query: '',
            transcriptOpenSummaryId: undefined,
            sessionsSidebarExpandedProjectIds: new Set<string>(),
            sessionsSidebarVisibleConversationCountByProjectId: new Map(),
            sessionsSidebarAccordionDefaultsApplied: false,
            conversationIndexUi: {
                conversationsForProject: () => [],
                compareConversationOrder: () => 0,
                countRunningTasks: () => 0,
                countFailedTasks: () => 0,
                resolveConversationFlags: () => ({ priority: false, paused: false }),
            },
            hubQueryUi: {
                conversationMatchesQuery: () => true,
                projectsForCurrentHubList: () => [project],
            },
            compareChatInboxProjectOrder: () => 0,
            cardMenuUi: {
                buildProjectOptionsMenu: () => document.createElement('div'),
            },
            delegate: {
                onProjectOpenInIde: undefined,
            },
            projectsService: {
                getProjectCwd: () => '/Users/jc/qaap',
            },
            conversations: {
                prefetchDocuments: () => undefined,
                threadStore: { subscribe: () => ({ dispose: () => undefined }) },
            },
            sessionsSidebar: { isVisible: () => false },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        const hostEl = document.createElement('div');

        ui.renderWorkHubSessionsSidebarList(hostEl);

        expect(hostEl.querySelector('.theia-mod-sessions-sidebar-projects-head')).to.not.equal(null);
        expect(hostEl.querySelector('.theia-mobile-work-hub-sessions-sidebar-project-group')).to.not.equal(null);
        expect(hostEl.textContent).to.include('Projects');
        expect(hostEl.textContent).to.include('qaap');
        expect(hostEl.textContent).to.not.include('No agent sessions yet');
    });

    it('seeds composer workspace before the first sidebar paint when projects are empty', () => {
        const ephemeral = {
            id: 'ws:file:///Users/jc/qaap',
            name: 'qaap',
            status: 'working',
            uri: { toString: () => 'file:///Users/jc/qaap' },
            isCurrent: true,
            color: '#3B6FA0',
        } as MobileProjectEntry;
        let showCalls = 0;
        let projectsAtShow = 0;
        const sidebarNode = document.createElement('aside');
        const host = {
            projects: [] as MobileProjectEntry[],
            sessionsSidebar: {
                node: sidebarNode,
                isVisible: () => false,
                show: () => {
                    showCalls += 1;
                    projectsAtShow = host.projects.length;
                },
                refreshList: () => undefined,
                hide: () => undefined,
            },
            sessionsSidebarContainer: () => document.body,
            activeTasks: { start: () => undefined },
            conversations: {
                start: () => undefined,
                refreshTheiaChatSessionsForProjects: async () => undefined,
            },
            projectsService: {
                loadProjects: async () => [],
                peekCachedProjects: () => [],
                resolveCurrentWorkspaceProject: () => ephemeral,
                getCurrentWorkspaceCwd: () => '/Users/jc/qaap',
            },
            chatServiceSummariesUi: {
                refreshChatServiceSessionSummaries: async () => undefined,
            },
            cardMenuUi: {
                closeCardMenu: () => undefined,
            },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);

        ui.openWorkHubSessionsSidebar();

        expect(showCalls).to.equal(1);
        expect(projectsAtShow).to.equal(1);
        expect(host.projects[0]?.id).to.equal(ephemeral.id);
    });

    it('sessions sidebar IDE open control is flat labeled IDE with arrow-up-right icon', () => {
        const project = { id: 'proj-1', name: 'Mockup', status: 'working' } as MobileProjectEntry;
        const host = {
            sessionsSidebar: { hide: () => undefined },
            delegate: { onProjectOpenInIde: () => undefined },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        const button = ui.createSessionsSidebarIdeOpenControl(project);
        const label = button.querySelector('.theia-mobile-work-hub-sessions-sidebar-project-open-label');
        const icon = button.querySelector('svg.theia-mobile-work-hub-sessions-sidebar-project-open-icon');

        expect(button.classList.contains('theia-mobile-work-hub-sessions-sidebar-project-open')).to.equal(true);
        expect(label?.textContent).to.equal('IDE');
        expect(icon).to.not.equal(null);
        expect(icon?.getAttribute('stroke')).to.equal('currentColor');
        expect(icon?.querySelectorAll('path')).to.have.lengthOf(2);
    });

    it('compareSessionsSidebarProjectOrder prefers current then most recent activity', () => {
        const older = {
            id: 'older',
            name: 'Older',
            isCurrent: false,
            lastActiveAt: '2026-01-01T00:00:00.000Z',
        } as MobileProjectEntry;
        const newer = {
            id: 'newer',
            name: 'Newer',
            isCurrent: false,
            lastActiveAt: '2026-07-01T00:00:00.000Z',
        } as MobileProjectEntry;
        const current = {
            id: 'current',
            name: 'Current',
            isCurrent: true,
            lastActiveAt: '2026-02-01T00:00:00.000Z',
        } as MobileProjectEntry;
        const host = {
            agentsHubSelectedProjectId: undefined,
            conversationIndexUi: { countRunningTasks: () => 0 },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        const ordered = [older, newer, current].sort((a, b) => ui.compareSessionsSidebarProjectOrder(a, b));
        expect(ordered.map(p => p.id)).to.deep.equal(['current', 'newer', 'older']);
    });

    it('ensureSessionsSidebarActiveProjectExpanded keeps the selected project open after defaults', () => {
        const selected = { id: 'selected', name: 'Selected', isCurrent: false } as MobileProjectEntry;
        const other = { id: 'other', name: 'Other', isCurrent: false } as MobileProjectEntry;
        const expanded = new Set<string>();
        const host = {
            agentsHubSelectedProjectId: 'selected',
            sessionsSidebarExpandedProjectIds: expanded,
            sessionsSidebarAccordionDefaultsApplied: true,
            conversationIndexUi: { countRunningTasks: () => 0 },
            resolveHomePinnedProject: () => undefined,
            projects: [selected, other],
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);

        ui.ensureSessionsSidebarActiveProjectExpanded([selected, other]);

        expect(expanded.has('selected')).to.equal(true);
        expect(expanded.has('other')).to.equal(false);
    });

    it('openEmptyMobileChatSheet activates the card project on Agents hub landing', async () => {
        const cardProject = { id: 'card-proj', name: 'Card Repo', status: 'idle' } as MobileProjectEntry;
        const activated: string[] = [];
        const resetFor: string[] = [];
        let composerProjectId: string | undefined;
        let surfaceProjectId: string | undefined;
        const host = {
            sessionsSidebar: { hide: () => undefined },
            shouldUseAgentsHubLanding: () => true,
            isProjectDetailView: () => false,
            agentsHubInlineActive: true,
            agentsHubSelectedProjectId: 'other-workspace',
            visible: true,
            activateAgentsHubProject: async (entry: MobileProjectEntry) => {
                activated.push(entry.id);
                host.agentsHubSelectedProjectId = entry.id;
            },
            resetAgentsHubIdleTranscriptShell: (entry: MobileProjectEntry) => {
                resetFor.push(entry.id);
            },
            projectsService: {
                getProjectCwd: () => '/tmp/card-repo',
            },
            activeTasks: { getDefaultAgent: () => 'codex' },
            transcriptStickyComposerUi: {
                resetToProjectComposerDefaults: (entry: MobileProjectEntry) => {
                    composerProjectId = entry.id;
                },
            },
            executionSurfaceTabsUi: {
                setExecutionSurfaceTab: (entry: MobileProjectEntry) => {
                    surfaceProjectId = entry.id;
                },
            },
            renderHeader: () => undefined,
            renderSubtitle: () => undefined,
            stickyComposerRenderUi: { renderStickyComposer: () => undefined },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);

        await ui.openEmptyMobileChatSheet(cardProject);

        expect(activated).to.deep.equal(['card-proj']);
        expect(resetFor).to.deep.equal(['card-proj']);
        expect(host.agentsHubSelectedProjectId).to.equal('card-proj');
        expect(composerProjectId).to.equal('card-proj');
        expect(surfaceProjectId).to.equal('card-proj');
    });

    it('openEmptyMobileChatSheet scopes pending transcript sheets to the card project', async () => {
        const cardProject = { id: 'sheet-proj', name: 'Sheet Repo', status: 'idle' } as MobileProjectEntry;
        let opened: { projectId: string; summaryId: string; cwd: string } | undefined;
        const host = {
            sessionsSidebar: { hide: () => undefined },
            shouldUseAgentsHubLanding: () => false,
            isProjectDetailView: () => false,
            agentsHubSelectedProjectId: undefined as string | undefined,
            projectsService: {
                getProjectCwd: () => '/tmp/sheet-repo',
            },
            activeTasks: { getDefaultAgent: () => 'codex' },
            transcriptSheetUi: {
                openTranscriptSheet: async (entry: MobileProjectEntry, summary: { id: string; cwd: string }) => {
                    opened = { projectId: entry.id, summaryId: summary.id, cwd: summary.cwd };
                },
            },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);

        await ui.openEmptyMobileChatSheet(cardProject);

        expect(host.agentsHubSelectedProjectId).to.equal('sheet-proj');
        expect(opened?.projectId).to.equal('sheet-proj');
        expect(opened?.cwd).to.equal('/tmp/sheet-repo');
        expect(opened?.summaryId.startsWith('pending-new-chat-sheet-proj-')).to.equal(true);
    });

    it('shows a GitHub sign-in CTA when the sidebar is empty and the user is signed out', () => {
        const host = {
            projects: [] as MobileProjectEntry[],
            query: '',
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        ui.readQaapSignedIn = () => false;
        const hostEl = document.createElement('div');

        ui.renderWorkHubSessionsSidebarList(hostEl);

        expect(hostEl.querySelector('.theia-mobile-work-hub-sessions-sidebar-signin')).to.not.equal(null);
        expect(hostEl.textContent).to.include('Sign in with GitHub');
        expect(hostEl.textContent).to.not.include('No agent sessions yet');
    });

    it('shows a compact GitHub sign-in banner when signed out even if a local project exists', () => {
        const project = {
            id: 'ws:file:///Users/jc/qaap',
            name: 'qaap',
            status: 'working',
            color: '#3B6FA0',
            isCurrent: true,
        } as MobileProjectEntry;
        const host = {
            projects: [project],
            query: '',
            transcriptOpenSummaryId: undefined,
            sessionsSidebarExpandedProjectIds: new Set<string>(),
            sessionsSidebarVisibleConversationCountByProjectId: new Map(),
            sessionsSidebarAccordionDefaultsApplied: false,
            conversationIndexUi: {
                conversationsForProject: () => [],
                compareConversationOrder: () => 0,
                countRunningTasks: () => 0,
                countFailedTasks: () => 0,
                resolveConversationFlags: () => ({ priority: false, paused: false }),
            },
            hubQueryUi: {
                conversationMatchesQuery: () => true,
                projectsForCurrentHubList: () => [project],
            },
            compareChatInboxProjectOrder: () => 0,
            cardMenuUi: {
                buildProjectOptionsMenu: () => document.createElement('div'),
            },
            delegate: {
                onProjectOpenInIde: undefined,
            },
            projectsService: {
                getProjectCwd: () => '/Users/jc/qaap',
            },
            conversations: {
                prefetchDocuments: () => undefined,
                threadStore: { subscribe: () => ({ dispose: () => undefined }) },
            },
            sessionsSidebar: { isVisible: () => false },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        ui.readQaapSignedIn = () => false;
        const hostEl = document.createElement('div');

        ui.renderWorkHubSessionsSidebarList(hostEl);

        const hint = hostEl.querySelector('.theia-mobile-work-hub-sessions-sidebar-signin');
        expect(hint).to.not.equal(null);
        expect(hint?.classList.contains('theia-mod-compact')).to.equal(true);
        expect(hostEl.textContent).to.include('Sign in with GitHub');
        expect(hostEl.textContent).to.include('Projects');
        expect(hostEl.textContent).to.include('qaap');
    });

    it('keeps the empty-sessions copy when the user is signed in', () => {
        const host = {
            projects: [] as MobileProjectEntry[],
            query: '',
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        ui.readQaapSignedIn = () => true;
        const hostEl = document.createElement('div');

        ui.renderWorkHubSessionsSidebarList(hostEl);

        expect(hostEl.querySelector('.theia-mobile-work-hub-sessions-sidebar-signin')).to.equal(null);
        expect(hostEl.textContent).to.include('No agent sessions yet');
    });

    it('Clear failed runs enters clear mode instead of deleting immediately', () => {
        const project = { id: 'proj-1', name: 'Mockup', status: 'working' } as MobileProjectEntry;
        const failed = [
            { id: 'f1', status: 'failed', title: 'A', cwd: '/r', source: 'agent' },
            { id: 'f2', status: 'failed', title: 'A', cwd: '/r', source: 'agent' },
        ];
        let refreshForce: { force?: boolean } | undefined;
        const host = {
            conversationIndexUi: {
                vpsTasksForProject: () => failed,
                countFailedTasks: () => failed.length,
            },
            sessionsSidebar: {
                refreshList: (options?: { force?: boolean }) => { refreshForce = options; },
            },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        const button = ui.createSessionsSidebarClearFailedControl(project, failed.length);

        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(ui.clearFailedModeProjectId).to.equal(project.id);
        expect([...ui.selectedFailedConversationIds].sort()).to.deep.equal(['f1', 'f2']);
        expect(refreshForce).to.deep.equal({ force: true });
    });

    it('bypasses failed-duplicate collapse while a project is in clear mode', () => {
        const project = { id: 'proj-1', name: 'Mockup', status: 'working' } as MobileProjectEntry;
        const conversations = [
            {
                id: 'old',
                title: 'Same title',
                status: 'failed',
                createdAt: 10,
                updatedAt: 10,
                messageCount: 1,
                agentId: 'qaiq',
                cwd: '/repo',
                source: 'agent',
            },
            {
                id: 'new',
                title: 'Same title',
                status: 'failed',
                createdAt: 30,
                updatedAt: 30,
                messageCount: 1,
                agentId: 'qaiq',
                cwd: '/repo',
                source: 'agent',
            },
            {
                id: 'ok',
                title: 'Same title',
                status: 'idle',
                createdAt: 40,
                updatedAt: 40,
                messageCount: 1,
                agentId: 'qaiq',
                cwd: '/repo',
                source: 'agent',
            },
        ];
        const createdIds: string[] = [];
        const host = {
            conversationIndexUi: {
                countFailedTasks: () => 2,
                activeInfoForProject: () => undefined,
                summaryToTaskView: (summary: { id: string; title: string }) => ({
                    id: summary.id,
                    title: summary.title,
                    command: '',
                    cwd: '/repo',
                    state: 'failed',
                    createdAt: 0,
                }),
                vpsTasksForProject: () => conversations.filter(c => c.status === 'failed'),
            },
            projectRowsUi: {
                createTaskItem: (
                    _project: MobileProjectEntry,
                    task: { id: string },
                    _active: unknown,
                    summary: { id: string },
                    _parentIds: ReadonlySet<string>,
                    options?: { selection?: { selected: boolean } },
                ) => {
                    createdIds.push(summary.id);
                    const el = document.createElement('div');
                    el.dataset.qaapConversationId = summary.id;
                    if (options?.selection) {
                        el.classList.add('theia-mod-clear-failed-select');
                        el.dataset.selected = options.selection.selected ? '1' : '0';
                    }
                    return el;
                },
            },
            ensureOverlayUi: () => undefined,
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        ui.clearFailedModeProjectId = project.id;
        ui.selectedFailedConversationIds = new Set(['old', 'new']);

        const listHost = document.createElement('div');
        ui.appendSessionsSidebarConversationItems(listHost, project, conversations as never, () => undefined, true);

        expect(createdIds).to.include.members(['old', 'new', 'ok']);
        expect(listHost.querySelectorAll('.theia-mod-clear-failed-select')).to.have.length(2);
        expect(listHost.querySelector('.theia-mobile-work-hub-sessions-sidebar-clear-failed-mode-footer')).to.not.equal(null);
        expect(listHost.querySelector('.theia-mobile-work-hub-sessions-sidebar-clear-failed')).to.equal(null);
    });

    it('clear-mode footer Cancel exits mode and Clear selected stays disabled at k=0', () => {
        const project = { id: 'proj-1', name: 'Mockup', status: 'working' } as MobileProjectEntry;
        const host = {
            conversationIndexUi: {
                vpsTasksForProject: () => [{ id: 'f1', status: 'failed' }],
            },
            sessionsSidebar: {
                refreshList: () => undefined,
            },
            onClearFailedTasks: async () => true,
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        ui.clearFailedModeProjectId = project.id;
        ui.selectedFailedConversationIds = new Set();

        const footer = ui.createSessionsSidebarClearFailedModeFooter(project);
        const cancel = footer.querySelector('.theia-mobile-work-hub-sessions-sidebar-clear-failed-cancel') as HTMLButtonElement;
        const clear = footer.querySelector('.theia-mobile-work-hub-sessions-sidebar-clear-failed-confirm') as HTMLButtonElement;
        expect(clear.disabled).to.equal(true);

        cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(ui.clearFailedModeProjectId).to.equal(undefined);
        expect(ui.selectedFailedConversationIds.size).to.equal(0);
    });

    it('Clear selected forwards the selected ids and exits mode after success', async () => {
        const project = { id: 'proj-1', name: 'Mockup', status: 'working' } as MobileProjectEntry;
        let receivedIds: readonly string[] | undefined;
        const host = {
            conversationIndexUi: {
                vpsTasksForProject: () => [
                    { id: 'f1', status: 'failed' },
                    { id: 'f2', status: 'failed' },
                ],
            },
            sessionsSidebar: {
                refreshList: () => undefined,
            },
            onClearFailedTasks: async (_project: MobileProjectEntry, ids?: readonly string[]) => {
                receivedIds = ids;
                return true;
            },
        } as unknown as MobileProjectsSessionsSidebarHost;
        const ui = new MobileProjectsSessionsSidebarUi(host);
        ui.clearFailedModeProjectId = project.id;
        ui.selectedFailedConversationIds = new Set(['f2']);

        const footer = ui.createSessionsSidebarClearFailedModeFooter(project);
        const clear = footer.querySelector('.theia-mobile-work-hub-sessions-sidebar-clear-failed-confirm') as HTMLButtonElement;
        expect(clear.disabled).to.equal(false);
        clear.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise<void>(resolve => { setTimeout(resolve, 0); });

        expect(receivedIds).to.deep.equal(['f2']);
        expect(ui.clearFailedModeProjectId).to.equal(undefined);
    });

});
