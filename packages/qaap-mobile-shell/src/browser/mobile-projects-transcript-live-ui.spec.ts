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
});
