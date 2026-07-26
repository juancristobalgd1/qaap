// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// End-to-end regression guard for the turn-provenance badge (commit 8a5e9c286):
// the accordion header of an agent turn shows which agent/model actually drove
// it. This spec walks the REAL path front to back rather than unit-testing any
// single layer in isolation:
//
//   toAgentMessageWirePayload/applyAgentMessageWireDelta (wire round-trip)
//     -> renderTranscriptMessages / createTranscriptAgentSegmentsRow
//     -> wrapMobileProcessAccordion / syncMobileProcessAccordionProvenance
//
// It deliberately does NOT mock resolveTurnProvenance, syncMobileProcessAccordionProvenance,
// or the wire delta functions -- those are exactly the pieces under test.

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { Disposable } from '@theia/core/lib/common/disposable';
import * as markdownit from '@theia/core/shared/markdown-it';
import type {
    QaapAgentConversationDTO,
    QaapAgentMessageDTO,
    QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task-client';
import {
    applyAgentMessageWireDelta,
    computeAgentMessageWireDelta,
} from '../common/qaap-agent-message-wire-delta';
import { TRANSCRIPT_MESSAGE_ID_ATTR } from '../common/qaap-transcript-incremental-update';
import { formatQaiqModelSelectionLabel } from '../common/qaap-qaiq-model-catalog';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import { MobileProjectsTranscriptMessagesArtifactsUi } from './mobile-projects-transcript-messages-artifacts-ui';
import { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import { MobileProjectsTranscriptMessagesRenderUi } from './mobile-projects-transcript-messages-render-ui';
import { MobileProjectsTranscriptMessagesToolUi } from './mobile-projects-transcript-messages-tool-ui';
import { MobileProjectsTranscriptMessagesUserUi } from './mobile-projects-transcript-messages-user-ui';
import { MobileProjectsTranscriptUi } from './mobile-projects-transcript-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';
import {
    MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS,
} from './qaap-execution-event-timeline';

describe('turn-provenance badge (end-to-end: seal -> wire -> render)', () => {

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

    // ─── Full renderTranscriptMessages() harness (mirrors mobile-projects-transcript-messages-render-ui.spec.ts) ───

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
            workHub: {} as WorkHubTranscriptBridge,
        } as unknown as MobileProjectsTranscriptMessagesHost;
        const workHub = {
            isAgentsHubLanding: () => true,
            shouldEmbedAgentsHubRecentsInWorkspaceTranscript: () => false,
            createAgentsHubLandingHeroBlock: () => document.createElement('section'),
            createAgentsHubQuickActionsBlock: () => document.createElement('div'),
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

    const anthropicSonnet: QaapCreateAgentTaskQaiqModel = {
        provider: 'anthropic',
        vendor: 'anthropic',
        modelId: 'claude-4-sonnet',
    };
    const openRouterFallback: QaapCreateAgentTaskQaiqModel = {
        provider: 'openai',
        vendor: 'openrouter',
        modelId: 'moonshotai/kimi-k2.6:free',
    };

    function finishedTool(id: string): QaapAgentMessageSegmentDTO {
        return { type: 'tool', toolUseId: id, name: 'Bash', args: JSON.stringify({ command: 'ls' }), result: 'a.ts\n', finished: true };
    }

    function conversationWithTurn(
        userMessage: QaapAgentMessageDTO,
        agentSegments: QaapAgentMessageSegmentDTO[],
    ): QaapAgentConversationDTO {
        return {
            id: 'conv-provenance',
            cwd: '/workspace',
            agentId: userMessage.turnAgentId ?? 'claude',
            title: 'Provenance',
            status: 'streaming',
            createdAt: 0,
            updatedAt: Date.now(),
            messages: [
                userMessage,
                { id: 'agent-1', role: 'agent', content: '', createdAt: 2, segments: agentSegments },
            ],
        };
    }

    function findBadges(messageHost: HTMLElement): HTMLElement[] {
        return [...messageHost.querySelectorAll<HTMLElement>(`.${MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS}`)];
    }

    // ─── 1. Happy path ───────────────────────────────────────────────────────

    it('renders exactly one provenance badge naming the agent and the model that drove the turn', () => {
        const { renderUi } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        const conv = conversationWithTurn(
            { id: 'user-1', role: 'user', content: 'Fix the bug', createdAt: 1, turnAgentId: 'claude', turnAgentModel: anthropicSonnet },
            [finishedTool('t1')],
        );
        renderUi.renderTranscriptMessages(chatHost, conv);
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

        const badges = findBadges(messageHost);
        expect(badges, 'exactly one provenance badge in the rendered transcript').to.have.length(1);
        const expectedLabel = `${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(anthropicSonnet)}`;
        expect(badges[0].textContent).to.equal(expectedLabel);
        expect(badges[0].title).to.equal(expectedLabel);
    });

    // ─── 3. No model reported (native CLI) ──────────────────────────────────

    it('shows the agent alone when only turnAgentId is known, and never invents a model label', () => {
        const { renderUi } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        const conv = conversationWithTurn(
            { id: 'user-1', role: 'user', content: 'Fix the bug', createdAt: 1, turnAgentId: 'codex' },
            [finishedTool('t1')],
        );
        renderUi.renderTranscriptMessages(chatHost, conv);
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

        const badges = findBadges(messageHost);
        expect(badges, 'exactly one provenance badge').to.have.length(1);
        const label = badges[0].textContent ?? '';
        expect(label).to.equal(resolveAgentDisplayLabel('codex'));
        expect(label).to.not.contain('·');
        expect(label.toLowerCase()).to.not.contain('unknown');
    });

    // ─── 4. Historical turn (predates the field) ────────────────────────────

    it('renders no badge at all for a historical turn that predates turnAgentId/turnAgentModel', () => {
        const { renderUi } = createRenderUi();
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        document.body.append(chatHost);

        const conv = conversationWithTurn(
            { id: 'user-1', role: 'user', content: 'Fix the bug', createdAt: 1 },
            [finishedTool('t1')],
        );
        renderUi.renderTranscriptMessages(chatHost, conv);
        const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

        expect(findBadges(messageHost), 'no provenance badge for a pre-feature turn').to.have.length(0);
    });

    // ─── 2. Wire round-trip survival + idempotent/updating streaming ticks ──

    function createArtifactsUi(): MobileProjectsTranscriptMessagesArtifactsUi {
        const host = {
            transcriptLastConv: undefined,
            transcriptUserScrollPinDispose: Disposable.NULL,
            transcriptLiveUi: {
                refreshTranscriptApprovals: async () => undefined,
                hasPendingTranscriptToolApproval: () => false,
            },
            projectRowsUi: { localizeActivityLabel: (label: string) => label },
            transcriptMarkdownIt: markdownit({ linkify: false }),
        } as unknown as MobileProjectsTranscriptMessagesHost;
        const contentUi = new MobileProjectsTranscriptMessagesContentUi(host as never);
        const resolversUi = new MobileProjectsTranscriptMessagesResolversUi(host as never, contentUi);
        const toolUi = new MobileProjectsTranscriptMessagesToolUi(host as never, contentUi, resolversUi);
        return new MobileProjectsTranscriptMessagesArtifactsUi(host, contentUi, resolversUi, toolUi);
    }

    it('survives the SSE wire round-trip, stays idempotent across an identical tick, and updates on a fallback-model retry tick -- without ever duplicating the badge', () => {
        // Step A: the field must survive toAgentMessageWirePayload/applyAgentMessageWireDelta,
        // exactly as the live SSE stream applies it (message_start on first sight of the turn).
        const userSnapshot: QaapAgentMessageDTO = {
            id: 'user-1', role: 'user', content: 'Fix the bug', createdAt: 1,
            turnAgentId: 'claude', turnAgentModel: anthropicSonnet,
        };
        const startDelta = computeAgentMessageWireDelta(undefined, userSnapshot, 'claude');
        expect(startDelta.kind, 'first sight of a message is a message_start frame').to.equal('message_start');
        const wireConv = { messages: [] as QaapAgentMessageDTO[] };
        const wiredUserMessage = applyAgentMessageWireDelta(wireConv, startDelta);
        expect(wiredUserMessage, 'applying message_start must produce a message').to.not.equal(undefined);
        expect(wiredUserMessage!.turnAgentId, 'turnAgentId survives the wire round-trip').to.equal('claude');
        expect(wiredUserMessage!.turnAgentModel, 'turnAgentModel survives the wire round-trip').to.deep.equal(anthropicSonnet);

        // Step B: render the turn for real, using the wire-survived user message.
        const ui = createArtifactsUi();
        let agentSegments = [finishedTool('t1')];
        let conv = conversationWithTurn(wiredUserMessage!, agentSegments);
        const row = ui.createTranscriptAgentSegmentsRow(agentSegments, undefined, conv, { streaming: true, message: conv.messages[1] });
        row.setAttribute(TRANSCRIPT_MESSAGE_ID_ATTR, 'agent-1');
        const body = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments')!;
        const badgesAfterFirstRender = [...body.querySelectorAll<HTMLElement>(`.${MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS}`)];
        expect(badgesAfterFirstRender, 'exactly one badge after the initial render').to.have.length(1);
        const firstBadgeEl = badgesAfterFirstRender[0];
        const firstLabel = firstBadgeEl.textContent;
        expect(firstLabel).to.equal(`${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(anthropicSonnet)}`);
        const headerEl = row.querySelector('.theia-mobile-process-accordion-header')!;
        expect(headerEl, 'the accordion header exists after the initial render').to.not.equal(null);

        // Step C: a second, identical SSE tick (e.g. a duplicate frame after a reconnect) must
        // neither drop nor duplicate the badge -- syncMobileProcessAccordionProvenance's dataset-key
        // dedup is exactly what is being exercised here via the real patch entrypoint.
        const patchedIdentical = ui.patchStreamingActivityTimeline(row, agentSegments, conv);
        expect(patchedIdentical, 'identical tick patches in place').to.equal(true);
        const badgesAfterIdenticalTick = [...body.querySelectorAll<HTMLElement>(`.${MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS}`)];
        expect(badgesAfterIdenticalTick, 'still exactly one badge after an identical tick').to.have.length(1);
        expect(badgesAfterIdenticalTick[0], 'the same badge element is reused, not replaced').to.equal(firstBadgeEl);
        expect(badgesAfterIdenticalTick[0].textContent).to.equal(firstLabel);

        // Step D: a turn retried on a fallback model (maybeRetryTurnWithFallbackModel rewrites the
        // driving user message's turnAgentModel) must UPDATE the badge, not add a second one.
        const retriedUserMessage: QaapAgentMessageDTO = {
            ...wiredUserMessage!,
            turnAgentModel: openRouterFallback,
        };
        agentSegments = [finishedTool('t1'), finishedTool('t2')];
        conv = conversationWithTurn(retriedUserMessage, agentSegments);
        const patchedRetry = ui.patchStreamingActivityTimeline(row, agentSegments, conv);
        expect(patchedRetry, 'fallback-model tick patches in place').to.equal(true);
        const badgesAfterRetryTick = [...body.querySelectorAll<HTMLElement>(`.${MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS}`)];
        // A genuine label change removes the stale badge and inserts a fresh one (see
        // syncMobileProcessAccordionProvenance) rather than mutating text in place -- so element
        // identity is NOT preserved here, but the accordion/header themselves must be (no full row
        // rebuild), and there must still be exactly one badge, never zero or two.
        expect(badgesAfterRetryTick, 'still exactly one badge after the fallback-model tick (no duplicate left behind)').to.have.length(1);
        expect(row.querySelector('.theia-mobile-process-accordion-header'), 'same header element, only its badge child changed')
            .to.equal(headerEl);
        const retryLabel = badgesAfterRetryTick[0].textContent;
        expect(retryLabel, 'the badge text updates to the model that actually ran').to
            .equal(`${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(openRouterFallback)}`);
        expect(retryLabel, 'the badge no longer shows the original model').to.not.equal(firstLabel);
    });
});
