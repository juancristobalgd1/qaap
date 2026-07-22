// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
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

});
