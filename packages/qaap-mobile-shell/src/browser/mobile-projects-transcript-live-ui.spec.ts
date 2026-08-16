// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { Event as TheiaEvent } from '@theia/core/lib/common/event';
import type { QaapAgentApprovalRequestDTO } from '../common/qaap-agent-approval-client';
import type { QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';
import {
    enableTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
    resetTranscriptRenderMetrics,
} from '../common/qaap-transcript-render-metrics';
import { TRANSCRIPT_TOOL_USE_ID_ATTR } from '../common/qaap-transcript-incremental-update';
import { QaapThreadStore } from '../common/qaap-thread-store';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS } from './qaap-transcript-inline-approval-ui';
import { MobileProjectsTranscriptLiveUi, type MobileProjectsTranscriptLiveHost } from './mobile-projects-transcript-live-ui';

describe('MobileProjectsTranscriptLiveUi', () => {

    beforeEach(() => {
        if (typeof HTMLElement === 'undefined') {
            enableJSDOM();
        }
        if (!HTMLElement.prototype.scrollIntoView) {
            HTMLElement.prototype.scrollIntoView = () => undefined;
        }
        enableTranscriptRenderMetrics(true);
        resetTranscriptRenderMetrics();
    });

    afterEach(() => {
        resetTranscriptRenderMetrics();
        enableTranscriptRenderMetrics(false);
    });

    function approval(): QaapAgentApprovalRequestDTO {
        return {
            id: 'approval-1',
            conversationId: 'conv-approval',
            cwd: '/repo',
            agentId: 'codex',
            conversationTitle: 'Approval',
            kind: 'tool',
            toolName: 'Shell',
            toolUseId: 'tool-1',
            summary: 'Run test command',
            createdAt: 10,
        };
    }

    function conversation(): QaapAgentConversationDTO {
        return {
            id: 'conv-approval',
            cwd: '/repo',
            agentId: 'codex',
            title: 'Approval',
            status: 'streaming',
            autoApprove: false,
            createdAt: 1,
            updatedAt: 10,
            messages: [{
                id: 'agent-1',
                role: 'agent',
                content: '',
                createdAt: 5,
                segments: [{
                    type: 'tool',
                    name: 'Shell',
                    toolUseId: 'tool-1',
                    args: '{"cmd":"npm test"}',
                    finished: false,
                }],
            }],
        };
    }

    function createHost(chatHost: HTMLElement, composerHost: HTMLElement): MobileProjectsTranscriptLiveHost {
        return {
            transcriptOpenSummaryId: 'conv-approval',
            transcriptOpenSummary: undefined,
            transcriptOpenProject: undefined,
            transcriptLastConv: undefined,
            transcriptConversationCache: new Map(),
            transcriptLastFingerprint: undefined,
            transcriptLastStreamProgressAt: undefined,
            transcriptLastSemanticProgressKey: undefined,
            transcriptLastTransportEventAt: undefined,
            transcriptLastSseDeltaAt: undefined,
            transcriptLastStatus: undefined,
            transcriptScheduleRefresh: undefined,
            transcriptSheet: chatHost,
            agentsHubInlineActive: false,
            transcriptChatHost: chatHost,
            agentsHubInlineChatHost: undefined,
            transcriptComposerSummary: undefined,
            transcriptComposerHost: composerHost,
            transcriptComposerPrefsConvId: undefined,
            transcriptComposerSendRefresh: undefined,
            transcriptPreviewRequestPending: false,
            transcriptPreviewRequestRunning: false,
            transcriptPreviewSuppressedByUser: false,
            transcriptApprovalRefreshTimer: undefined,
            cachedAgentApprovals: [approval()],
            projectsService: {} as MobileProjectsTranscriptLiveHost['projectsService'],
            conversations: undefined,
            transcriptMessagesUi: {
                createTranscriptToolApprovalActions: () => {
                    const card = document.createElement('div');
                    card.className = `${TRANSCRIPT_APPROVAL_CARD_CLASS} theia-mod-inline`;
                    return card;
                },
            } as unknown as MobileProjectsTranscriptLiveHost['transcriptMessagesUi'],
            transcriptUi: {} as MobileProjectsTranscriptLiveHost['transcriptUi'],
            transcriptStickyComposerUi: {} as MobileProjectsTranscriptLiveHost['transcriptStickyComposerUi'],
            transcriptHeaderUi: {} as MobileProjectsTranscriptLiveHost['transcriptHeaderUi'],
            executionSurfaceTabsUi: {} as MobileProjectsTranscriptLiveHost['executionSurfaceTabsUi'],
            conversationsForProject: () => [],
            findConversationSummaryById: () => undefined,
            conversationsOnDidChange: TheiaEvent.None,
            syncTranscriptPreviewFromConversation: async () => undefined,
            beginTranscriptDevPreviewRequest: () => undefined,
            stageTranscriptPreviewReadyUrl: () => undefined,
            handleTranscriptStatusForAutoVerify: () => undefined,
            isPendingNewChatSummary: () => false,
            ensureTranscriptConversationRefresh: () => undefined,
            conversationIndexUi: {} as MobileProjectsTranscriptLiveHost['conversationIndexUi'],
            getChatServiceConversation: async () => undefined,
        };
    }

    it('skips approval DOM reconciliation when the pending approval did not change', () => {
        const chatHost = document.createElement('div');
        const tool = document.createElement('details');
        tool.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, 'tool-1');
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-tool-pill-body';
        const existingCard = document.createElement('div');
        existingCard.className = `${TRANSCRIPT_APPROVAL_CARD_CLASS} theia-mod-inline`;
        body.append(existingCard);
        tool.append(body);
        chatHost.append(tool);
        document.body.append(chatHost);

        const composerHost = document.createElement('div');
        const column = document.createElement('div');
        column.className = 'theia-mobile-projects-sticky-composer-column';
        composerHost.append(column);
        document.body.append(composerHost);

        const liveUi = new MobileProjectsTranscriptLiveUi(createHost(chatHost, composerHost));
        liveUi.syncTranscriptPendingApproval(conversation());
        const mountedBar = composerHost.querySelector(`.${TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS}`);
        expect(mountedBar).to.not.equal(null);

        liveUi.syncTranscriptPendingApproval(conversation());
        const metrics = getTranscriptRenderMetricsSnapshot();
        expect(metrics.approval_sync).to.equal(1);
        expect(metrics.approval_sync_skipped).to.equal(1);
        expect(tool.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`)).to.equal(existingCard);
        expect(composerHost.querySelector(`.${TRANSCRIPT_PENDING_APPROVAL_HOST_CLASS}`)).to.equal(mountedBar);
    });

    it('visual verification poll force-refreshes once pending clears', async () => {
        const chatHost = document.createElement('div');
        const composerHost = document.createElement('div');
        document.body.append(chatHost, composerHost);
        const host = createHost(chatHost, composerHost);
        host.transcriptOpenSummaryId = 'conv-visual';
        host.transcriptOpenSummary = {
            id: 'conv-visual',
            cwd: '/repo',
            agentId: 'codex',
            title: 'Visual',
            status: 'idle',
            createdAt: 1,
            updatedAt: 10,
            messageCount: 1,
            visualVerificationPending: true,
        };
        host.transcriptLastConv = {
            id: 'conv-visual',
            cwd: '/repo',
            agentId: 'codex',
            title: 'Visual',
            status: 'idle',
            createdAt: 1,
            updatedAt: 10,
            messages: [{
                id: 'agent-1',
                role: 'agent',
                content: 'Done.\n\n[QAAP capture]',
                createdAt: 5,
            }],
        };

        let forcePollCalls = 0;
        const liveUi = new MobileProjectsTranscriptLiveUi(host);
        const liveUiAny = liveUi as unknown as {
            refreshOpenTranscriptConversation: (options?: { forcePoll?: boolean }) => Promise<void>;
            isWatchingOpenTranscript: (id: string) => boolean;
            scheduleTranscriptVisualVerificationPoll: (id: string) => void;
            stopTranscriptVisualVerificationPoll: () => void;
        };
        liveUiAny.refreshOpenTranscriptConversation = async options => {
            if (options?.forcePoll) {
                forcePollCalls += 1;
            }
        };
        liveUiAny.isWatchingOpenTranscript = () => true;

        const queued: Array<() => void> = [];
        const realSetTimeout = window.setTimeout.bind(window);
        const realClearTimeout = window.clearTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler) => {
            if (typeof handler === 'function') {
                queued.push(handler as () => void);
            }
            return 99 as unknown as number;
        }) as typeof setTimeout;
        window.clearTimeout = (() => undefined) as typeof clearTimeout;

        try {
            liveUiAny.scheduleTranscriptVisualVerificationPoll('conv-visual');
            expect(queued).to.have.length(1);

            host.transcriptOpenSummary = {
                ...host.transcriptOpenSummary!,
                visualVerificationPending: undefined,
                updatedAt: 11,
            };
            queued[0]!();
            await Promise.resolve();
            expect(forcePollCalls).to.equal(1);
        } finally {
            window.setTimeout = realSetTimeout as typeof setTimeout;
            window.clearTimeout = realClearTimeout as typeof clearTimeout;
            liveUiAny.stopTranscriptVisualVerificationPoll();
            chatHost.remove();
            composerHost.remove();
        }
    });

    it('summary subscriber re-arms the refresh when visualVerificationPending flips, without pinning a stale flag', () => {
        const chatHost = document.createElement('div');
        const composerHost = document.createElement('div');
        document.body.append(chatHost, composerHost);
        const host = createHost(chatHost, composerHost);
        host.transcriptOpenSummaryId = 'conv-visual';
        host.transcriptOpenSummary = {
            id: 'conv-visual',
            cwd: '/repo',
            agentId: 'codex',
            title: 'Visual',
            status: 'idle',
            createdAt: 1,
            updatedAt: 10,
            messageCount: 1,
        };
        const threadStore = new QaapThreadStore();
        host.conversations = { threadStore } as unknown as MobileProjectsTranscriptLiveHost['conversations'];

        let ensureCalls = 0;
        const liveUi = new MobileProjectsTranscriptLiveUi(host);
        const liveUiAny = liveUi as unknown as {
            bindOpenTranscriptThreadStore: (id: string) => void;
            ensureTranscriptConversationRefresh: () => void;
        };
        liveUiAny.ensureTranscriptConversationRefresh = () => { ensureCalls += 1; };
        liveUiAny.bindOpenTranscriptThreadStore('conv-visual');

        // Capture requested → pending true: refresh armed exactly once.
        threadStore.upsertSummary({ ...host.transcriptOpenSummary!, updatedAt: 11, visualVerificationPending: true });
        expect(host.transcriptOpenSummary!.visualVerificationPending).to.equal(true);
        expect(ensureCalls).to.equal(1);

        // Evidence landed → the fresh summary OMITS the flag; the merge must clear it (not pin true)
        // and re-arm the refresh so the "Processing…" skeleton swaps to the screenshot in place.
        threadStore.upsertSummary({ ...host.transcriptOpenSummary!, updatedAt: 12, visualVerificationPending: undefined });
        expect(host.transcriptOpenSummary!.visualVerificationPending).to.equal(undefined);
        expect(ensureCalls).to.equal(2);

        chatHost.remove();
        composerHost.remove();
    });

    it('onTranscriptUserMessageSubmitted sets preview pending without switching execution tab', () => {
        const chatHost = document.createElement('div');
        const composerHost = document.createElement('div');
        document.body.append(chatHost, composerHost);
        let activeTab: 'messages' | 'preview' = 'messages';
        const setExecutionSurfaceTabCalls: Array<'messages' | 'preview'> = [];
        const showOnlyExecutionSurfaceTabCalls: Array<'messages' | 'preview'> = [];
        let beginPreviewCalls = 0;
        const host = createHost(chatHost, composerHost);
        host.transcriptOpenSummaryId = 'conv-preview';
        host.transcriptOpenProject = {
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
        host.transcriptOpenSummary = {
            id: 'conv-preview',
            cwd: '/tmp/demo',
            agentId: 'codex',
            title: 'Preview',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        };
        host.executionSurfaceTabsUi = {
            executionSurfaceTabForProject: () => activeTab,
            activeExecutionTab: () => activeTab,
            setExecutionSurfaceTab: (_project: unknown, tab: 'messages' | 'preview') => {
                setExecutionSurfaceTabCalls.push(tab);
                activeTab = tab;
            },
            showOnlyExecutionSurfaceTab: (tab: 'messages' | 'preview') => {
                showOnlyExecutionSurfaceTabCalls.push(tab);
                activeTab = tab;
            },
        } as unknown as MobileProjectsTranscriptLiveHost['executionSurfaceTabsUi'];
        host.beginTranscriptDevPreviewRequest = () => {
            beginPreviewCalls += 1;
        };
        const conv = {
            id: 'conv-preview',
            cwd: '/tmp/demo',
            agentId: 'codex',
            title: 'Preview',
            status: 'streaming' as const,
            createdAt: 1,
            updatedAt: 2,
            messages: [],
        };
        const liveUi = new MobileProjectsTranscriptLiveUi(host);
        const liveUiAny = liveUi as unknown as {
            ensureTranscriptDevPreviewWatch: () => void;
        };
        liveUiAny.ensureTranscriptDevPreviewWatch = () => undefined;

        liveUi.onTranscriptUserMessageSubmitted(
            'Figure out how to build and run this project locally. Start the dev server, confirm it boots cleanly, and report the URL plus any setup steps I should know.',
            conv,
        );

        expect(host.transcriptPreviewRequestPending).to.equal(true);
        expect(beginPreviewCalls).to.equal(1);
        expect(setExecutionSurfaceTabCalls).to.not.include('preview');
        expect(showOnlyExecutionSurfaceTabCalls).to.not.include('preview');
        expect(activeTab).to.equal('messages');

        chatHost.remove();
        composerHost.remove();
    });

    it('openReadyTranscriptPreviewUrl switches to Preview when the user asked to run the app', async () => {
        const chatHost = document.createElement('div');
        const composerHost = document.createElement('div');
        document.body.append(chatHost, composerHost);
        const host = createHost(chatHost, composerHost);
        const project = { id: 'vitesse-lite', name: 'vitesse-lite', status: 'working' } as import('./mobile-projects-types').MobileProjectEntry;
        const summary = {
            id: 'conv-preview',
            cwd: '/tmp/vitesse-lite',
            agentId: 'qaiq',
            title: 'Preview',
            status: 'idle' as const,
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        };
        host.transcriptOpenProject = project;
        host.transcriptOpenSummary = summary;
        host.transcriptOpenSummaryId = summary.id;
        const selected: string[] = [];
        let stagedUrl: string | undefined;
        host.stageTranscriptPreviewReadyUrl = (url: string) => { stagedUrl = url; };
        host.executionSurfaceTabsUi = {
            selectTranscriptTab: (tab: string) => { selected.push(tab); },
        } as unknown as MobileProjectsTranscriptLiveHost['executionSurfaceTabsUi'];
        const conv: QaapAgentConversationDTO = {
            id: summary.id,
            cwd: summary.cwd,
            agentId: summary.agentId,
            title: summary.title,
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'u1',
                role: 'user',
                content: 'Levanta la app y abre la preview.',
                createdAt: 1,
            }],
        };
        const liveUi = new MobileProjectsTranscriptLiveUi(host);
        await (liveUi as unknown as {
            openReadyTranscriptPreviewUrl: (url: string, conversation: QaapAgentConversationDTO) => Promise<void>;
        }).openReadyTranscriptPreviewUrl('http://127.0.0.1:5173/', conv);

        expect(stagedUrl).to.contain('5173');
        expect(selected).to.deep.equal(['preview']);
        expect(host.transcriptOpenProject?.previewUrl).to.contain('5173');

        chatHost.remove();
        composerHost.remove();
    });

    it('openReadyTranscriptPreviewUrl only stages the pill when the user never asked for preview', async () => {
        const chatHost = document.createElement('div');
        const composerHost = document.createElement('div');
        document.body.append(chatHost, composerHost);
        const host = createHost(chatHost, composerHost);
        host.transcriptOpenProject = { id: 'json-server', name: 'json-server', status: 'working' } as import('./mobile-projects-types').MobileProjectEntry;
        host.transcriptOpenSummary = {
            id: 'conv-silent',
            cwd: '/tmp/json-server',
            agentId: 'qaiq',
            title: 'Silent',
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
        };
        const selected: string[] = [];
        host.executionSurfaceTabsUi = {
            selectTranscriptTab: (tab: string) => { selected.push(tab); },
        } as unknown as MobileProjectsTranscriptLiveHost['executionSurfaceTabsUi'];
        const conv: QaapAgentConversationDTO = {
            id: 'conv-silent',
            cwd: '/tmp/json-server',
            agentId: 'qaiq',
            title: 'Silent',
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messages: [{
                id: 'a1',
                role: 'agent',
                content: 'Dev server running at http://localhost:3000/',
                createdAt: 2,
            }],
        };
        const liveUi = new MobileProjectsTranscriptLiveUi(host);
        await (liveUi as unknown as {
            openReadyTranscriptPreviewUrl: (url: string, conversation: QaapAgentConversationDTO) => Promise<void>;
        }).openReadyTranscriptPreviewUrl('http://127.0.0.1:3000/', conv);

        expect(selected).to.deep.equal([]);

        chatHost.remove();
        composerHost.remove();
    });
});
