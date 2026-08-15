// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { ExecutionSurfaceTabId } from '../common/qaap-execution-surface-tabs';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    MobileProjectsAgentsHubInlineUi,
    type MobileProjectsAgentsHubInlineHost,
} from './mobile-projects-agents-hub-inline-ui';

describe('mobile-projects-agents-hub-inline-ui', () => {

    let disableJSDOM: (() => void) | undefined;
    let previousRequestAnimationFrame: typeof requestAnimationFrame | undefined;
    let previousCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    beforeEach(() => {
        previousRequestAnimationFrame = (global as unknown as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
        previousCancelAnimationFrame = (global as unknown as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame;
        const raf = (callback: FrameRequestCallback): number => setTimeout(() => callback(performance.now()), 0) as unknown as number;
        const caf = (handle: number): void => clearTimeout(handle);
        (global as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = raf;
        (global as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = caf;
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = caf;
    });

    afterEach(() => {
        if (previousRequestAnimationFrame) {
            (global as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = previousRequestAnimationFrame;
            window.requestAnimationFrame = previousRequestAnimationFrame;
        }
        if (previousCancelAnimationFrame) {
            (global as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = previousCancelAnimationFrame;
            window.cancelAnimationFrame = previousCancelAnimationFrame;
        }
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function createHost(overrides: Partial<MobileProjectsAgentsHubInlineHost> = {}): MobileProjectsAgentsHubInlineHost {
        const scroll = document.createElement('div');
        const { projectsService: projectsServiceOverride, ...restOverrides } = overrides;
        const base: MobileProjectsAgentsHubInlineHost = {
            homeMode: true,
            hubView: 'tasks',
            visible: true,
            scroll,
            root: document.createElement('div'),
            projects: [],
            tasksFirstLoadPending: false,
            agentsHubLegacyInbox: false,
            agentsHubSelectedProjectId: undefined,
            agentsHubShellActive: false,
            agentsHubInlineActive: false,
            agentsHubInlineChatHost: undefined,
            agentsHubInlineTranscriptRoot: undefined,
            agentsHubInlineExecutionRoot: undefined,
            agentsHubInlineTabStrip: undefined,
            replacingTranscriptSheet: false,
            transcriptOpenSummaryId: undefined,
            transcriptOpenSummary: undefined,
            transcriptOpenProject: undefined,
            transcriptSheet: undefined,
            transcriptTabStrip: undefined,
            sessionsSidebar: undefined,
            transcriptLastStatus: undefined,
            transcriptLastFingerprint: undefined,
            transcriptLastConv: undefined,
            transcriptConversationCache: new Map(),
            transcriptLastSseDeltaAt: undefined,
            transcriptLastStreamProgressAt: undefined,
            transcriptLastSemanticProgressKey: undefined,
            transcriptChatHost: undefined,
            transcriptReviewHost: undefined,
            transcriptPreviewHost: undefined,
            transcriptFilesHost: undefined,
            transcriptTerminalHost: undefined,
            transcriptComposerHost: undefined,
            transcriptComposerProject: undefined,
            transcriptComposerSummary: undefined,
            transcriptComposerMountKey: undefined,
            transcriptComposerContext: [],
            transcriptComposerPinnedAgentId: undefined,
            transcriptComposerAgentModel: undefined,
            transcriptComposerModeId: undefined,
            transcriptComposerApprovalPolicyId: undefined,
            transcriptComposerPrefsConvId: undefined,
            transcriptComposerDraft: '',
            transcriptComposerDraftPersistTimer: undefined,
            transcriptComposerPrefsPersistTimer: undefined,
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptTheiaSessionByConversationId: new Map(),
            transcriptUi: {} as MobileProjectsAgentsHubInlineHost['transcriptUi'],
            tasksHubUi: {} as MobileProjectsAgentsHubInlineHost['tasksHubUi'],
            headerExecutionTabsHost: document.createElement('div'),
            headerPreviewRunHost: document.createElement('div'),
            headerFilesMoreHost: document.createElement('div'),
            headerViewModeSwitchHost: document.createElement('div'),
            preparedCwdByProjectId: new Map(),
            projectsService: {
                resolveCurrentWorkspaceProject: () => undefined,
                getProjectCwd: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['projectsService'],
            transcriptSheetUi: {} as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
            executionSurfaceTabsUi: {} as MobileProjectsAgentsHubInlineHost['executionSurfaceTabsUi'],
            transcriptComposerUi: {} as MobileProjectsAgentsHubInlineHost['transcriptComposerUi'],
            transcriptStickyComposerUi: {} as MobileProjectsAgentsHubInlineHost['transcriptStickyComposerUi'],
            transcriptHeaderUi: { refreshTranscriptExecutionChrome: () => undefined } as unknown as MobileProjectsAgentsHubInlineHost['transcriptHeaderUi'],
            transcriptSurfacesUi: {
                syncHeaderPreviewRunButton: () => undefined,
                hideHeaderPreviewRunButton: () => undefined,
                syncHeaderFilesMoreButton: () => undefined,
                hideHeaderFilesMoreButton: () => undefined,
                syncHeaderViewModeSwitch: () => undefined,
                hideHeaderViewModeSwitch: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSurfacesUi'],
            transcriptLiveUi: {
                clearTranscriptSemanticProgressClock: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptMessagesUi: {} as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
            renderHeader: () => undefined,
            renderSubtitle: () => undefined,
            renderList: () => undefined,
            stickyComposerRenderUi: {} as MobileProjectsAgentsHubInlineHost['stickyComposerRenderUi'],
            detachTranscriptReviewWidget: () => undefined,
            disposeTranscriptEmbeddedPreview: () => undefined,
            notifyWorkspaceHubBottomBarRefresh: () => undefined,
            resolveHomePinnedProject: () => undefined,
            updateTasksAttentionChrome: () => undefined,
            conversationsForProject: () => [],
            conversationIndexUi: {
                conversationsForProject: () => [],
            } as unknown as MobileProjectsAgentsHubInlineHost['conversationIndexUi'],
            onNewClick: async () => undefined,
            onStartNewProject: async () => undefined,
            onOpenLocalWorkspaceFolder: async () => undefined,
        };
        return {
            ...base,
            ...restOverrides,
            projectsService: {
                resolveCurrentWorkspaceProject: () => undefined,
                getProjectCwd: () => undefined,
                ...(projectsServiceOverride as object | undefined),
            } as unknown as MobileProjectsAgentsHubInlineHost['projectsService'],
        };
    }

    it('shows add-repository onboarding when no project is available', () => {
        const host = createHost({ readQaapSignedIn: () => true });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.renderAgentsHubExecutionShell();
        expect(host.scroll.querySelector('.theia-mobile-agents-hub-onboarding')).to.not.equal(null);
        const primaryBtn = host.scroll.querySelector('.theia-mobile-agents-hub-onboarding-btn.theia-mod-primary');
        expect(primaryBtn).to.not.equal(null);
        expect(primaryBtn?.textContent).to.include('Start new project');
        expect(primaryBtn?.querySelector('.codicon-repo')).to.not.equal(null);
        expect(host.scroll.textContent).to.include('Add repository');
        expect(host.scroll.querySelector('.theia-mobile-agents-hub-signin-btn')).to.equal(null);
    });

    it('shows a GitHub sign-in CTA on onboarding when the user is signed out', () => {
        const host = createHost({ readQaapSignedIn: () => false });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.renderAgentsHubExecutionShell();
        const signIn = host.scroll.querySelector('.theia-mobile-agents-hub-signin-btn');
        expect(signIn).to.not.equal(null);
        expect(signIn?.textContent).to.include('Sign in with GitHub');
        expect(host.scroll.querySelector('.theia-mobile-agents-hub-onboarding-btn.theia-mod-primary')).to.equal(signIn);
        expect(host.scroll.textContent).to.include('Start new project');
    });

    const openSummary = (): QaapAgentConversationSummaryDTO => ({
        id: 'conv-open',
        cwd: '/tmp/demo',
        agentId: 'task',
        title: 'Fix login',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 3,
    });

    it('skips full hub list rebuild when transcript overlay is open on any hub view', () => {
        const ui = new MobileProjectsAgentsHubInlineUi(createHost({
            hubView: 'review',
            transcriptSheet: document.createElement('div'),
            transcriptOpenSummaryId: 'conv-open',
            transcriptOpenSummary: openSummary(),
        }));
        expect(ui.shouldSkipFullRenderListOnConversationTick()).to.equal(true);
    });

    it('does not skip hub list rebuild when transcript overlay is closed', () => {
        const ui = new MobileProjectsAgentsHubInlineUi(createHost({
            hubView: 'review',
            transcriptOpenSummaryId: 'conv-open',
            transcriptOpenSummary: openSummary(),
        }));
        expect(ui.shouldSkipFullRenderListOnConversationTick()).to.equal(false);
    });

    it('resolveAgentsHubShellSummary prefers an active project conversation over the idle placeholder', () => {
        const project = {
            id: 'proj-1',
            name: 'demo',
            status: 'working',
            isCurrent: true,
        } as MobileProjectEntry;
        const active = openSummary();
        const ui = new MobileProjectsAgentsHubInlineUi(createHost({
            conversationsForProject: () => [active],
        }));
        expect(ui.resolveAgentsHubShellSummary(project)).to.equal(active);
    });

    it('renderAgentsHubShellChat keeps a streaming summary as working when no full document is cached', () => {
        const project = {
            id: 'proj-1',
            name: 'demo',
            status: 'working',
            isCurrent: true,
        } as MobileProjectEntry;
        let rendered: QaapAgentConversationDTO | undefined;
        const host = createHost({
            transcriptLiveUi: {
                clearTranscriptSemanticProgressClock: () => undefined,
                stopTranscriptLiveWatch: () => undefined,
                peekCachedOpenTranscript: () => undefined,
                applyCachedTranscriptOnOpen: () => false,
                isTrustedOpenTranscriptCache: () => false,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptSheetUi: {
                summaryToTranscriptPlaceholder: (summary: QaapAgentConversationSummaryDTO) => ({
                    id: summary.id,
                    cwd: summary.cwd,
                    agentId: summary.agentId,
                    title: summary.title,
                    status: 'idle',
                    createdAt: summary.createdAt,
                    updatedAt: summary.updatedAt,
                    messages: [],
                }),
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
            transcriptMessagesUi: {
                renderTranscriptMessages: (_host: HTMLElement, conv: QaapAgentConversationDTO) => { rendered = conv; },
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
        });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.renderAgentsHubShellChat(document.createElement('div'), project, openSummary());
        expect(rendered?.id).to.equal('conv-open');
        expect(rendered?.status).to.equal('streaming');
        expect(rendered?.messages).to.deep.equal([]);
    });

    it('skips full hub list rebuild when agents hub execution shell is mounted idle', () => {
        const executionRoot = document.createElement('div');
        const scroll = document.createElement('div');
        scroll.append(executionRoot);
        document.body.append(scroll);
        try {
            const ui = new MobileProjectsAgentsHubInlineUi(createHost({
                hubView: 'tasks',
                homeMode: true,
                agentsHubShellActive: true,
                agentsHubInlineExecutionRoot: executionRoot,
                scroll,
            }));
            expect(ui.shouldSkipFullRenderListOnConversationTick()).to.equal(true);
        } finally {
            scroll.remove();
        }
    });

    it('schedules sidebar refresh instead of immediate rebuild during chrome refresh', () => {
        let scheduleCalls = 0;
        let refreshCalls = 0;
        const ui = new MobileProjectsAgentsHubInlineUi(createHost({
            sessionsSidebar: {
                isVisible: () => true,
                refreshList: () => { refreshCalls++; },
                scheduleRefreshList: () => { scheduleCalls++; },
            },
        }));
        ui.refreshWorkHubConversationChrome();
        expect(scheduleCalls).to.equal(1);
        expect(refreshCalls).to.equal(0);
    });

    it('openAgentsHubInlineTranscript mounts execution shell instead of rebuilding hub list', async () => {
        let renderListCalls = 0;
        let shownTab: string | undefined;
        let mountedTab: string | undefined;
        const project = {
            id: 'proj-1',
            name: 'demo',
            status: 'working',
            isCurrent: true,
        } as MobileProjectEntry;
        const host = createHost({
            projects: [project],
            agentsHubSelectedProjectId: project.id,
            projectsService: {
                getProjectCwd: () => '/tmp/demo',
            } as unknown as MobileProjectsAgentsHubInlineHost['projectsService'],
            renderList: () => { renderListCalls++; },
            executionSurfaceTabsUi: {
                setExecutionSurfaceTab: () => undefined,
                executionSurfaceTabForProject: () => 'terminal',
                showOnlyExecutionSurfaceTab: (tab: ExecutionSurfaceTabId) => { shownTab = tab; },
                mountTranscriptSurfaceTab: (
                    _project: MobileProjectEntry,
                    _summary: QaapAgentConversationSummaryDTO,
                    tab: ExecutionSurfaceTabId,
                ) => { mountedTab = tab; },
                buildTranscriptTabStrip: () => document.createElement('div'),
                refreshExecutionSurfaceTabStripState: () => undefined,
                syncExecutionSurfaceChrome: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['executionSurfaceTabsUi'],
            transcriptComposerUi: {
                refreshTranscriptComposerAgents: async () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptComposerUi'],
            transcriptStickyComposerUi: {
                flushTranscriptComposerDraft: () => undefined,
                flushTranscriptComposerPrefs: async () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptStickyComposerUi'],
            transcriptLiveUi: {
                clearTranscriptSemanticProgressClock: () => undefined,
                ensureTranscriptConversationRefresh: () => undefined,
                scheduleTranscriptConversationRefresh: () => undefined,
                refreshOpenTranscriptConversation: async () => undefined,
                stopTranscriptLiveWatch: () => undefined,
                peekCachedOpenTranscript: () => undefined,
                applyCachedTranscriptOnOpen: () => false,
                isTrustedOpenTranscriptCache: () => false,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptMessagesUi: {
                renderTranscriptMessages: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
            stickyComposerRenderUi: {
                renderStickyComposer: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['stickyComposerRenderUi'],
            transcriptSheetUi: {
                closeTranscriptSheet: () => undefined,
                summaryToTranscriptPlaceholder: (summary: QaapAgentConversationSummaryDTO) => ({
                    id: summary.id,
                    cwd: summary.cwd,
                    agentId: summary.agentId,
                    title: summary.title,
                    status: summary.status,
                    createdAt: summary.createdAt,
                    updatedAt: summary.updatedAt,
                    messages: [],
                }),
                createTranscriptSheetSurfaceHosts: () => ({
                    reviewHost: document.createElement('div'),
                    previewHost: document.createElement('div'),
                    filesHost: document.createElement('div'),
                    terminalHost: document.createElement('div'),
                }),
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
        });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        document.body.append(host.scroll);
        try {
            await ui.openAgentsHubInlineTranscript(project, {
                ...openSummary(),
                status: 'failed',
            });
            expect(renderListCalls).to.equal(0);
            expect(host.agentsHubInlineExecutionRoot?.parentElement).to.equal(host.scroll);
            expect(host.agentsHubInlineChatHost?.isConnected).to.equal(true);
            expect(host.agentsHubInlineExecutionRoot?.contains(host.agentsHubInlineChatHost!)).to.equal(true);
            expect(shownTab).to.equal('messages');
            expect(mountedTab).to.equal('messages');
        } finally {
            host.scroll.remove();
        }
    });

    it('openAgentsHubInlineTranscript reuses the idle execution shell and only swaps conversation data', async () => {
        const project = {
            id: 'proj-1',
            name: 'demo',
            status: 'working',
            isCurrent: true,
        } as MobileProjectEntry;
        let renderedConversationId: string | undefined;
        const host = createHost({
            projects: [project],
            agentsHubSelectedProjectId: project.id,
            projectsService: {
                getProjectCwd: () => '/tmp/demo',
            } as unknown as MobileProjectsAgentsHubInlineHost['projectsService'],
            executionSurfaceTabsUi: {
                setExecutionSurfaceTab: () => undefined,
                executionSurfaceTabForProject: () => 'messages',
                showOnlyExecutionSurfaceTab: () => undefined,
                mountTranscriptSurfaceTab: () => undefined,
                buildTranscriptTabStrip: () => document.createElement('div'),
                refreshExecutionSurfaceTabStripState: () => undefined,
                syncExecutionSurfaceChrome: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['executionSurfaceTabsUi'],
            transcriptComposerUi: {
                refreshTranscriptComposerAgents: async () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptComposerUi'],
            transcriptStickyComposerUi: {
                flushTranscriptComposerDraft: () => undefined,
                flushTranscriptComposerPrefs: async () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptStickyComposerUi'],
            transcriptLiveUi: {
                clearTranscriptSemanticProgressClock: () => undefined,
                ensureTranscriptConversationRefresh: () => undefined,
                scheduleTranscriptConversationRefresh: () => undefined,
                refreshOpenTranscriptConversation: async () => undefined,
                stopTranscriptLiveWatch: () => undefined,
                peekCachedOpenTranscript: () => undefined,
                applyCachedTranscriptOnOpen: () => false,
                isTrustedOpenTranscriptCache: () => false,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptMessagesUi: {
                renderTranscriptMessages: (_host: HTMLElement, conv: QaapAgentConversationDTO) => { renderedConversationId = conv.id; },
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
            stickyComposerRenderUi: {
                renderStickyComposer: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['stickyComposerRenderUi'],
            transcriptSheetUi: {
                closeTranscriptSheet: () => undefined,
                summaryToTranscriptPlaceholder: (summary: QaapAgentConversationSummaryDTO) => ({
                    id: summary.id,
                    cwd: summary.cwd,
                    agentId: summary.agentId,
                    title: summary.title,
                    status: summary.status,
                    createdAt: summary.createdAt,
                    updatedAt: summary.updatedAt,
                    messages: [],
                }),
                createTranscriptSheetSurfaceHosts: () => ({
                    reviewHost: document.createElement('div'),
                    previewHost: document.createElement('div'),
                    filesHost: document.createElement('div'),
                    terminalHost: document.createElement('div'),
                }),
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
        });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        document.body.append(host.scroll);
        try {
            ui.renderAgentsHubExecutionShell();
            const idleRoot = host.agentsHubInlineExecutionRoot;
            const idleChatHost = host.agentsHubInlineChatHost;
            expect(renderedConversationId).to.equal('__qaap_agents_hub_idle__');
            await ui.openAgentsHubInlineTranscript(project, openSummary());
            expect(host.agentsHubInlineExecutionRoot).to.equal(idleRoot);
            expect(host.agentsHubInlineChatHost).to.equal(idleChatHost);
            expect(renderedConversationId).to.equal('conv-open');
        } finally {
            host.scroll.remove();
        }
    });

    it('openAgentsHubInlineTranscript preserves the active execution surface when switching conversations', async () => {
        const project = {
            id: 'proj-1',
            name: 'demo',
            status: 'working',
            isCurrent: true,
        } as MobileProjectEntry;
        const executionRoot = document.createElement('div');
        const chatHost = document.createElement('div');
        executionRoot.append(chatHost);
        document.body.append(executionRoot);
        let shownTab: string | undefined;
        let mountedTab: string | undefined;
        try {
            const host = createHost({
                projects: [project],
                agentsHubInlineActive: true,
                agentsHubShellActive: true,
                transcriptOpenSummaryId: 'conv-old',
                transcriptOpenSummary: { ...openSummary(), id: 'conv-old' },
                transcriptOpenProject: project,
                agentsHubInlineExecutionRoot: executionRoot,
                agentsHubInlineChatHost: chatHost,
                transcriptChatHost: chatHost,
                executionSurfaceTabsUi: {
                    closeExecutionTabOverflowMenu: () => undefined,
                    executionSurfaceTabForProject: () => 'preview',
                    setExecutionSurfaceTab: () => undefined,
                    showOnlyExecutionSurfaceTab: (tab: ExecutionSurfaceTabId) => { shownTab = tab; },
                    mountTranscriptSurfaceTab: (
                        _project: MobileProjectEntry,
                        _summary: QaapAgentConversationSummaryDTO,
                        tab: ExecutionSurfaceTabId,
                    ) => { mountedTab = tab; },
                    buildTranscriptTabStrip: () => document.createElement('div'),
                    refreshExecutionSurfaceTabStripState: () => undefined,
                    syncExecutionSurfaceChrome: () => undefined,
                } as unknown as MobileProjectsAgentsHubInlineHost['executionSurfaceTabsUi'],
                transcriptComposerUi: {
                    closeTranscriptComposerSheets: () => undefined,
                    refreshTranscriptComposerAgents: async () => undefined,
                } as unknown as MobileProjectsAgentsHubInlineHost['transcriptComposerUi'],
                transcriptStickyComposerUi: {
                    flushTranscriptComposerDraft: () => undefined,
                    flushTranscriptComposerPrefs: async () => undefined,
                } as unknown as MobileProjectsAgentsHubInlineHost['transcriptStickyComposerUi'],
                transcriptLiveUi: {
                    clearTranscriptSemanticProgressClock: () => undefined,
                    ensureTranscriptConversationRefresh: () => undefined,
                    stopTranscriptLiveWatch: () => undefined,
                    scheduleTranscriptConversationRefresh: () => undefined,
                    refreshOpenTranscriptConversation: async () => undefined,
                    peekCachedOpenTranscript: () => undefined,
                    applyCachedTranscriptOnOpen: () => false,
                    isTrustedOpenTranscriptCache: () => false,
                } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
                transcriptMessagesUi: {
                    renderTranscriptMessages: () => undefined,
                } as unknown as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
                transcriptSheetUi: {
                    closeTranscriptSheet: () => undefined,
                    summaryToTranscriptPlaceholder: (summary: QaapAgentConversationSummaryDTO) => ({
                        id: summary.id,
                        cwd: summary.cwd,
                        agentId: summary.agentId,
                        title: summary.title,
                        status: summary.status,
                        createdAt: summary.createdAt,
                        updatedAt: summary.updatedAt,
                        messages: [],
                    }),
                } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
                stickyComposerRenderUi: {
                    renderStickyComposer: () => undefined,
                } as unknown as MobileProjectsAgentsHubInlineHost['stickyComposerRenderUi'],
                transcriptUi: {
                    disposeList: () => undefined,
                } as unknown as MobileProjectsAgentsHubInlineHost['transcriptUi'],
            });
            const ui = new MobileProjectsAgentsHubInlineUi(host);
            ui.syncAgentsHubInlineExecutionHeader = () => undefined;
            await ui.openAgentsHubInlineTranscript(project, { ...openSummary(), id: 'conv-new' });
            expect(shownTab).to.equal('messages');
            expect(mountedTab).to.equal('messages');
        } finally {
            executionRoot.remove();
        }
    });

    it('reopens an inline transcript from the conversation cache instead of preview text', async () => {
        let rendered: QaapAgentConversationSummaryDTO | import('../common/qaap-agent-conversation-client').QaapAgentConversationDTO | undefined;
        const project = {
            id: 'proj-1',
            name: 'demo',
            status: 'working',
            isCurrent: true,
        } as MobileProjectEntry;
        const cached = {
            id: 'conv-open',
            cwd: '/tmp/demo',
            agentId: 'task',
            title: 'Fix login',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 3,
            messages: [{
                id: 'agent-1',
                role: 'agent' as const,
                content: '',
                createdAt: 2,
                segments: [{
                    type: 'thinking' as const,
                    content: 'Exploring the project',
                    startedAt: 2,
                    finishedAt: undefined,
                }],
            }],
        };
        const host = createHost({
            projects: [project],
            agentsHubInlineExecutionRoot: document.createElement('div'),
            agentsHubInlineChatHost: document.createElement('div'),
            transcriptConversationCache: new Map([[cached.id, cached]]),
            transcriptMessagesUi: {
                renderTranscriptMessages: (_host: HTMLElement, conv: typeof cached) => { rendered = conv; },
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
            executionSurfaceTabsUi: {
                setExecutionSurfaceTab: () => undefined,
                executionSurfaceTabForProject: () => 'messages',
                showOnlyExecutionSurfaceTab: () => undefined,
                mountTranscriptSurfaceTab: () => undefined,
                buildTranscriptTabStrip: () => document.createElement('div'),
                refreshExecutionSurfaceTabStripState: () => undefined,
                syncExecutionSurfaceChrome: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['executionSurfaceTabsUi'],
            transcriptComposerUi: {
                refreshTranscriptComposerAgents: async () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptComposerUi'],
            transcriptStickyComposerUi: {
                flushTranscriptComposerDraft: () => undefined,
                flushTranscriptComposerPrefs: async () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptStickyComposerUi'],
            transcriptLiveUi: {
                clearTranscriptSemanticProgressClock: () => undefined,
                ensureTranscriptConversationRefresh: () => undefined,
                scheduleTranscriptConversationRefresh: () => undefined,
                refreshOpenTranscriptConversation: async () => undefined,
                stopTranscriptLiveWatch: () => undefined,
                peekCachedOpenTranscript: () => undefined,
                applyCachedTranscriptOnOpen: () => false,
                isTrustedOpenTranscriptCache: () => true,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptSheetUi: {
                closeTranscriptSheet: () => undefined,
                summaryToTranscriptPlaceholder: (summary: QaapAgentConversationSummaryDTO) => ({
                    id: summary.id,
                    cwd: summary.cwd,
                    agentId: summary.agentId,
                    title: summary.title,
                    status: summary.status,
                    createdAt: summary.createdAt,
                    updatedAt: summary.updatedAt,
                    messages: [{
                        id: 'preview',
                        role: 'agent',
                        content: summary.lastMessagePreview ?? '',
                        createdAt: summary.updatedAt,
                    }],
                }),
                createTranscriptSheetSurfaceHosts: () => ({
                    reviewHost: document.createElement('div'),
                    previewHost: document.createElement('div'),
                    filesHost: document.createElement('div'),
                    terminalHost: document.createElement('div'),
                }),
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
            // Cache reopen path — trust the full document from transcriptConversationCache.
            stickyComposerRenderUi: {
                renderStickyComposer: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['stickyComposerRenderUi'],
        });
        host.agentsHubInlineExecutionRoot!.append(host.agentsHubInlineChatHost!);
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.syncAgentsHubInlineExecutionHeader = () => undefined;
        await ui.openAgentsHubInlineTranscript(project, {
            ...openSummary(),
            lastMessageRole: 'agent',
            lastMessagePreview: 'Let me explore. [thinking] raw preview must not render',
        });

        expect(rendered).to.equal(cached);
    });

    it('openAgentsHubInlineTranscript no-ops when the same inline transcript is already open', async () => {
        let stopLiveWatchCalls = 0;
        let renderMessagesCalls = 0;
        let renderShellCalls = 0;
        const project = {
            id: 'proj-1',
            name: 'demo',
            status: 'working',
            isCurrent: true,
        } as MobileProjectEntry;
        const summary = openSummary();
        const executionRoot = document.createElement('div');
        const chatHost = document.createElement('div');
        chatHost.textContent = 'stable transcript';
        executionRoot.append(chatHost);
        document.body.append(executionRoot);
        try {
            const host = createHost({
                projects: [project],
                agentsHubInlineActive: true,
                agentsHubShellActive: true,
                transcriptOpenSummaryId: summary.id,
                transcriptOpenSummary: summary,
                transcriptOpenProject: project,
                agentsHubInlineExecutionRoot: executionRoot,
                agentsHubInlineChatHost: chatHost,
                transcriptLiveUi: {
                    clearTranscriptSemanticProgressClock: () => undefined,
                    stopTranscriptLiveWatch: () => { stopLiveWatchCalls++; },
                    peekCachedOpenTranscript: () => undefined,
                    applyCachedTranscriptOnOpen: () => false,
                    isTrustedOpenTranscriptCache: () => false,
                } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
                transcriptMessagesUi: {
                    renderTranscriptMessages: () => { renderMessagesCalls++; },
                } as unknown as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
            });
            const ui = new MobileProjectsAgentsHubInlineUi(host);
            const originalRenderShell = ui.renderAgentsHubExecutionShell.bind(ui);
            ui.renderAgentsHubExecutionShell = () => {
                renderShellCalls++;
                originalRenderShell();
            };
            await ui.openAgentsHubInlineTranscript(project, summary);
            expect(stopLiveWatchCalls).to.equal(0);
            expect(renderMessagesCalls).to.equal(0);
            expect(renderShellCalls).to.equal(0);
            expect(chatHost.textContent).to.equal('stable transcript');
        } finally {
            executionRoot.remove();
        }
    });

    it('closeAgentsHubSession skips hub list rebuild while switching inline transcripts', () => {
        let renderListCalls = 0;
        const host = createHost({
            replacingTranscriptSheet: true,
            agentsHubInlineActive: true,
            agentsHubShellActive: true,
            transcriptOpenSummaryId: 'conv-a',
            agentsHubInlineChatHost: document.createElement('div'),
            renderList: () => { renderListCalls++; },
            executionSurfaceTabsUi: {
                closeExecutionTabOverflowMenu: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['executionSurfaceTabsUi'],
            transcriptComposerUi: {
                closeTranscriptComposerSheets: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptComposerUi'],
            transcriptLiveUi: {
                clearTranscriptSemanticProgressClock: () => undefined,
                stopTranscriptLiveWatch: () => undefined,
                peekCachedOpenTranscript: () => undefined,
                applyCachedTranscriptOnOpen: () => false,
                isTrustedOpenTranscriptCache: () => false,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptUi: {
                disposeList: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptUi'],
        });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.closeAgentsHubSession();
        expect(renderListCalls).to.equal(0);
    });

    it('resetAgentsHubIdleTranscriptShell clears idle cache and re-renders empty chat', () => {
        const project = { id: 'proj-1', name: 'qaap' } as MobileProjectEntry;
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);
        let rendered = false;
        const host = createHost({
            agentsHubShellActive: true,
            agentsHubInlineChatHost: chatHost,
            transcriptLastConv: {
                id: '__qaap_agents_hub_idle__',
                cwd: '/workspace',
                agentId: 'codex',
                status: 'streaming',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: [{ id: 'u1', role: 'user', content: 'hello', createdAt: Date.now() }],
            } as MobileProjectsAgentsHubInlineHost['transcriptLastConv'],
            transcriptConversationCache: new Map([
                ['__qaap_agents_hub_idle__', {
                    id: '__qaap_agents_hub_idle__',
                    cwd: '/workspace',
                    agentId: 'codex',
                    status: 'streaming',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    messages: [{ id: 'u1', role: 'user', content: 'hello', createdAt: Date.now() }],
                } as NonNullable<MobileProjectsAgentsHubInlineHost['transcriptLastConv']>],
            ]),
            projectsService: {
                getProjectCwd: () => '/workspace',
            } as unknown as MobileProjectsAgentsHubInlineHost['projectsService'],
            transcriptSheetUi: {
                summaryToTranscriptPlaceholder: (summary: QaapAgentConversationSummaryDTO) => ({
                    id: summary.id,
                    cwd: summary.cwd,
                    agentId: summary.agentId,
                    title: summary.title,
                    status: summary.status,
                    createdAt: summary.createdAt,
                    updatedAt: summary.updatedAt,
                    messages: [],
                }),
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
            transcriptLiveUi: {
                clearTranscriptSemanticProgressClock: () => undefined,
                stopTranscriptLiveWatch: () => undefined,
                peekCachedOpenTranscript: () => undefined,
                applyCachedTranscriptOnOpen: () => false,
                isTrustedOpenTranscriptCache: () => false,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptUi: {
                disposeList: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptUi'],
            transcriptMessagesUi: {
                renderTranscriptMessages: () => { rendered = true; },
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptMessagesUi'],
        });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.resetAgentsHubIdleTranscriptShell(project);
        expect(host.transcriptLastConv).to.equal(undefined);
        expect(host.transcriptConversationCache.has('__qaap_agents_hub_idle__')).to.equal(false);
        expect(rendered).to.equal(true);
    });
});
