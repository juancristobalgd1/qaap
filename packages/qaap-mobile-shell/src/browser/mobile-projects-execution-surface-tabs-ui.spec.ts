// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    MobileProjectsExecutionSurfaceTabsUi,
    type MobileProjectsExecutionSurfaceTabsHost,
} from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectEntry } from './mobile-projects-types';
import { clearPreferDesktopIde, markPreferDesktopIde } from './mobile-projects-open';

describe('mobile-projects-execution-surface-tabs-ui', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    beforeEach(() => {
        clearPreferDesktopIde();
    });

    afterEach(() => {
        clearPreferDesktopIde();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function createHost(overrides: Partial<MobileProjectsExecutionSurfaceTabsHost> = {}): MobileProjectsExecutionSurfaceTabsHost {
        return {
            executionSurfaceTabByProjectId: new Map(),
            transcriptTabStrip: undefined,
            transcriptSheet: undefined,
            transcriptChatHost: undefined,
            transcriptChatInputHost: undefined,
            transcriptReviewHost: undefined,
            transcriptPreviewHost: undefined,
            transcriptFilesHost: undefined,
            transcriptTerminalHost: undefined,
            transcriptTerminalToolbar: undefined,
            transcriptTerminalPinnedMode: undefined,
            transcriptWorkspaceSurfaces: {} as MobileProjectsExecutionSurfaceTabsHost['transcriptWorkspaceSurfaces'],
            transcriptHeaderSubtitle: undefined,
            transcriptOpenSummary: undefined,
            transcriptOpenProject: undefined,
            transcriptLastConv: undefined,
            headerViewModeSwitchHost: document.createElement('div'),
            projectDetailTabStrip: undefined,
            projectDetailSurfaceTargets: undefined,
            headerExecutionTabsHost: document.createElement('div'),
            headerExecutionTabsProjectId: undefined,
            agentsHubShellActive: true,
            agentsHubInlineTranscriptRoot: undefined,
            agentsHubInlineExecutionRoot: undefined,
            agentsHubInlineTabStrip: undefined,
            stickyComposerHost: document.createElement('div'),
            transcriptComposerSummary: undefined,
            transcriptStickyComposerUi: {
                flushTranscriptComposerDraft: () => undefined,
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptStickyComposerUi'],
            root: document.createElement('div'),
            scroll: document.createElement('div'),
            executionTabOverflowMenu: undefined,
            executionTabOverflowAnchor: undefined,
            executionTabOverflowDispose: Disposable.NULL,
            executionSurfaceSidebar: undefined,
            expandedId: undefined,
            projectDetailExpandedId: undefined,
            transcriptHeaderUi: {} as MobileProjectsExecutionSurfaceTabsHost['transcriptHeaderUi'],
            transcriptSurfacesUi: {
                suspendTranscriptPreviewIframe: () => undefined,
                updateTranscriptHeader: () => undefined,
                renderPlanTab: () => undefined,
                mountTranscriptReviewWidget: async () => undefined,
                renderPreviewTab: () => undefined,
                ensureTranscriptFilesTab: () => undefined,
                ensureTranscriptTerminalTab: async () => undefined,
                syncExecutionSurfaceChrome: () => undefined,
                syncHeaderPreviewRunButton: () => undefined,
                hideHeaderPreviewRunButton: () => undefined,
                syncHeaderFilesMoreButton: () => undefined,
                hideHeaderFilesMoreButton: () => undefined,
                syncHeaderViewModeSwitch: () => undefined,
                hideHeaderViewModeSwitch: () => undefined,
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptSurfacesUi'],
            projectDetailUi: {} as MobileProjectsExecutionSurfaceTabsHost['projectDetailUi'],
            ensureAgentsHubExecutionShellRendered: () => undefined,
            appendTranscriptHeaderActions: () => document.createElement('button'),
            renderHeader: () => undefined,
            renderSubtitle: () => undefined,
            stickyComposerRenderUi: {
                renderStickyComposer: () => undefined,
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['stickyComposerRenderUi'],
            stickyComposerAgentsUi: {
                ensureStickyComposerAgentsLoaded: async () => [],
                resolveStickyComposerPinnedAgentId: () => 'qaiq',
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['stickyComposerAgentsUi'],
            stickyComposerPinnedAgentId: 'qaiq',
            resolveAgentsHubShellProject: () => undefined,
            resolveAgentsHubShellSummary: () => ({
                id: 'idle',
                cwd: '/tmp/demo',
                agentId: 'task',
                title: 'Idle',
                status: 'idle',
                createdAt: 1,
                updatedAt: 1,
                messageCount: 0,
            }),
            projectNavigationUi: {} as MobileProjectsExecutionSurfaceTabsHost['projectNavigationUi'],
            hubQueryUi: {} as MobileProjectsExecutionSurfaceTabsHost['hubQueryUi'],
            isProjectDetailView: () => false,
            openDesktopIdeFromAgentsHub: async () => undefined,
            projects: [],
            closeCardMenu: () => undefined,
            cardMenuUi: {
                closeCardMenu: () => undefined,
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['cardMenuUi'],
            ...overrides,
        };
    }

    it('rebinds connected WorkHub surface hosts before applying tab visibility', () => {
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        const transcriptRoot = document.createElement('div');
        transcriptRoot.className = 'theia-mobile-agents-hub-inline-transcript';
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        transcriptRoot.append(chatHost);
        const filesHost = document.createElement('div');
        filesHost.className = 'theia-mobile-transcript-files-host';
        filesHost.hidden = true;
        const terminalHost = document.createElement('div');
        terminalHost.className = 'theia-mobile-transcript-terminal-host';
        terminalHost.hidden = true;
        executionRoot.append(transcriptRoot, filesHost, terminalHost);
        document.body.append(executionRoot);
        try {
            const staleTerminalHost = document.createElement('div');
            staleTerminalHost.hidden = true;
            const host = createHost({
                agentsHubInlineExecutionRoot: executionRoot,
                transcriptTerminalHost: staleTerminalHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.showOnlyExecutionSurfaceTab('terminal');

            expect(host.transcriptTerminalHost).to.equal(terminalHost);
            expect(terminalHost.hidden).to.equal(false);
            expect(filesHost.hidden).to.equal(true);
            expect(transcriptRoot.hidden).to.equal(false);
            expect(executionRoot.getAttribute('data-active-surface')).to.equal('terminal');
        } finally {
            executionRoot.remove();
        }
    });

    it('chooses the populated Files host when a stale empty host is also present', () => {
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        const transcriptRoot = document.createElement('div');
        transcriptRoot.className = 'theia-mobile-agents-hub-inline-transcript';
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        const staleFilesHost = document.createElement('div');
        staleFilesHost.className = 'theia-mobile-transcript-files-host';
        staleFilesHost.hidden = true;
        const liveFilesHost = document.createElement('div');
        liveFilesHost.className = 'theia-mobile-transcript-files-host';
        liveFilesHost.hidden = true;
        liveFilesHost.append(document.createElement('div'));
        executionRoot.append(transcriptRoot, staleFilesHost, liveFilesHost);
        transcriptRoot.append(chatHost);
        document.body.append(executionRoot);
        try {
            const host = createHost({
                agentsHubInlineExecutionRoot: executionRoot,
                transcriptFilesHost: staleFilesHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.showOnlyExecutionSurfaceTab('files');

            expect(host.transcriptFilesHost).to.equal(liveFilesHost);
            expect(staleFilesHost.hidden).to.equal(true);
            expect(liveFilesHost.hidden).to.equal(false);
        } finally {
            executionRoot.remove();
        }
    });

    it('restores the Chat layout class when a conversation selection bypasses tab activation', () => {
        const root = document.createElement('div');
        const chatHost = document.createElement('div');
        const filesHost = document.createElement('div');
        root.append(chatHost, filesHost);
        document.body.append(root);
        try {
            const project = { id: 'p-layout', name: 'Layout' } as MobileProjectEntry;
            const host = createHost({
                root,
                transcriptOpenProject: project,
                transcriptChatHost: chatHost,
                transcriptFilesHost: filesHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            // This is the path used while opening another conversation: the active surface is
            // already set in the project map and only the shared visibility sync is called.
            root.classList.add('theia-mod-project-surface-tools');
            ui.showOnlyExecutionSurfaceTab('messages');
            expect(root.classList.contains('theia-mod-project-surface-chat')).to.equal(true);
            expect(root.classList.contains('theia-mod-project-surface-tools')).to.equal(false);
            expect(chatHost.hidden).to.equal(false);
            expect(filesHost.hidden).to.equal(true);

            ui.showOnlyExecutionSurfaceTab('files');
            expect(root.classList.contains('theia-mod-project-surface-chat')).to.equal(true);
            expect(root.classList.contains('theia-mod-project-surface-tools')).to.equal(false);
        } finally {
            root.remove();
        }
    });

    it('opens a project-detail execution surface over Chat when the detail flag is not set', () => {
        const project = { id: 'p-detail-drawer', name: 'Detail drawer' } as MobileProjectEntry;
        const summary = {
            id: 'conv-detail-drawer',
            cwd: '/tmp/detail-drawer',
            agentId: 'task',
            title: 'Detail drawer',
            status: 'idle' as const,
            createdAt: 1,
            updatedAt: 1,
            messageCount: 0,
        };
        const root = document.createElement('div');
        const chatHost = document.createElement('div');
        const filesHost = document.createElement('div');
        const previewHost = document.createElement('div');
        const terminalHost = document.createElement('div');
        root.append(chatHost, filesHost, previewHost, terminalHost);
        document.body.append(root);
        try {
            const host = createHost({
                root,
                agentsHubShellActive: false,
                projectDetailSurfaceTargets: {
                    chatHost,
                    reviewHost: document.createElement('div'),
                    previewHost,
                    filesHost,
                    terminalHost,
                },
                transcriptSurfacesUi: {
                    ...createHost().transcriptSurfacesUi,
                    mountProjectDetailSurfaceTab: () => undefined,
                } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptSurfacesUi'],
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.activateExecutionSurfaceTab('files', project, summary, 'project-detail');

            expect(host.executionSurfaceSidebar?.activeTab).to.equal('files');
            expect(host.executionSurfaceSidebar?.element.isConnected).to.equal(true);
            expect(host.executionSurfaceSidebar?.element.getAttribute('aria-label')).to.equal('Files');
            expect(host.executionSurfaceSidebar?.element.querySelector('h2')).to.equal(null);
            expect(filesHost.hidden).to.equal(false);
            expect(chatHost.hidden).to.equal(false);
        } finally {
            root.remove();
            document.querySelectorAll('.theia-mobile-execution-surface-sidebar, .theia-mobile-execution-surface-sidebar-backdrop').forEach(element => element.remove());
        }
    });

    it('moves the Files/Changes switch into the Files drawer header', () => {
        const project = { id: 'p-files-switch', name: 'Files switch' } as MobileProjectEntry;
        const summary = {
            id: 'conv-files-switch',
            cwd: '/tmp/files-switch',
            agentId: 'task',
            title: 'Files switch',
            status: 'idle' as const,
            createdAt: 1,
            updatedAt: 1,
            messageCount: 0,
        };
        const root = document.createElement('div');
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        const filesHost = document.createElement('div');
        filesHost.className = 'theia-mobile-transcript-files-host';
        executionRoot.append(filesHost);
        const headerParent = document.createElement('div');
        const viewModeHost = document.createElement('div');
        viewModeHost.className = 'theia-mobile-projects-header-view-mode-switch';
        const viewModeSwitch = document.createElement('div');
        viewModeSwitch.className = 'theia-mobile-transcript-files-view-mode-switch';
        viewModeHost.append(viewModeSwitch);
        headerParent.append(viewModeHost);
        root.append(headerParent, executionRoot);
        document.body.append(root);
        try {
            const host = createHost({
                root,
                transcriptFilesHost: filesHost,
                agentsHubInlineExecutionRoot: executionRoot,
                headerViewModeSwitchHost: viewModeHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.openExecutionSurfaceSidebar('files', project, summary, 'transcript');

            expect(host.executionSurfaceSidebar?.element.querySelector('.theia-mobile-transcript-files-view-mode-switch')).to.equal(viewModeSwitch);
            expect(viewModeHost.parentElement).to.equal(host.executionSurfaceSidebar?.element.querySelector('.theia-mobile-execution-surface-sidebar-header'));

            ui.dismissExecutionSurfaceSidebar();

            expect(viewModeHost.parentElement).to.equal(headerParent);
            expect(viewModeHost.hidden).to.equal(true);
        } finally {
            root.remove();
            document.querySelectorAll('.theia-mobile-execution-surface-sidebar, .theia-mobile-execution-surface-sidebar-backdrop').forEach(element => element.remove());
        }
    });

    it('promotes the selected-file row into the Files drawer header', () => {
        const project = { id: 'p-files-preview-header', name: 'Files preview header' } as MobileProjectEntry;
        const summary = {
            id: 'conv-files-preview-header',
            cwd: '/tmp/files-preview-header',
            agentId: 'task',
            title: 'Files preview header',
            status: 'idle' as const,
            createdAt: 1,
            updatedAt: 1,
            messageCount: 0,
        };
        const root = document.createElement('div');
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        const filesHost = document.createElement('div');
        filesHost.className = 'theia-mobile-transcript-files-host';
        const previewPane = document.createElement('div');
        previewPane.className = 'theia-mobile-transcript-files-preview';
        const previewHeader = document.createElement('div');
        previewHeader.className = 'theia-mobile-transcript-files-preview-header';
        previewHeader.append(document.createElement('div'));
        const previewBody = document.createElement('div');
        previewBody.className = 'theia-mobile-transcript-files-preview-body';
        previewPane.append(previewHeader, previewBody);
        filesHost.append(previewPane);
        executionRoot.append(filesHost);
        root.append(executionRoot);
        document.body.append(root);
        try {
            const host = createHost({
                root,
                transcriptFilesHost: filesHost,
                agentsHubInlineExecutionRoot: executionRoot,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.openExecutionSurfaceSidebar('files', project, summary, 'transcript');

            const sidebar = host.executionSurfaceSidebar!.element;
            const drawerHeader = sidebar.querySelector('.theia-mobile-execution-surface-sidebar-header');
            expect(drawerHeader?.querySelector('.theia-mobile-execution-surface-sidebar-icon')).to.equal(null);
            expect(drawerHeader?.querySelector('.theia-mobile-execution-surface-sidebar-title')).to.equal(null);
            expect(drawerHeader?.querySelector('.theia-mobile-transcript-files-preview-header')).to.equal(previewHeader);
            expect(previewHeader.parentElement).to.equal(drawerHeader);

            ui.dismissExecutionSurfaceSidebar();

            expect(previewHeader.parentElement).to.equal(previewPane);
        } finally {
            root.remove();
            document.querySelectorAll('.theia-mobile-execution-surface-sidebar, .theia-mobile-execution-surface-sidebar-backdrop').forEach(element => element.remove());
        }
    });

    it('moves a Files/Changes switch into the drawer when the header renders it asynchronously', async () => {
        const project = { id: 'p-files-switch-delayed', name: 'Delayed Files switch' } as MobileProjectEntry;
        const summary = {
            id: 'conv-files-switch-delayed',
            cwd: '/tmp/files-switch-delayed',
            agentId: 'task',
            title: 'Delayed Files switch',
            status: 'idle' as const,
            createdAt: 1,
            updatedAt: 1,
            messageCount: 0,
        };
        const root = document.createElement('div');
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        const filesHost = document.createElement('div');
        filesHost.className = 'theia-mobile-transcript-files-host';
        executionRoot.append(filesHost);
        const headerParent = document.createElement('div');
        const viewModeHost = document.createElement('div');
        viewModeHost.className = 'theia-mobile-projects-header-view-mode-switch';
        viewModeHost.hidden = true;
        headerParent.append(viewModeHost);
        root.append(headerParent, executionRoot);
        document.body.append(root);
        try {
            const host = createHost({
                root,
                transcriptFilesHost: filesHost,
                agentsHubInlineExecutionRoot: executionRoot,
                headerViewModeSwitchHost: viewModeHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.openExecutionSurfaceSidebar('files', project, summary, 'transcript');

            const viewModeSwitch = document.createElement('div');
            viewModeSwitch.className = 'theia-mobile-transcript-files-view-mode-switch';
            viewModeHost.append(viewModeSwitch);
            viewModeHost.hidden = false;
            await new Promise(resolve => window.setTimeout(resolve, 0));

            expect(viewModeHost.parentElement).to.equal(host.executionSurfaceSidebar?.element.querySelector('.theia-mobile-execution-surface-sidebar-header'));
        } finally {
            root.remove();
            document.querySelectorAll('.theia-mobile-execution-surface-sidebar, .theia-mobile-execution-surface-sidebar-backdrop').forEach(element => element.remove());
        }
    });

    it('promotes the Preview toolbar into the drawer header and restores it on close', () => {
        const project = { id: 'p-preview-toolbar', name: 'Preview toolbar' } as MobileProjectEntry;
        const summary = { id: 'conv-preview-toolbar' } as MobileProjectsExecutionSurfaceTabsHost['transcriptOpenSummary'];
        const root = document.createElement('div');
        const previewHost = document.createElement('div');
        previewHost.className = 'theia-mobile-transcript-preview';
        const toolbar = document.createElement('div');
        toolbar.className = 'qaap-agent-preview-embedded-toolbar';
        previewHost.append(toolbar);
        root.append(previewHost);
        document.body.append(root);
        try {
            const host = createHost({ root, transcriptPreviewHost: previewHost });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.openExecutionSurfaceSidebar('preview', project, summary!, 'transcript');

            const sidebar = host.executionSurfaceSidebar!.element;
            expect(sidebar.querySelector('h2')).to.equal(null);
            expect(sidebar.querySelector('.theia-mobile-execution-surface-sidebar-icon')).to.equal(null);
            expect(sidebar.querySelector('.theia-mobile-execution-surface-sidebar-toolbar')).to.equal(toolbar);
            expect(sidebar.querySelector('.theia-mobile-execution-surface-sidebar-close')).to.exist;

            ui.dismissExecutionSurfaceSidebar();
            expect(toolbar.parentElement).to.equal(previewHost);
        } finally {
            root.remove();
            document.querySelectorAll('.theia-mobile-execution-surface-sidebar, .theia-mobile-execution-surface-sidebar-backdrop').forEach(element => element.remove());
        }
    });

    it('promotes the Terminal toolbar into the drawer header and restores it on close', () => {
        const project = { id: 'p-terminal-toolbar', name: 'Terminal toolbar' } as MobileProjectEntry;
        const summary = { id: 'conv-terminal-toolbar' } as MobileProjectsExecutionSurfaceTabsHost['transcriptOpenSummary'];
        const root = document.createElement('div');
        const terminalHost = document.createElement('div');
        terminalHost.className = 'theia-mobile-transcript-terminal-host';
        const toolbar = document.createElement('div');
        toolbar.className = 'theia-mobile-transcript-terminal-toolbar';
        terminalHost.append(toolbar);
        root.append(terminalHost);
        document.body.append(root);
        try {
            const host = createHost({ root, transcriptTerminalHost: terminalHost });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.openExecutionSurfaceSidebar('terminal', project, summary!, 'transcript');

            const sidebar = host.executionSurfaceSidebar!.element;
            expect(sidebar.querySelector('h2')).to.equal(null);
            expect(sidebar.querySelector('.theia-mobile-execution-surface-sidebar-icon')).to.equal(null);
            expect(sidebar.querySelector('.theia-mobile-execution-surface-sidebar-toolbar')).to.equal(toolbar);
            expect(sidebar.querySelector('.theia-mobile-execution-surface-sidebar-close')).to.exist;

            ui.dismissExecutionSurfaceSidebar();
            expect(toolbar.parentElement).to.equal(terminalHost);
        } finally {
            root.remove();
            document.querySelectorAll('.theia-mobile-execution-surface-sidebar, .theia-mobile-execution-surface-sidebar-backdrop').forEach(element => element.remove());
        }
    });

    it('keeps one Terminal toolbar in the drawer when the terminal host rerenders it', async () => {
        const project = { id: 'p-terminal-toolbar-rerender', name: 'Terminal toolbar rerender' } as MobileProjectEntry;
        const summary = { id: 'conv-terminal-toolbar-rerender' } as MobileProjectsExecutionSurfaceTabsHost['transcriptOpenSummary'];
        const root = document.createElement('div');
        const terminalHost = document.createElement('div');
        terminalHost.className = 'theia-mobile-transcript-terminal-host';
        const initialToolbar = document.createElement('div');
        initialToolbar.className = 'theia-mobile-transcript-terminal-toolbar';
        terminalHost.append(initialToolbar);
        root.append(terminalHost);
        document.body.append(root);
        try {
            const host = createHost({ root, transcriptTerminalHost: terminalHost });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            ui.openExecutionSurfaceSidebar('terminal', project, summary!, 'transcript');

            const replacementToolbar = document.createElement('div');
            replacementToolbar.className = 'theia-mobile-transcript-terminal-toolbar';
            terminalHost.append(replacementToolbar);
            await new Promise(resolve => window.setTimeout(resolve, 0));

            const sidebar = host.executionSurfaceSidebar!.element;
            expect(sidebar.querySelectorAll('.theia-mobile-transcript-terminal-toolbar')).to.have.length(1);
            expect(sidebar.querySelector('.theia-mobile-execution-surface-sidebar-header .theia-mobile-transcript-terminal-toolbar'))
                .to.equal(replacementToolbar);

            ui.dismissExecutionSurfaceSidebar();
            expect(replacementToolbar.parentElement).to.equal(terminalHost);
        } finally {
            root.remove();
            document.querySelectorAll('.theia-mobile-execution-surface-sidebar, .theia-mobile-execution-surface-sidebar-backdrop').forEach(element => element.remove());
        }
    });

    it('commits Files synchronously, keeps Chat mounted, and restores Files after shell re-renders', async () => {
        const project: MobileProjectEntry = {
            id: 'p-files',
            name: 'Files project',
            color: '#8EB5DC',
            branch: 'main',
            status: 'working',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent: true,
        };
        const summary = {
            id: 'conv-files',
            cwd: '/tmp/files-project',
            agentId: 'task',
            title: 'Inspect files',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        };
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        const transcriptRoot = document.createElement('div');
        transcriptRoot.className = 'theia-mobile-agents-hub-inline-transcript';
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        const filesHost = document.createElement('div');
        filesHost.className = 'theia-mobile-transcript-files-host';
        const previewHost = document.createElement('div');
        previewHost.className = 'theia-mobile-transcript-preview-host';
        const terminalHost = document.createElement('div');
        terminalHost.className = 'theia-mobile-transcript-terminal-host';
        transcriptRoot.append(chatHost);
        executionRoot.append(transcriptRoot, filesHost, previewHost, terminalHost);
        document.body.append(executionRoot);
        try {
            const host = createHost({
                projects: [project],
                agentsHubShellActive: true,
                agentsHubInlineExecutionRoot: executionRoot,
                agentsHubInlineTranscriptRoot: transcriptRoot,
                transcriptOpenProject: project,
                transcriptOpenSummary: summary,
                transcriptChatHost: chatHost,
                transcriptFilesHost: filesHost,
                transcriptPreviewHost: previewHost,
                transcriptTerminalHost: terminalHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

            // The click path must commit the map before any asynchronous Files work begins.
            ui.selectTranscriptTab('files', project, summary);
            expect(host.executionSurfaceTabByProjectId.get(project.id)).to.equal('files');
            expect(executionRoot.getAttribute('data-active-surface')).to.equal('messages');
            expect(chatHost.hidden).to.equal(false);
            expect(filesHost.hidden).to.equal(false);

            // 0 ms and 500 ms are both covered, including the delayed Files mount boundary.
            await new Promise<void>(resolve => window.setTimeout(resolve, 0));
            ui.restoreActiveExecutionSurface(project, summary);
            expect(executionRoot.getAttribute('data-active-surface')).to.equal('messages');
            expect(chatHost.hidden).to.equal(false);
            expect(filesHost.hidden).to.equal(false);
            await new Promise<void>(resolve => window.setTimeout(resolve, 500));
            ui.restoreActiveExecutionSurface(project, summary);
            expect(executionRoot.getAttribute('data-active-surface')).to.equal('messages');
            expect(chatHost.hidden).to.equal(false);
            expect(filesHost.hidden).to.equal(false);
        } finally {
            executionRoot.remove();
        }
    });

    it('keeps Files active while an asynchronous Files mount completes', async () => {
        const project = { id: 'p-async', name: 'Async files' } as MobileProjectEntry;
        const summary = {
            id: 'conv-async',
            cwd: '/tmp/async-files',
            agentId: 'task',
            title: 'Async files',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        };
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        const transcriptRoot = document.createElement('div');
        transcriptRoot.className = 'theia-mobile-agents-hub-inline-transcript';
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        const filesHost = document.createElement('div');
        filesHost.className = 'theia-mobile-transcript-files-host';
        transcriptRoot.append(chatHost);
        executionRoot.append(transcriptRoot, filesHost);
        document.body.append(executionRoot);
        let finishMount!: () => void;
        let mountRestoreScheduled = false;
        const mountFinished = new Promise<void>(resolve => { finishMount = resolve; });
        try {
            const host = createHost({
                projects: [project],
                agentsHubShellActive: true,
                agentsHubInlineExecutionRoot: executionRoot,
                agentsHubInlineTranscriptRoot: transcriptRoot,
                transcriptOpenProject: project,
                transcriptOpenSummary: summary,
                transcriptChatHost: chatHost,
                transcriptFilesHost: filesHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);
            host.transcriptSurfacesUi.ensureTranscriptFilesTab = () => {
                if (!mountRestoreScheduled) {
                    mountRestoreScheduled = true;
                    void mountFinished.then(() => ui.restoreActiveExecutionSurface(project, summary));
                }
            };

            ui.selectTranscriptTab('files', project, summary);
            expect(host.executionSurfaceTabByProjectId.get(project.id)).to.equal('files');
            expect(chatHost.hidden).to.equal(false);
            expect(filesHost.hidden).to.equal(false);
            finishMount();
            await mountFinished;
            expect(host.executionSurfaceTabByProjectId.get(project.id)).to.equal('files');
            expect(executionRoot.getAttribute('data-active-surface')).to.equal('messages');
            expect(chatHost.hidden).to.equal(false);
            expect(filesHost.hidden).to.equal(false);
        } finally {
            executionRoot.remove();
        }
    });

    it('cycles Chat, Files, Preview, and Terminal without leaking visibility', () => {
        const project = { id: 'p-cycle', name: 'Cycle' } as MobileProjectEntry;
        const summary = {
            id: 'conv-cycle',
            cwd: '/tmp/cycle',
            agentId: 'task',
            title: 'Cycle',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        };
        const root = document.createElement('div');
        const chatHost = document.createElement('div');
        const filesHost = document.createElement('div');
        const previewHost = document.createElement('div');
        const terminalHost = document.createElement('div');
        root.append(chatHost, filesHost, previewHost, terminalHost);
        document.body.append(root);
        try {
            const host = createHost({
                root,
                transcriptStickyComposerUi: {
                    flushTranscriptComposerDraft: () => undefined,
                    syncTranscriptComposerQuickActionsVisibility: () => undefined,
                } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptStickyComposerUi'],
                transcriptOpenProject: project,
                transcriptOpenSummary: summary,
                transcriptChatHost: chatHost,
                transcriptFilesHost: filesHost,
                transcriptPreviewHost: previewHost,
                transcriptTerminalHost: terminalHost,
            });
            const ui = new MobileProjectsExecutionSurfaceTabsUi(host);
            const expected = [
                ['messages', chatHost],
                ['files', filesHost],
                ['preview', previewHost],
                ['terminal', terminalHost],
                ['files', filesHost],
                ['messages', chatHost],
            ] as const;
            for (const [tab, visibleHost] of expected) {
                ui.selectTranscriptTab(tab, project, summary);
                expect(host.executionSurfaceTabByProjectId.get(project.id)).to.equal(tab);
                expect(visibleHost.hidden).to.equal(false);
                expect(chatHost.hidden).to.equal(false);
                for (const surfaceHost of [filesHost, previewHost, terminalHost]) {
                    if (surfaceHost !== visibleHost) {
                        expect(surfaceHost.hidden).to.equal(true);
                    }
                }
            }
        } finally {
            root.remove();
        }
    });

    it('does not reset a saved Files surface when the transcript header is rebuilt', () => {
        const project = { id: 'p-header', name: 'Header' } as MobileProjectEntry;
        const summary = {
            id: 'conv-header',
            cwd: '/tmp/header',
            agentId: 'task',
            title: 'Header',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        };
        const host = createHost({ projects: [project] });
        host.executionSurfaceTabByProjectId.set(project.id, 'files');
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

        ui.mountTranscriptExecutionHeader(document.createElement('header'), project, summary, 'Header');

        expect(host.executionSurfaceTabByProjectId.get(project.id)).to.equal('files');
    });

    it('keeps all execution tabs in the overflow menu while the agent is streaming', () => {
        const project: MobileProjectEntry = {
            id: 'p1',
            name: 'Demo',
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent: true,
        };
        const summary = {
            id: 'conv-1',
            cwd: '/tmp/demo',
            agentId: 'qaiq',
            title: 'Build page',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
        };
        const ui = new MobileProjectsExecutionSurfaceTabsUi(createHost({
            transcriptOpenProject: project,
            transcriptOpenSummary: summary,
            transcriptLastConv: {
                id: 'conv-1',
                cwd: '/tmp/demo',
                agentId: 'qaiq',
                title: 'Build page',
                status: 'streaming',
                createdAt: 1,
                updatedAt: 2,
                messages: [{
                    id: 'a1',
                    role: 'agent',
                    content: 'Working…',
                    createdAt: 2,
                }],
            },
            projects: [project],
        }));

        expect(ui.executionSurfaceTabSpecs().map(spec => spec.id)).to.deep.equal([
            'preview', 'files', 'terminal',
        ]);
        expect(ui.executionSurfaceTabSpecs().find(spec => spec.id === 'files')?.icon).to.equal('codicon-files');
        const strip = ui.buildExecutionViewTabStrip('messages', () => undefined);
        expect(Array.from(strip.querySelectorAll<HTMLElement>('.theia-mobile-transcript-tab-icon-select-option[data-tab]')).map(item => item.dataset.tab)).to.deep.equal([
            'preview', 'files', 'terminal',
        ]);
    });

    it('redirects Changes (review) to the Files tab with changes view mode', () => {
        const project: MobileProjectEntry = {
            id: 'p1',
            name: 'Demo',
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent: true,
        };
        const summary = {
            id: 'conv-1',
            cwd: '/tmp/demo',
            agentId: 'task',
            title: 'Build page',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
        };
        const filesHost = document.createElement('div');
        const reviewHost = document.createElement('div');
        const host = createHost({
            transcriptOpenProject: project,
            transcriptOpenSummary: summary,
            transcriptFilesHost: filesHost,
            transcriptReviewHost: reviewHost,
            transcriptLastConv: {
                id: 'conv-1',
                cwd: '/tmp/demo',
                agentId: 'task',
                title: 'Build page',
                status: 'streaming',
                createdAt: 1,
                updatedAt: 2,
                messages: [{
                    id: 'a1',
                    role: 'agent',
                    content: 'Done.',
                    createdAt: 2,
                }],
            },
            projects: [project],
        });
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

        ui.selectTranscriptTab('review', project, summary);

        // 'review' is redirected to 'files' — the tab is stored as 'files'
        // and the files host is shown (not the review host).
        expect(host.executionSurfaceTabByProjectId.get(project.id)).to.equal('files');
        expect(filesHost.hidden).to.equal(false);
        expect(reviewHost.hidden).to.equal(true);
    });

    it('forces the file-tree mode when Files is selected explicitly', () => {
        let requestedMode: string | undefined;
        const host = createHost();
        (host.transcriptSurfacesUi as unknown as {
            ensureTranscriptFilesTab: (_project: MobileProjectEntry, _summary: unknown, mode?: string) => void;
        }).ensureTranscriptFilesTab = (_project, _summary, mode) => {
            requestedMode = mode;
        };
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);
        const project = { id: 'p-files', name: 'Files' } as MobileProjectEntry;
        const summary = {
            id: 'conv-files',
            cwd: '/tmp/files',
            agentId: 'task',
            title: 'Files',
            status: 'idle' as const,
            createdAt: 1,
            updatedAt: 1,
            messageCount: 0,
        };

        ui.selectTranscriptTab('files', project, summary);

        expect(requestedMode).to.equal('files');
    });

    it('routes IDE Changes to the native Source Control view', () => {
        markPreferDesktopIde();
        let changesOpened = 0;
        const project: MobileProjectEntry = {
            id: 'p1',
            name: 'Demo',
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent: true,
        };
        const summary = {
            id: 'conv-1',
            cwd: '/tmp/demo',
            agentId: 'task',
            title: 'Build page',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
        };
        const host = createHost({
            openTranscriptChanges: () => {
                changesOpened += 1;
            },
        });
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

        ui.selectTranscriptTab('review', project, summary);

        expect(changesOpened).to.equal(1);
        expect(host.executionSurfaceTabByProjectId.has(project.id)).to.equal(false);
    });

    it('keeps Chat as the trigger and excludes it from the execution view overflow menu', () => {
        const ui = new MobileProjectsExecutionSurfaceTabsUi(createHost());
        const strip = ui.buildExecutionViewTabStrip('messages', () => undefined);

        const labels = Array.from(strip.querySelectorAll('.theia-mobile-transcript-tab-icon-select-option-label'))
            .map(label => label.textContent);
        expect(labels).to.deep.equal(['Navegador', 'Files', 'Terminal']);
        expect(labels).to.not.include('Editor');
        expect(labels).to.not.include('Changes');

        const chatOption = strip.querySelector<HTMLElement>('.theia-mobile-transcript-tab-icon-select-option[data-tab="messages"]');
        expect(chatOption).to.equal(null);
        const trigger = strip.querySelector<HTMLButtonElement>('.theia-mobile-transcript-tab-icon-select:not(.theia-mobile-transcript-terminal-agent-tui)');
        expect(trigger?.classList.contains('theia-mobile-transcript-tab-icon-select-chat')).to.equal(true);
        expect(trigger?.querySelector('.theia-mobile-transcript-tab-icon-select-symbol')?.classList.contains('qaap-icon-message-circle')).to.equal(true);
        expect(trigger?.querySelector('.theia-mobile-transcript-tab-icon-select-chevron.codicon-chevron-down')).to.not.equal(null);
        expect(trigger?.getAttribute('aria-label')).to.equal('Chat, Change view');
        expect(trigger?.title).to.equal('Chat');
        expect(strip.querySelector('.theia-mobile-transcript-terminal-agent-tui')).to.equal(null);
    });

    it('limits the IDE execution view picker to Preview', () => {
        markPreferDesktopIde();
        try {
            const ui = new MobileProjectsExecutionSurfaceTabsUi(createHost());
            expect(ui.executionSurfaceTabSpecs().map(spec => spec.id)).to.deep.equal(['preview']);
            const strip = ui.buildExecutionViewTabStrip('messages', () => undefined);
            const labels = Array.from(strip.querySelectorAll('.theia-mobile-transcript-tab-icon-select-option-label'))
                .map(label => label.textContent);
            expect(labels).to.deep.equal(['Navegador']);
        } finally {
            clearPreferDesktopIde();
        }
    });

    it('keeps the agent TUI selector in the terminal toolbar, outside the header strip', () => {
        const ui = new MobileProjectsExecutionSurfaceTabsUi(createHost());
        const strip = ui.buildExecutionViewTabStrip('terminal', () => undefined);
        const tuiHost = ui.createTerminalAgentTuiSelect();
        const viewSelect = strip.querySelector('.theia-mobile-transcript-tab-icon-select-host:not(.theia-mobile-transcript-terminal-agent-tui-host)');
        expect(tuiHost).to.exist;
        expect(viewSelect).to.exist;
        expect(strip.querySelector('.theia-mobile-transcript-terminal-agent-tui')).to.equal(null);
        expect(tuiHost.querySelector('.theia-mobile-transcript-terminal-agent-tui')?.classList.contains('theia-mod-selected')).to.equal(false);
        expect(tuiHost.querySelector('.theia-mobile-transcript-terminal-agent-tui')?.getAttribute('data-tab')).to.equal(null);
    });

    it('keeps view-switcher chrome on the Terminal picker, not the agent TUI trigger', () => {
        const host = createHost();
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);
        const strip = ui.buildExecutionViewTabStrip('terminal', () => undefined);
        const toolbar = document.createElement('div');
        toolbar.append(ui.createTerminalAgentTuiSelect());
        (host as unknown as { transcriptTerminalToolbar: HTMLElement }).transcriptTerminalToolbar = toolbar;
        ui.refreshExecutionSurfaceTabStripState(strip, 'terminal');
        const tui = toolbar.querySelector<HTMLButtonElement>('.theia-mobile-transcript-terminal-agent-tui');
        const view = strip.querySelector<HTMLButtonElement>('.theia-mobile-transcript-tab-icon-select:not(.theia-mobile-transcript-terminal-agent-tui)');
        expect(tui?.dataset.tab).to.equal(undefined);
        expect(tui?.classList.contains('theia-mod-selected')).to.equal(false);
        expect(view?.dataset.tab).to.equal('terminal');
        expect(view?.classList.contains('theia-mod-selected')).to.equal(true);
        expect(tui?.dataset.agentId).to.equal('terminal');
    });

    it('lists CLI agents in the TUI menu via Agents Hub shell project', async () => {
        const project: MobileProjectEntry = {
            id: 'p-qaap',
            name: 'qaap',
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent: true,
        };
        const host = createHost({
            agentsHubShellActive: true,
            transcriptOpenProject: undefined,
            expandedId: undefined,
            projectDetailExpandedId: undefined,
            resolveAgentsHubShellProject: () => project,
            stickyComposerAgentsUi: {
                ensureStickyComposerAgentsLoaded: async () => ([
                    { id: 'qaiq', label: 'QAIQ', available: true },
                    { id: 'claude', label: 'Claude Code', available: true },
                    { id: 'codex', label: 'Codex', available: true },
                    { id: 'grok', label: 'Grok Build', available: true },
                ]),
                resolveStickyComposerPinnedAgentId: () => 'qaiq',
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['stickyComposerAgentsUi'],
        });
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);
        expect(ui.resolveExecutionSurfaceProject()?.id).to.equal('p-qaap');

        const tuiHost = ui.createTerminalAgentTuiSelect();
        host.root.append(tuiHost);
        const trigger = tuiHost.querySelector<HTMLButtonElement>('.theia-mobile-transcript-terminal-agent-tui');
        expect(trigger).to.exist;
        trigger!.click();
        await new Promise<void>(resolve => { window.setTimeout(resolve, 0); });

        const menu = host.root.querySelector('.theia-mobile-transcript-terminal-agent-tui-menu');
        expect(menu).to.exist;
        expect(menu!.textContent).to.not.include('Open a project to launch an agent.');
        const labels = Array.from(menu!.querySelectorAll('.theia-mobile-transcript-tab-icon-select-option-label'))
            .map(node => node.textContent);
        expect(labels).to.include.members(['QAIQ', 'Claude Code', 'Codex', 'Grok Build']);
        tuiHost.remove();
        ui.closeExecutionTabOverflowMenu();
    });

    it('keeps the terminal agent menu above an open execution-surface drawer', () => {
        const host = createHost();
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);
        const drawer = document.createElement('section');
        drawer.className = 'theia-mobile-execution-surface-sidebar theia-mod-open';
        const anchor = document.createElement('button');
        drawer.append(anchor);
        host.root.append(drawer);

        expect(ui.resolveExecutionTabOverflowMenuPortal(anchor)).to.equal(drawer);
    });

    it('keeps the composer mounted while a secondary view is open', () => {
        const flushed: Array<string | undefined> = [];
        const host = createHost({
            transcriptComposerSummary: { id: 'conv-42' } as MobileProjectsExecutionSurfaceTabsHost['transcriptComposerSummary'],
            transcriptStickyComposerUi: {
                flushTranscriptComposerDraft: (id?: string) => { flushed.push(id); },
                syncTranscriptComposerQuickActionsVisibility: () => undefined,
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptStickyComposerUi'],
        });
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

        ui.showOnlyExecutionSurfaceTab('review');
        expect(flushed).to.deep.equal([]);

        // Returning to Messages should not trigger another flush (nothing is being torn down).
        ui.showOnlyExecutionSurfaceTab('messages');
        expect(flushed).to.deep.equal([]);
    });

    it('keeps quick-action chips owned by the underlying Chat surface', () => {
        const synced: Array<{ target: unknown; summaryId: string }> = [];
        const host = createHost({
            transcriptComposerSummary: { id: 'conv-7' } as MobileProjectsExecutionSurfaceTabsHost['transcriptComposerSummary'],
            transcriptStickyComposerUi: {
                flushTranscriptComposerDraft: () => undefined,
                syncTranscriptComposerQuickActionsVisibility: (target: HTMLElement, summary: { id: string }) => {
                    synced.push({ target, summaryId: summary.id });
                },
            } as unknown as MobileProjectsExecutionSurfaceTabsHost['transcriptStickyComposerUi'],
        });
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

        // A secondary view does not tear down the underlying composer.
        host.stickyComposerHost.classList.add('theia-mod-show-quick-actions');
        ui.showOnlyExecutionSurfaceTab('files');
        expect(host.stickyComposerHost.classList.contains('theia-mod-show-quick-actions')).to.equal(true);
        expect(synced.length).to.equal(1);

        // Returning to Messages keeps the same conversation-aware ownership.
        ui.showOnlyExecutionSurfaceTab('messages');
        expect(host.stickyComposerHost.classList.contains('theia-mod-show-quick-actions')).to.equal(true);
        expect(synced.length).to.equal(2);
        expect(synced[0].target).to.equal(host.stickyComposerHost);
        expect(synced[0].summaryId).to.equal('conv-7');
    });

    it('keeps quick-action chips when returning to Messages with no conversation yet', () => {
        const host = createHost();
        const ui = new MobileProjectsExecutionSurfaceTabsUi(host);

        ui.showOnlyExecutionSurfaceTab('messages');
        expect(host.stickyComposerHost.classList.contains('theia-mod-show-quick-actions')).to.equal(true);
    });
});
