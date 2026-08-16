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
            transcriptHeaderSubtitle: undefined,
            transcriptOpenSummary: undefined,
            transcriptOpenProject: undefined,
            transcriptLastConv: undefined,
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
            expect(transcriptRoot.hidden).to.equal(true);
            expect(executionRoot.getAttribute('data-active-surface')).to.equal('terminal');
        } finally {
            executionRoot.remove();
        }
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

    it('shows Chat first and excludes Editor and Changes from the execution view overflow menu', () => {
        const ui = new MobileProjectsExecutionSurfaceTabsUi(createHost());
        const strip = ui.buildExecutionViewTabStrip('messages', () => undefined);

        const labels = Array.from(strip.querySelectorAll('.theia-mobile-transcript-tab-icon-select-option-label'))
            .map(label => label.textContent);
        expect(labels).to.include.members(['Chat', 'Preview', 'Files', 'Terminal']);
        expect(labels).to.not.include('Editor');
        expect(labels).to.not.include('Changes');
        expect(labels[0]).to.equal('Chat');

        const chatOption = strip.querySelector<HTMLElement>('.theia-mobile-transcript-tab-icon-select-option[data-tab="messages"]');
        expect(chatOption?.querySelector('.qaap-icon-message-circle')).to.exist;
        const trigger = strip.querySelector<HTMLButtonElement>('.theia-mobile-transcript-tab-icon-select:not(.theia-mobile-transcript-terminal-agent-tui)');
        expect(trigger?.querySelector('.theia-mobile-transcript-tab-icon-select-symbol')?.classList.contains('qaap-icon-message-circle')).to.equal(true);
        expect(trigger?.querySelector('.theia-mobile-transcript-tab-icon-select-chevron.codicon-chevron-down')).to.not.equal(null);
        expect(trigger?.getAttribute('aria-label')).to.equal('Chat, Change view');
        expect(trigger?.title).to.equal('Chat');
        expect(strip.querySelector('.theia-mobile-transcript-terminal-agent-tui')).to.equal(null);
    });

    it('limits the IDE execution view picker to Chat and Preview', () => {
        markPreferDesktopIde();
        try {
            const ui = new MobileProjectsExecutionSurfaceTabsUi(createHost());
            expect(ui.executionSurfaceTabSpecs().map(spec => spec.id)).to.deep.equal(['preview']);
            const strip = ui.buildExecutionViewTabStrip('messages', () => undefined);
            const labels = Array.from(strip.querySelectorAll('.theia-mobile-transcript-tab-icon-select-option-label'))
                .map(label => label.textContent);
            expect(labels).to.deep.equal(['Chat', 'Preview']);
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

    it('flushes the composer draft before clearing the composer when leaving Messages', () => {
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
        expect(flushed).to.deep.equal(['conv-42']);
        expect(host.stickyComposerHost.childElementCount).to.equal(0);

        // Returning to Messages should not trigger another flush (nothing is being torn down).
        ui.showOnlyExecutionSurfaceTab('messages');
        expect(flushed).to.deep.equal(['conv-42']);
    });

    it('re-derives quick-action chips from the conversation instead of force-showing them on Messages', () => {
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

        // Leaving Messages always hides the chips.
        host.stickyComposerHost.classList.add('theia-mod-show-quick-actions');
        ui.showOnlyExecutionSurfaceTab('files');
        expect(host.stickyComposerHost.classList.contains('theia-mod-show-quick-actions')).to.equal(false);
        expect(synced).to.deep.equal([]);

        // Returning to Messages delegates to the conversation-aware sync instead of force-adding the class.
        ui.showOnlyExecutionSurfaceTab('messages');
        expect(host.stickyComposerHost.classList.contains('theia-mod-show-quick-actions')).to.equal(false);
        expect(synced.length).to.equal(1);
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
