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
import {
    enableTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
    resetTranscriptRenderMetrics,
} from '../common/qaap-transcript-render-metrics';
import { seedTranscriptSemanticProgressClock } from '../common/qaap-transcript-semantic-progress';
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
        globalThis.requestAnimationFrame = raf;
        globalThis.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);
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
            transcriptLastSemanticProgressKey: undefined,
            transcriptLastTransportEventAt: undefined,
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
            transcriptMarkdownIt: {
                render: (content: string) => content,
            },
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
            isAgentsHubLanding: () => true,
            shouldEmbedAgentsHubRecentsInWorkspaceTranscript: () => false,
            createAgentsHubLandingHeroBlock: () => {
                const hero = document.createElement('section');
                hero.className = 'theia-mobile-agents-hub-landing-hero';
                hero.textContent = 'Start new project';
                return hero;
            },
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

    function conversationWithMessages(messages: QaapAgentConversationDTO['messages']): QaapAgentConversationDTO {
        return {
            id: 'conv-scroll',
            cwd: '/workspace',
            agentId: 'codex',
            title: 'Scroll',
            status: 'streaming',
            createdAt: 0,
            updatedAt: Date.now(),
            messages,
        };
    }

    it('keeps empty landing chats as chat prompts without the project creation hero', () => {
        const { renderUi, host } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);
        const composerHost = document.createElement('div');
        host.transcriptComposerHost = composerHost;

        const conv: QaapAgentConversationDTO = {
            id: QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID,
            cwd: '/workspace',
            agentId: 'codex',
            title: 'Idle',
            status: 'idle',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
        };

        renderUi.renderTranscriptMessages(chatHost, conv);
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

        expect(messageHost.querySelector('.theia-mobile-agents-hub-landing-hero')).to.equal(null);
        expect(messageHost.querySelector('.theia-mobile-agent-transcript-empty')).to.equal(null);
        expect(messageHost.querySelector('.theia-mobile-agent-transcript-empty-welcome')).to.not.equal(null);
        expect(messageHost.querySelector('.theia-mobile-agent-transcript-empty-title')?.textContent).to.equal('Ready when you are.');
        expect(composerHost.classList.contains('theia-mod-show-quick-actions')).to.equal(true);
    });

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

    it('shows actionable timeout chrome when an agent turn has no first response', () => {
        const { renderUi, host } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        let cancelled = 0;
        let retried = 0;
        host.cancelOpenTranscriptStream = () => {
            cancelled += 1;
        };
        host.retryOpenTranscriptStream = () => {
            retried += 1;
            const seeded = seedTranscriptSemanticProgressClock();
            host.transcriptLastStreamProgressAt = seeded.at;
            host.transcriptLastSemanticProgressKey = seeded.key;
            host.transcriptLastTransportEventAt = seeded.at;
            renderUi.renderTranscriptMessages(chatHost, streaming);
        };
        host.transcriptLastStreamProgressAt = Date.now() - 61_000;
        host.transcriptLastTransportEventAt = Date.now();

        const streaming = streamingIdleConv();
        host.transcriptLastConv = streaming;
        renderUi.renderTranscriptMessages(chatHost, streaming);

        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
        const activityRow = messageHost.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`);
        expect(activityRow).to.not.equal(null);
        expect(activityRow?.classList.contains('theia-mod-stream-timed-out')).to.equal(true);
        expect(activityRow?.querySelector('.theia-mobile-agent-stream-label')?.textContent)
            .to.equal('El agente no respondió a tiempo');

        const banner = activityRow?.querySelector<HTMLElement>('.theia-mobile-agent-stream-timeout-banner');
        expect(banner?.textContent).to.contain('El agente no respondió a tiempo');
        const buttons = [...banner?.querySelectorAll<HTMLButtonElement>('button') ?? []];
        expect(buttons.map(button => button.textContent)).to.deep.equal(['Cancelar', 'Reintentar']);
        buttons[0].click();
        buttons[1].click();
        expect(cancelled).to.equal(1);
        expect(retried).to.equal(1);
        const refreshedRow = messageHost.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_ROW_ATTR}]`);
        expect(refreshedRow?.classList.contains('theia-mod-stream-timed-out')).to.equal(false);
        expect(messageHost.querySelector('.theia-mobile-agent-stream-timeout-banner')).to.equal(null);
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

    it('places a newly submitted user turn into reading position', () => {
        const { renderUi, host } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
        let scrollToCalls = 0;
        messageHost.scrollTo = () => {
            scrollToCalls++;
        };

        const previous = conversationWithMessages([
            { id: 'user-1', role: 'user', content: 'First', createdAt: 1 },
            { id: 'agent-1', role: 'agent', content: 'Done', createdAt: 2 },
        ]);
        host.transcriptLastConv = previous;
        host.transcriptLastRenderedConversationId = previous.id;

        renderUi.renderTranscriptMessages(chatHost, conversationWithMessages([
            ...previous.messages,
            { id: 'user-2', role: 'user', content: 'Next', createdAt: 3 },
        ]));

        expect(scrollToCalls).to.equal(1);
    });

    it('opens an existing conversation at the latest user turn instead of the absolute bottom', () => {
        const { renderUi } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
        let scrollToCalls = 0;
        messageHost.scrollTo = () => {
            scrollToCalls++;
        };

        renderUi.renderTranscriptMessages(chatHost, conversationWithMessages([
            { id: 'user-1', role: 'user', content: 'First', createdAt: 1 },
            { id: 'agent-1', role: 'agent', content: 'Done', createdAt: 2 },
            { id: 'user-2', role: 'user', content: 'Continue here', createdAt: 3 },
            { id: 'agent-2', role: 'agent', content: 'Long answer', createdAt: 4 },
        ]));

        expect(scrollToCalls).to.equal(1);
    });

    function settledConversation(
        id: string,
        messages: QaapAgentConversationDTO['messages'],
    ): QaapAgentConversationDTO {
        return {
            id,
            cwd: '/workspace',
            agentId: 'codex',
            title: 'Settled',
            status: 'settled',
            createdAt: 0,
            updatedAt: Date.now(),
            messages,
        };
    }

    it('skips re-rendering an unchanged settled conversation into the same host (render storm guard)', () => {
        const { renderUi, host } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        enableTranscriptRenderMetrics(true);
        try {
            const settled = settledConversation('conv-settled', [
                { id: 'user-1', role: 'user', content: 'Done?', createdAt: 1 },
                { id: 'agent-1', role: 'agent', content: 'All done.', createdAt: 2 },
            ]);

            // First paint: full rebuild, stamps the host.
            renderUi.renderTranscriptMessages(chatHost, settled);
            let snapshot = getTranscriptRenderMetricsSnapshot();
            expect(snapshot.render_full).to.equal(1);
            expect(snapshot.render_patch_none).to.equal(1);
            expect(snapshot.render_skip_unchanged_settled).to.equal(0);

            // A background host repaints the same settled snapshot ~8x/s while another
            // conversation streams. Simulate the shared-state thrash a streaming host causes
            // by clobbering the shared last-rendered pointers between ticks.
            for (let tick = 0; tick < 8; tick++) {
                host.transcriptLastConv = undefined;
                host.transcriptLastRenderedConversationId = 'some-other-streaming-conv';
                renderUi.renderTranscriptMessages(chatHost, settledConversation('conv-settled', [
                    { id: 'user-1', role: 'user', content: 'Done?', createdAt: 1 },
                    { id: 'agent-1', role: 'agent', content: 'All done.', createdAt: 2 },
                ]));
            }
            snapshot = getTranscriptRenderMetricsSnapshot();
            expect(snapshot.render_full).to.equal(1);
            expect(snapshot.render_patch_none).to.equal(1);
            expect(snapshot.render_skip_unchanged_settled).to.equal(8);

            // A real content change on the settled conversation must still repaint once.
            renderUi.renderTranscriptMessages(chatHost, settledConversation('conv-settled', [
                { id: 'user-1', role: 'user', content: 'Done?', createdAt: 1 },
                { id: 'agent-1', role: 'agent', content: 'All done. Plus a follow-up.', createdAt: 2 },
            ]));
            snapshot = getTranscriptRenderMetricsSnapshot();
            expect(snapshot.render_full).to.equal(2);
            expect(snapshot.render_skip_unchanged_settled).to.equal(8);
        } finally {
            resetTranscriptRenderMetrics();
            enableTranscriptRenderMetrics(false);
        }
    });

    it('does not skip a streaming conversation and re-arms the settled guard after settling', () => {
        const { renderUi, host } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        enableTranscriptRenderMetrics(true);
        try {
            const settled = settledConversation('conv-x', [
                { id: 'user-1', role: 'user', content: 'Hi', createdAt: 1 },
                { id: 'agent-1', role: 'agent', content: 'Hello', createdAt: 2 },
            ]);
            renderUi.renderTranscriptMessages(chatHost, settled);
            renderUi.renderTranscriptMessages(chatHost, settledConversation('conv-x', settled.messages));
            expect(getTranscriptRenderMetricsSnapshot().render_skip_unchanged_settled).to.equal(1);

            // Same conversation goes back to streaming: must repaint and clear the settled stamp.
            host.transcriptLastConv = undefined;
            host.transcriptLastRenderedConversationId = undefined;
            const streaming: QaapAgentConversationDTO = { ...settled, status: 'streaming' };
            renderUi.renderTranscriptMessages(chatHost, streaming);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
            expect(messageHost.dataset.qaapSettledRenderKey).to.equal(undefined);

            // Settling again must repaint once (guard was re-armed), not be wrongly skipped.
            const skipsBefore = getTranscriptRenderMetricsSnapshot().render_skip_unchanged_settled;
            host.transcriptLastConv = undefined;
            renderUi.renderTranscriptMessages(chatHost, settledConversation('conv-x', settled.messages));
            expect(getTranscriptRenderMetricsSnapshot().render_skip_unchanged_settled).to.equal(skipsBefore);
        } finally {
            resetTranscriptRenderMetrics();
            enableTranscriptRenderMetrics(false);
        }
    });

    it('adds direct message anchors and link copy actions to user turns', () => {
        const { renderUi } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        renderUi.renderTranscriptMessages(chatHost, conversationWithMessages([
            { id: 'user-link', role: 'user', content: 'Link this turn', createdAt: 1 },
        ]));

        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
        const row = messageHost.querySelector<HTMLElement>('.theia-mobile-agent-transcript-user-wrap');
        expect(row?.id).to.equal('qaap-transcript-message-user-link');
        expect(row?.getAttribute('data-transcript-message-id')).to.equal('user-link');
        expect(row?.querySelector<HTMLButtonElement>('.theia-mobile-agent-transcript-user-action.theia-mod-link')?.title)
            .to.equal('Copy link');
    });

});
