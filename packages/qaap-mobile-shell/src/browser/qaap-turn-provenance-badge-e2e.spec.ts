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
    toAgentMessageWireSnapshot,
} from '../common/qaap-agent-message-wire-delta';
import { TRANSCRIPT_MESSAGE_ID_ATTR } from '../common/qaap-transcript-incremental-update';
import { formatQaiqModelIdShortLabel, formatQaiqModelSelectionLabel } from '../common/qaap-qaiq-model-catalog';
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
    MOBILE_TURN_PROVENANCE_STANDALONE_CLASS,
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

    function textSegment(content: string): QaapAgentMessageSegmentDTO {
        return { type: 'text', content };
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

    function findStandaloneBadges(messageHost: HTMLElement): HTMLElement[] {
        return [...messageHost.querySelectorAll<HTMLElement>(`.${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`)];
    }

    /** Every provenance badge in the transcript, accordion-hosted or standalone -- a turn must
     *  never render more than one, regardless of which host it ends up in. */
    function findAnyBadges(messageHost: HTMLElement): HTMLElement[] {
        return [...messageHost.querySelectorAll<HTMLElement>(
            `.${MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS}, .${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`,
        )];
    }

    // The badge now shares the composer's agent-identity visual (createAgentIdentityElement):
    // avatar + provider sub-icon overlaid in the corner + a short text label -- see
    // qaap-agent-ui.ts. These helpers read that shape instead of a flat text string.

    /** The badge's visible text -- ONLY the short model id (or the agent name alone when no
     *  model is known). The agent/provider are conveyed visually by the avatar, not by text. */
    function badgeLabelText(badge: HTMLElement): string {
        return badge.querySelector('.theia-qaap-agent-identity-label')?.textContent ?? '';
    }

    /** The provider's icon overlaid in the corner of the avatar -- present only when a model is
     *  known (never invented). */
    function badgeProviderIcon(badge: HTMLElement): Element | null {
        return badge.querySelector('.theia-qaap-agent-identity-provider-badge .theia-qaap-llm-provider-icon');
    }

    function badgeAvatarIcon(badge: HTMLElement): Element | null {
        return badge.querySelector('.theia-qaap-agent-identity-avatar .theia-qaap-agent-brand-icon');
    }

    // ─── 1. Happy path ───────────────────────────────────────────────────────

    it('renders exactly one provenance badge: agent avatar + provider sub-icon + short model name as text', () => {
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
        expect(badgeAvatarIcon(badges[0]), 'agent brand avatar is present').to.exist;
        expect(badgeProviderIcon(badges[0]), 'provider sub-icon is present -- a model is known').to.exist;
        expect(badgeLabelText(badges[0]), 'visible text is ONLY the short model id, never "Agent · Provider · id"')
            .to.equal(formatQaiqModelIdShortLabel(anthropicSonnet.modelId));
        const expectedTitle = `${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(anthropicSonnet)}`;
        expect(badges[0].title, 'title stays the full, unambiguous label').to.equal(expectedTitle);
    });

    // ─── 3. No model reported (native CLI) ──────────────────────────────────

    it('shows the agent avatar alone (no provider sub-icon) when only turnAgentId is known, and never invents a model label', () => {
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
        expect(badgeAvatarIcon(badges[0]), 'agent brand avatar is present').to.exist;
        expect(badgeProviderIcon(badges[0]), 'no provider sub-icon -- no model was reported').to.not.exist;
        const label = badgeLabelText(badges[0]);
        expect(label).to.equal(resolveAgentDisplayLabel('codex'));
        expect(label).to.not.contain('·');
        expect(label.toLowerCase()).to.not.contain('unknown');
        expect(badges[0].title, 'title is just the agent name when no model is known').to.equal(resolveAgentDisplayLabel('codex'));
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

    // ─── 5. No-tool turns: same badge, no accordion to hide it in ───────────
    // A turn that answers directly (no Bash/Read/etc.) never has a process
    // accordion -- createTranscriptAgentSegmentsRow's else-branch renders a
    // thought brief + text instead. Before this fix, that meant the
    // provenance badge (which lived only in the accordion header) never
    // appeared for the most common kind of turn.

    describe('no-tool turns (standalone badge)', () => {

        it('renders exactly one standalone badge for a turn with no tool segments, and no accordion', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);

            const conv = conversationWithTurn(
                { id: 'user-1', role: 'user', content: 'What is 2+2?', createdAt: 1, turnAgentId: 'claude', turnAgentModel: anthropicSonnet },
                [textSegment('4')],
            );
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

            expect(messageHost.querySelectorAll('.theia-mobile-process-accordion'), 'no empty accordion for a tool-less turn').to.have.length(0);
            const accordionBadges = findBadges(messageHost);
            expect(accordionBadges, 'no accordion-hosted badge -- there is no accordion').to.have.length(0);
            const standaloneBadges = findStandaloneBadges(messageHost);
            expect(standaloneBadges, 'exactly one standalone badge').to.have.length(1);
            expect(badgeProviderIcon(standaloneBadges[0]), 'provider sub-icon present -- a model is known').to.exist;
            expect(badgeLabelText(standaloneBadges[0])).to.equal(formatQaiqModelIdShortLabel(anthropicSonnet.modelId));
            expect(standaloneBadges[0].title).to.equal(`${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(anthropicSonnet)}`);
            expect(findAnyBadges(messageHost), 'never two badges for the same turn').to.have.length(1);
        });

        it('renders no standalone badge for a historical no-tool turn that predates turnAgentId', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);

            const conv = conversationWithTurn(
                { id: 'user-1', role: 'user', content: 'What is 2+2?', createdAt: 1 },
                [textSegment('4')],
            );
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

            expect(findAnyBadges(messageHost), 'no badge, no gap, no layout shift for a pre-feature no-tool turn').to.have.length(0);
        });

        it('a turn WITH tools shows only the accordion badge, never a standalone one alongside it', () => {
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

            expect(findStandaloneBadges(messageHost), 'no standalone badge when the turn used tools').to.have.length(0);
            expect(findAnyBadges(messageHost)).to.have.length(1);
        });

        it('stays idempotent across a repeated streaming tick on a no-tool row (never duplicates)', () => {
            const ui = createArtifactsUi();
            const segments = [textSegment('Thinking…')];
            const conv = conversationWithTurn(
                { id: 'user-1', role: 'user', content: 'What is 2+2?', createdAt: 1, turnAgentId: 'claude', turnAgentModel: anthropicSonnet },
                segments,
            );
            const row = ui.createTranscriptAgentSegmentsRow(segments, undefined, conv, { streaming: true, message: conv.messages[1] });
            const body = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments')!;
            const firstPass = [...body.querySelectorAll<HTMLElement>(`.${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`)];
            expect(firstPass, 'exactly one standalone badge after the initial render').to.have.length(1);
            const firstBadgeEl = firstPass[0];

            // A repeated identical tick (patchStreamingThoughtBrief's entrypoint) must reuse the
            // same element and text, not duplicate or recreate it.
            const patched = ui.patchStreamingThoughtBrief(row, segments, conv, true);
            expect(patched).to.equal(true);
            const secondPass = [...body.querySelectorAll<HTMLElement>(`.${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`)];
            expect(secondPass, 'still exactly one badge after a repeated tick').to.have.length(1);
            expect(secondPass[0], 'the same badge element is reused, not replaced').to.equal(firstBadgeEl);
            expect(body.firstElementChild, 'the badge stays the first child of the segments body').to.equal(secondPass[0]);
        });

        it('removes the standalone badge (never leaves both) once the row upgrades to the tool timeline', () => {
            const ui = createArtifactsUi();
            const noToolSegments = [textSegment('Thinking…')];
            const userMessage: QaapAgentMessageDTO = {
                id: 'user-1', role: 'user', content: 'Fix the bug', createdAt: 1,
                turnAgentId: 'claude', turnAgentModel: anthropicSonnet,
            };
            let conv = conversationWithTurn(userMessage, noToolSegments);
            const row = ui.createTranscriptAgentSegmentsRow(noToolSegments, undefined, conv, { streaming: true, message: conv.messages[1] });
            const body = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments')!;
            expect(body.querySelectorAll(`.${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`), 'standalone badge before any tool arrives').to.have.length(1);

            const withTool = [...noToolSegments, finishedTool('t1')];
            conv = conversationWithTurn(userMessage, withTool);
            const patched = ui.patchStreamingActivityTimeline(row, withTool, conv);
            expect(patched, 'the upgrade patch applies in place').to.equal(true);

            expect(body.querySelectorAll(`.${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`), 'standalone badge removed once the row has an accordion').to.have.length(0);
            expect(body.querySelectorAll(`.${MOBILE_PROCESS_ACCORDION_PROVENANCE_CLASS}`), 'exactly one accordion-hosted badge after the upgrade').to.have.length(1);
        });
    });

    // ─── 6. Agent-identity visual pattern: same language as the composer, no text stutter ──
    // The badge no longer renders a flat "Agent · Provider · modelId" string -- it shares
    // createAgentIdentityElement with the composer's agent-picker button
    // (populateAgentToolbarButton): avatar, provider sub-icon overlaid in the corner, and
    // ONLY the short model id as text. This is what actually fixes the mobile truncation --
    // "QAIQ · OpenRouter · openrouter/free" no longer exists as a string to truncate.

    describe('agent-identity visual pattern (avatar + provider sub-icon + short model label)', () => {

        const openRouterFreeModel: QaapCreateAgentTaskQaiqModel = {
            provider: 'openai',
            vendor: 'openrouter',
            modelId: 'openrouter/free',
        };

        it('accordion badge: text is ONLY the short model id (no vendor stutter), title stays full', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);

            const conv = conversationWithTurn(
                { id: 'user-1', role: 'user', content: 'Fix the bug', createdAt: 1, turnAgentId: 'claude', turnAgentModel: openRouterFreeModel },
                [finishedTool('t1')],
            );
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

            const badges = findBadges(messageHost);
            expect(badges).to.have.length(1);
            expect(badgeProviderIcon(badges[0]), 'provider sub-icon carries the vendor -- text must not repeat it').to.exist;
            const label = badgeLabelText(badges[0]);
            expect(label, 'visible text is just the short model id').to.equal('free');
            expect(label).to.not.contain('·');
            expect(label.toLowerCase()).to.not.contain('openrouter');
            const expectedTitle = `${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(openRouterFreeModel)}`;
            expect(badges[0].title, 'title stays the full, unambiguous label').to.equal(expectedTitle);
            expect(badges[0].title).to.contain('OpenRouter · openrouter/free');
        });

        it('standalone badge: identical visual pattern as the accordion badge', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);

            const conv = conversationWithTurn(
                { id: 'user-1', role: 'user', content: 'What is 2+2?', createdAt: 1, turnAgentId: 'claude', turnAgentModel: openRouterFreeModel },
                [textSegment('4')],
            );
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

            const badges = findStandaloneBadges(messageHost);
            expect(badges).to.have.length(1);
            expect(badgeAvatarIcon(badges[0])).to.exist;
            expect(badgeProviderIcon(badges[0])).to.exist;
            expect(badgeLabelText(badges[0])).to.equal('free');
            expect(badges[0].title).to.equal(`${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(openRouterFreeModel)}`);
        });

        it('both badge hosts render the exact same shared DOM shape (.theia-qaap-agent-identity*)', () => {
            // Two independent render-ui instances (like every other test in this file) --
            // reusing one across two unrelated conversations would make the second render
            // take an unrelated streaming-patch code path against stale internal state from
            // the first, which is not what this test is about.
            const chatHostWithTool = document.createElement('div');
            chatHostWithTool.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHostWithTool);
            const convWithTool = conversationWithTurn(
                { id: 'user-1', role: 'user', content: 'Fix the bug', createdAt: 1, turnAgentId: 'claude', turnAgentModel: anthropicSonnet },
                [finishedTool('t1')],
            );
            const { renderUi: renderUiWithTool } = createRenderUi();
            renderUiWithTool.renderTranscriptMessages(chatHostWithTool, convWithTool);
            const accordionBadge = findBadges(renderUiWithTool.resolveTranscriptMessageHost(chatHostWithTool))[0];

            const chatHostNoTool = document.createElement('div');
            chatHostNoTool.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHostNoTool);
            const convNoTool = conversationWithTurn(
                { id: 'user-1', role: 'user', content: 'What is 2+2?', createdAt: 1, turnAgentId: 'claude', turnAgentModel: anthropicSonnet },
                [textSegment('4')],
            );
            const { renderUi: renderUiNoTool } = createRenderUi();
            renderUiNoTool.renderTranscriptMessages(chatHostNoTool, convNoTool);
            const standaloneBadge = findStandaloneBadges(renderUiNoTool.resolveTranscriptMessageHost(chatHostNoTool))[0];

            for (const badge of [accordionBadge, standaloneBadge]) {
                expect(badge.classList.contains('theia-qaap-agent-identity'), 'shared identity root class').to.equal(true);
                expect(badge.querySelector('.theia-qaap-agent-identity-avatar'), 'shared avatar class').to.exist;
                expect(badge.querySelector('.theia-qaap-agent-identity-provider-badge'), 'shared provider-badge class').to.exist;
                expect(badge.querySelector('.theia-qaap-agent-identity-label'), 'shared label class').to.exist;
            }
            expect(badgeLabelText(accordionBadge)).to.equal(badgeLabelText(standaloneBadge));
        });
    });

    // ─── 7. Rows with NO segments at all: raw-stdout (@shell) and pure-failure turns ──
    // These are NOT built by createTranscriptAgentSegmentsRow -- resolveTranscriptAgentSegments
    // returns undefined for them (no tool/thinking/text segments to derive), so
    // createTranscriptMessageRowAtIndex routes them to two different row builders:
    // createTranscriptMessageRow (raw content, no error) and createTranscriptAgentFailureRow
    // (an error with nothing else). Neither host had the badge before this fix.

    describe('rows with no segments at all (shell raw-stdout, pure-failure turns)', () => {

        function conversationWithRawStdoutTurn(
            userMessage: QaapAgentMessageDTO,
            agentContent: string,
        ): QaapAgentConversationDTO {
            return {
                id: 'conv-provenance',
                cwd: '/workspace',
                agentId: userMessage.turnAgentId ?? 'shell',
                title: 'Provenance',
                status: 'idle',
                createdAt: 0,
                updatedAt: Date.now(),
                messages: [
                    userMessage,
                    {
                        id: 'agent-1', role: 'agent', content: agentContent, createdAt: 2,
                        // A 'checkpoint' trace event produces no segments (see
                        // traceEventsToSegments) -- this is exactly the real shape reported
                        // live: raw stdout content with only a checkpoint event, no
                        // tool/thinking/text segments at all.
                        traceEvents: [{ type: 'checkpoint', id: 'cp-1', label: 'checkpoint', commit: 'abc123', capturedAt: 2 }],
                    },
                ],
            };
        }

        function conversationWithNoSegmentsFailure(
            userMessage: QaapAgentMessageDTO,
            errorMessage: string,
        ): QaapAgentConversationDTO {
            return {
                id: 'conv-provenance',
                cwd: '/workspace',
                agentId: userMessage.turnAgentId ?? 'claude',
                title: 'Provenance',
                status: 'failed',
                createdAt: 0,
                updatedAt: Date.now(),
                messages: [
                    userMessage,
                    { id: 'agent-1', role: 'agent', content: '', createdAt: 2, error: errorMessage },
                ],
            };
        }

        it('renders a standalone badge for a raw-stdout turn with no segments (agent alone, never invents a model)', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);

            const conv = conversationWithRawStdoutTurn(
                { id: 'user-1', role: 'user', content: '@shell echo hola-badge', createdAt: 1, turnAgentId: 'shell' },
                'hola-badge\n',
            );
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

            expect(findBadges(messageHost), 'no accordion-hosted badge -- a raw-stdout turn has no accordion').to.have.length(0);
            const standaloneBadges = findStandaloneBadges(messageHost);
            expect(standaloneBadges, 'exactly one standalone badge').to.have.length(1);
            expect(badgeAvatarIcon(standaloneBadges[0]), 'agent brand avatar is present').to.exist;
            expect(badgeProviderIcon(standaloneBadges[0]), 'no provider sub-icon -- no model was reported').to.not.exist;
            const label = badgeLabelText(standaloneBadges[0]);
            expect(label).to.equal(resolveAgentDisplayLabel('shell'));
            expect(label).to.not.contain('·');
            expect(label.toLowerCase()).to.not.contain('unknown');
        });

        it('renders no badge for a historical raw-stdout turn that predates turnAgentId', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);

            const conv = conversationWithRawStdoutTurn(
                { id: 'user-1', role: 'user', content: '@shell echo hola-badge', createdAt: 1 },
                'hola-badge\n',
            );
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

            expect(findAnyBadges(messageHost), 'no badge for a pre-feature raw-stdout turn').to.have.length(0);
        });

        it('stays idempotent across a repeated content-growth tick on a raw-stdout row (never duplicates)', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);
            const userMessage: QaapAgentMessageDTO = {
                id: 'user-1', role: 'user', content: '@shell echo hola-badge', createdAt: 1, turnAgentId: 'shell',
            };
            const conv = conversationWithRawStdoutTurn(userMessage, 'hola');
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);
            const row = messageHost.querySelector<HTMLElement>(`[${TRANSCRIPT_MESSAGE_ID_ATTR}="agent-1"]`)!;
            expect(row, 'row for the raw-stdout message is mounted').to.not.equal(null);
            const firstPass = [...row.querySelectorAll<HTMLElement>(`.${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`)];
            expect(firstPass, 'exactly one standalone badge after the initial render').to.have.length(1);
            const firstBadgeEl = firstPass[0];

            // Simulate the content-only streaming tick (canStreamPatchStdoutAgentContentOnly):
            // stdout grew, still no segments at all.
            const grownMsg: QaapAgentMessageDTO = { ...conv.messages[1], content: 'hola-badge\n' };
            const grownConv = conversationWithRawStdoutTurn(userMessage, 'hola-badge\n');
            const patched = renderUi.tryPatchStreamingAgentTextContent(row, conv.messages[1], grownMsg, undefined, grownConv);
            expect(patched, 'the content-only tick patches in place').to.equal(true);
            const secondPass = [...row.querySelectorAll<HTMLElement>(`.${MOBILE_TURN_PROVENANCE_STANDALONE_CLASS}`)];
            expect(secondPass, 'still exactly one badge after a repeated tick').to.have.length(1);
            expect(secondPass[0], 'the same badge element is reused, not replaced').to.equal(firstBadgeEl);
        });

        it('renders a standalone badge for a failed turn with no segments at all -- the row that most needs attribution', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);

            const conv = conversationWithNoSegmentsFailure(
                { id: 'user-1', role: 'user', content: 'Do the thing', createdAt: 1, turnAgentId: 'claude', turnAgentModel: anthropicSonnet },
                'We could not find a file matching that description.',
            );
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

            expect(findBadges(messageHost), 'no accordion-hosted badge -- a segment-less failure has no accordion').to.have.length(0);
            const standaloneBadges = findStandaloneBadges(messageHost);
            expect(standaloneBadges, 'exactly one standalone badge on the failure row').to.have.length(1);
            expect(badgeProviderIcon(standaloneBadges[0]), 'provider sub-icon present -- a model is known').to.exist;
            expect(badgeLabelText(standaloneBadges[0])).to.equal(formatQaiqModelIdShortLabel(anthropicSonnet.modelId));
            expect(standaloneBadges[0].title).to
                .equal(`${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(anthropicSonnet)}`);
            // Sanity: this really is the failure-dialog row (createTranscriptAgentFailureRow),
            // not a lucky coincidence -- the failure dialog must be present alongside the badge.
            expect(messageHost.querySelector('.theia-mobile-agent-transcript-msg .theia-mobile-agent-transcript-segments'))
                .to.not.equal(null);
        });

        it('renders no badge for a historical failed turn (no segments) that predates turnAgentId', () => {
            const { renderUi } = createRenderUi();
            const chatHost = document.createElement('div');
            chatHost.className = 'theia-mobile-agent-transcript-real-chat';
            document.body.append(chatHost);

            const conv = conversationWithNoSegmentsFailure(
                { id: 'user-1', role: 'user', content: 'Do the thing', createdAt: 1 },
                'We could not find a file matching that description.',
            );
            renderUi.renderTranscriptMessages(chatHost, conv);
            const messageHost = renderUi.resolveTranscriptMessageHost(chatHost);

            expect(findAnyBadges(messageHost), 'no badge for a pre-feature failed turn').to.have.length(0);
        });
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
        expect(badgeProviderIcon(firstBadgeEl), 'provider sub-icon present -- a model is known').to.exist;
        const firstLabel = badgeLabelText(firstBadgeEl);
        expect(firstLabel).to.equal(formatQaiqModelIdShortLabel(anthropicSonnet.modelId));
        expect(firstBadgeEl.title).to.equal(`${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(anthropicSonnet)}`);
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
        expect(badgeLabelText(badgesAfterIdenticalTick[0])).to.equal(firstLabel);

        // Step D: a turn retried on a fallback model (maybeRetryTurnWithFallbackModel rewrites the
        // driving user message's turnAgentModel) must UPDATE the badge, not add a second one.
        // The retried row is NOT hand-built here: it is produced by the same wire the backend uses,
        // so a delta layer that cannot express a provenance change (previously: `noop`, dropped by
        // fireAgentMessageWireUpdate before it ever reached a client) fails this step.
        const backendRetrySnapshot: QaapAgentMessageDTO = { ...userSnapshot, turnAgentModel: openRouterFallback };
        const retryDelta = computeAgentMessageWireDelta(
            toAgentMessageWireSnapshot(wiredUserMessage!),
            toAgentMessageWireSnapshot(backendRetrySnapshot),
            'claude',
        );
        expect(retryDelta.kind, 'a re-attributed turn must produce a frame the client can apply').to.not.equal('noop');
        const retriedUserMessage = applyAgentMessageWireDelta(
            { messages: [wiredUserMessage!] },
            retryDelta,
        );
        expect(retriedUserMessage, 'applying the retry delta must produce a message').to.not.equal(undefined);
        expect(retriedUserMessage!.turnAgentModel, 'the fallback model survives the wire').to.deep.equal(openRouterFallback);
        expect(retriedUserMessage!.turnAgentId, 'the agent attribution survives the wire').to.equal('claude');
        agentSegments = [finishedTool('t1'), finishedTool('t2')];
        conv = conversationWithTurn(retriedUserMessage!, agentSegments);
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
        expect(badgeProviderIcon(badgesAfterRetryTick[0]), 'provider sub-icon still present for the fallback model').to.exist;
        const retryLabel = badgeLabelText(badgesAfterRetryTick[0]);
        expect(retryLabel, 'the badge text updates to the model that actually ran').to
            .equal(formatQaiqModelIdShortLabel(openRouterFallback.modelId));
        expect(badgesAfterRetryTick[0].title, 'the title updates to the fallback model too').to
            .equal(`${resolveAgentDisplayLabel('claude')} · ${formatQaiqModelSelectionLabel(openRouterFallback)}`);
        expect(retryLabel, 'the badge no longer shows the original model').to.not.equal(firstLabel);
    });
});
