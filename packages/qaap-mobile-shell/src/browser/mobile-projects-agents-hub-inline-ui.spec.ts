// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { Disposable } from '@theia/core/lib/common/disposable';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
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
        return {
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
            transcriptChatHost: undefined,
            transcriptPlanHost: undefined,
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
            preparedCwdByProjectId: new Map(),
            projectsService: {} as MobileProjectsAgentsHubInlineHost['projectsService'],
            transcriptSheetUi: {} as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
            executionSurfaceTabsUi: {} as MobileProjectsAgentsHubInlineHost['executionSurfaceTabsUi'],
            transcriptComposerUi: {} as MobileProjectsAgentsHubInlineHost['transcriptComposerUi'],
            transcriptStickyComposerUi: {} as MobileProjectsAgentsHubInlineHost['transcriptStickyComposerUi'],
            transcriptHeaderUi: { refreshTranscriptExecutionChrome: () => undefined } as unknown as MobileProjectsAgentsHubInlineHost['transcriptHeaderUi'],
            transcriptLiveUi: {} as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
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
            ...overrides,
        };
    }

    it('shows add-repository onboarding when no project is available', () => {
        const host = createHost();
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.renderAgentsHubExecutionShell();
        expect(host.scroll.querySelector('.theia-mobile-agents-hub-onboarding')).to.not.equal(null);
        expect(host.scroll.querySelector('.theia-mobile-agents-hub-onboarding-btn.theia-mod-primary')).to.not.equal(null);
        expect(host.scroll.textContent).to.include('Add repository');
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
                ensureTranscriptConversationRefresh: () => undefined,
                scheduleTranscriptConversationRefresh: () => undefined,
                refreshOpenTranscriptConversation: async () => undefined,
                stopTranscriptLiveWatch: () => undefined,
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
                    planHost: document.createElement('div'),
                    reviewHost: document.createElement('div'),
                    previewHost: document.createElement('div'),
                    filesHost: document.createElement('div'),
                    terminalHost: document.createElement('div'),
                }),
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
        });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        let renderShellCalls = 0;
        ui.renderAgentsHubExecutionShell = () => {
            renderShellCalls++;
            host.agentsHubShellActive = true;
            const chatHost = document.createElement('div');
            host.agentsHubInlineChatHost = chatHost;
            host.transcriptChatHost = chatHost;
            host.scroll.append(chatHost);
        };
        await ui.openAgentsHubInlineTranscript(project, {
            ...openSummary(),
            status: 'failed',
        });
        expect(renderListCalls).to.equal(0);
        expect(renderShellCalls).to.equal(1);
        expect(host.agentsHubInlineChatHost?.parentElement).to.equal(host.scroll);
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
                ensureTranscriptConversationRefresh: () => undefined,
                scheduleTranscriptConversationRefresh: () => undefined,
                refreshOpenTranscriptConversation: async () => undefined,
                stopTranscriptLiveWatch: () => undefined,
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
                    planHost: document.createElement('div'),
                    reviewHost: document.createElement('div'),
                    previewHost: document.createElement('div'),
                    filesHost: document.createElement('div'),
                    terminalHost: document.createElement('div'),
                }),
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptSheetUi'],
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
                stopTranscriptLiveWatch: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptLiveUi'],
            transcriptUi: {
                disposeList: () => undefined,
            } as unknown as MobileProjectsAgentsHubInlineHost['transcriptUi'],
        });
        const ui = new MobileProjectsAgentsHubInlineUi(host);
        ui.closeAgentsHubSession();
        expect(renderListCalls).to.equal(0);
    });
});
