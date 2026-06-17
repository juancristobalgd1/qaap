// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID,
} from '../common/qaap-agents-hub-landing';
import type { QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';
import { TRANSCRIPT_ACTIVITY_ROW_ATTR } from '../common/qaap-transcript-incremental-update';
import { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import { MobileProjectsTranscriptMessagesRenderUi } from './mobile-projects-transcript-messages-render-ui';
import { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import { MobileProjectsTranscriptMessagesUserUi } from './mobile-projects-transcript-messages-user-ui';
import { MobileProjectsTranscriptUi } from './mobile-projects-transcript-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';

describe('MobileProjectsTranscriptMessagesRenderUi', () => {

    beforeEach(() => {
        if (typeof HTMLElement === 'undefined') {
            enableJSDOM();
        }
        if (!HTMLElement.prototype.scrollTo) {
            HTMLElement.prototype.scrollTo = () => undefined;
        }
        const raf = (callback: FrameRequestCallback): number => setTimeout(() => callback(performance.now()), 0) as unknown as number;
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);
    });

    function createRenderUi(): {
        renderUi: MobileProjectsTranscriptMessagesRenderUi;
        host: MobileProjectsTranscriptMessagesHost;
    } {
        const host = {
            transcriptUi: new MobileProjectsTranscriptUi(),
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptLastConv: undefined,
            transcriptLastRenderedConversationId: undefined,
            transcriptLastRenderedMessageId: undefined,
            transcriptLastFingerprint: undefined,
            transcriptLastStreamProgressAt: undefined,
            transcriptChatHost: undefined,
            transcriptComposerDraft: '',
            transcriptComposerHost: undefined,
            transcriptComposerProject: undefined,
            transcriptComposerSummary: undefined,
            transcriptOpenProject: undefined,
            transcriptOpenSummary: undefined,
            transcriptOpenSummaryId: undefined,
            transcriptPreviewRequestPending: false,
            transcriptPreviewRequestRunning: false,
            transcriptMarkdownIt: undefined,
            projectsService: {} as MobileProjectsTranscriptMessagesHost['projectsService'],
            projects: [],
            projectRowsUi: {
                localizeActivityLabel: (label: string) => label,
            },
            transcriptHeaderUi: { refreshTranscriptExecutionChrome: () => undefined },
            transcriptLiveUi: { refreshTranscriptApprovals: async () => undefined },
            transcriptStickyComposerUi: {} as MobileProjectsTranscriptMessagesHost['transcriptStickyComposerUi'],
            executionSurfaceTabsUi: {} as MobileProjectsTranscriptMessagesHost['executionSurfaceTabsUi'],
            maybeSyncTranscriptVisuallySettledChrome: () => undefined,
        } as unknown as MobileProjectsTranscriptMessagesHost;
        const workHub = {
            shouldEmbedAgentsHubRecentsInWorkspaceTranscript: () => false,
            createAgentsHubQuickActionsBlock: () => {
                const block = document.createElement('div');
                block.className = 'theia-mobile-agent-transcript-empty-actions';
                return block;
            },
            renderTeamSectionInTranscript: () => undefined,
            renderInlineApproval: () => undefined,
        } as unknown as WorkHubTranscriptBridge;
        const contentUi = new MobileProjectsTranscriptMessagesContentUi(host as never);
        const resolversUi = new MobileProjectsTranscriptMessagesResolversUi(host as never, contentUi);
        const toolUi = new MobileProjectsTranscriptMessagesToolUi(host as never, contentUi, resolversUi);
        const artifactsUi = new MobileProjectsTranscriptMessagesArtifactsUi(host, contentUi, resolversUi, toolUi);
        let renderUi!: MobileProjectsTranscriptMessagesRenderUi;
        const userUi = new MobileProjectsTranscriptMessagesUserUi(host, contentUi, toolUi, (messageHost, conv) => {
            renderUi.renderTranscriptMessages(messageHost, conv);
        });
        renderUi = new MobileProjectsTranscriptMessagesRenderUi(host, workHub, contentUi, userUi, artifactsUi, toolUi);
        return { renderUi, host };
    }

    function streamingIdleConv(): QaapAgentConversationDTO {
        return {
            id: QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID,
            cwd: '/workspace',
            agentId: 'codex',
            title: '',
            status: 'streaming',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [{
                id: 'user-1',
                role: 'user',
                content: 'Fix a bug',
                createdAt: Date.now(),
            }],
        };
    }

    function emptyIdleConv(): QaapAgentConversationDTO {
        return {
            id: QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID,
            cwd: '/workspace',
            agentId: 'codex',
            title: '',
            status: 'idle',
            createdAt: 0,
            updatedAt: Date.now(),
            messages: [],
        };
    }

    it('clears streaming activity row when switching to an empty conversation', () => {
        const { renderUi, host } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        const streaming = streamingIdleConv();
        host.transcriptLastConv = streaming;
        host.transcriptLastRenderedConversationId = streaming.id;
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
        const ghost = document.createElement('div');
        ghost.setAttribute(TRANSCRIPT_ACTIVITY_ROW_ATTR, 'true');
        ghost.className = 'theia-mobile-agent-transcript-msg theia-mod-agent theia-mod-streaming theia-mobile-agent-activity';
        ghost.innerHTML = '<div class="theia-mobile-agent-stream-line theia-mod-planning"><span class="theia-mobile-agent-stream-label">Planning next moves…</span></div>';
        messageHost.append(ghost);
        expect(messageHost.querySelector(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`)).to.not.equal(null);

        host.transcriptLastConv = emptyIdleConv();
        renderUi.renderTranscriptMessages(chatHost, emptyIdleConv());
        expect(messageHost.querySelector(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`)).to.equal(null);
        expect(messageHost.querySelector('.theia-mobile-agent-stream-line')).to.equal(null);
    });

    it('renders optimistic image previews in pending user rows', () => {
        const { renderUi } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        const conv: QaapAgentConversationDTO = {
            id: QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID,
            cwd: '/workspace',
            agentId: 'codex',
            title: 'shot',
            status: 'streaming',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [{
                id: 'pending-user-1',
                role: 'user',
                content: '',
                createdAt: Date.now(),
            optimisticImagePreviews: [{ src: 'data:image/png;base64,ZmFrZQ==', fileName: 'shot.png' }],
            }],
        };
        renderUi.renderTranscriptMessages(chatHost, conv);
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
        const img = messageHost.querySelector<HTMLImageElement>('.theia-mobile-agent-transcript-user-attachment-image');
        expect(img?.src).to.contain('data:image/png;base64,ZmFrZQ==');
        expect(messageHost.querySelector('.theia-mobile-agent-transcript-user-attachment-title')?.textContent).to.equal('shot.png');
    });

    it('renders optimistic SVG previews in pending user rows', () => {
        const { renderUi } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        const conv: QaapAgentConversationDTO = {
            id: QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID,
            cwd: '/workspace',
            agentId: 'codex',
            title: 'svg',
            status: 'streaming',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [{
                id: 'pending-user-2',
                role: 'user',
                content: '',
                createdAt: Date.now(),
                optimisticImagePreviews: [{
                    src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
                    fileName: 'huggingface-color.svg',
                }],
            }],
        };
        renderUi.renderTranscriptMessages(chatHost, conv);
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
        const img = messageHost.querySelector<HTMLImageElement>('.theia-mobile-agent-transcript-user-attachment-image');
        expect(img?.src).to.contain('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
        expect(messageHost.querySelector('.theia-mobile-agent-transcript-user-attachment-title')?.textContent)
            .to.equal('huggingface-color.svg');
    });
});
