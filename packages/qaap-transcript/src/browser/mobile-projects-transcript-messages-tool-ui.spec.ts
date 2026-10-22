// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    formatTranscriptExecutionTime,
    syncTranscriptToolExecutionTime,
    TRANSCRIPT_TOOL_RESULT_STREAM_CLASS,
    TRANSCRIPT_TOOL_SPECULATIVE_CLASS,
} from './mobile-projects-transcript-messages-tool-ui';
import type { QaapAgentMessageSegmentDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptMessagesToolUiContext } from './mobile-projects-transcript-messages-tool-ui-context';
import {
    createTranscriptToolResultStreamBodyExtracted,
    createTranscriptToolSpeculativePlaceholderExtracted,
    ensureTranscriptToolSpeculativePlaceholderExtracted,
} from './mobile-projects-transcript-messages-tool-ui-streaming';
import { patchTranscriptToolResultStreamBodyExtracted } from './mobile-projects-transcript-messages-tool-ui-timeline';
import { createTranscriptAgentAuthLoginCardExtracted, createTranscriptAgentFailureDialogExtracted } from './mobile-projects-transcript-messages-tool-ui-render';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('mobile-projects-transcript-messages-tool-ui', () => {

    useSuiteJSDOM();

    describe('agent auth-login card', () => {
        const noop = (): void => undefined;
        const card = (agentId: string): HTMLElement => createTranscriptAgentAuthLoginCardExtracted(
            {} as MobileProjectsTranscriptMessagesToolUiContext,
            { mode: 'api_key' },
            { agentId, onOpenAgentSignIn: noop, onOpenAiFeaturesSettings: noop },
        );

        it('offers Settings for a QAIQ API-key error', () => {
            const qaiq = card('qaiq');
            expect(qaiq.querySelector('.codicon-settings-gear')).to.not.equal(null);
            expect(qaiq.querySelector('.codicon-terminal')).to.equal(null);
        });

        it('offers the CLI sign-in, never Add API key, for every other harness', () => {
            for (const agentId of ['claude', 'openclaude', 'hermes', 'antigravity']) {
                const other = card(agentId);
                expect(other.querySelector('.codicon-settings-gear'), agentId).to.equal(null);
                expect(other.querySelector('.codicon-terminal'), agentId).to.not.equal(null);
            }
        });
    });

    describe('plan-limit failure card', () => {
        const ctx = {
            appendTranscriptShellSummaryTail: () => undefined,
            contentUi: { cleanTranscriptDisplayText: (text: string) => text },
        } as unknown as MobileProjectsTranscriptMessagesToolUiContext;

        it('shows the localized message and an Upgrade button that opens billing, hiding the raw tag', () => {
            let opened = 0;
            const raw = '[qaap:plan_limit:hosted_model_denied] Hosted Codex models require Pro or Team.';
            const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw, { onOpenBilling: () => { opened++; } });
            const cta = card.querySelector<HTMLButtonElement>('.theia-mobile-agent-turn-failure-plan-cta');
            expect(cta?.textContent).to.equal('Upgrade plan');
            expect(card.textContent).not.to.contain('qaap:plan_limit');
            cta!.click();
            expect(opened).to.equal(1);
        });

        it('offers Top up for exhausted credits and omits the CTA when billing cannot be opened', () => {
            const raw = '[qaap:plan_limit:credits_exhausted] Codex hosted credits are exhausted.';
            const withBilling = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw, { onOpenBilling: () => undefined });
            expect(withBilling.querySelector('.theia-mobile-agent-turn-failure-plan-cta')?.textContent).to.equal('Top up');
            const without = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw);
            expect(without.querySelector('.theia-mobile-agent-turn-failure-plan-cta')).to.equal(null);
        });
    });

    describe('QAIQ missing-provider-key failure card', () => {
        const refusal = 'Add your OpenRouter API key in Settings → BYOK to use QAIQ, pick a model from a provider you have a key for, or pick another agent from the agent chip. '
            + 'Keys are personal: each account adds its own.';
        const ctx = {
            appendTranscriptShellSummaryTail: () => undefined,
            contentUi: { cleanTranscriptDisplayText: (text: string) => text },
        } as unknown as MobileProjectsTranscriptMessagesToolUiContext;
        (ctx as { createTranscriptAgentAuthLoginCard: unknown }).createTranscriptAgentAuthLoginCard = (
            challenge: Parameters<typeof createTranscriptAgentAuthLoginCardExtracted>[1],
            options: Parameters<typeof createTranscriptAgentAuthLoginCardExtracted>[2],
        ) => createTranscriptAgentAuthLoginCardExtracted(ctx, challenge, options);

        it('reads "API key needed", opens Settings → BYOK, and offers no sign-in', () => {
            let openedSettings = 0;
            let signIns = 0;
            const card = createTranscriptAgentFailureDialogExtracted(ctx, refusal, refusal, {
                agentId: 'qaiq',
                agentLabel: 'QAIQ',
                onOpenAiFeaturesSettings: () => { openedSettings++; },
                onOpenAgentSignIn: () => { signIns++; },
                onRetry: () => undefined,
            });
            expect(card.querySelector('.theia-mobile-agent-shell-title')?.textContent).to.equal('API key needed');
            expect(card.querySelector('.theia-mobile-agent-turn-failure-message')?.textContent).to.equal(refusal);
            const settings = card.querySelector<HTMLButtonElement>('.codicon-settings-gear');
            expect(settings?.textContent).to.equal('Add API key in Settings');
            expect(card.querySelector('.codicon-terminal')).to.equal(null);
            expect(card.querySelector('.codicon-link-external')).to.equal(null);
            expect(card.textContent).to.not.match(/sign in/i);
            settings!.click();
            expect(openedSettings).to.equal(1);
            expect(signIns).to.equal(0);
        });
    });

    describe('BYOK provider-key failure card', () => {
        const ctx = {
            appendTranscriptShellSummaryTail: () => undefined,
            contentUi: { cleanTranscriptDisplayText: (text: string) => text },
            createTranscriptClampedPre: (text: string) => Object.assign(document.createElement('pre'), { textContent: text }),
        } as unknown as MobileProjectsTranscriptMessagesToolUiContext;

        it('names the rejected key and opens BYOK settings instead of a sign-in or model hint', () => {
            let opened = 0;
            const error = 'Your OpenRouter key was rejected. Update it in Settings → BYOK, then retry.';
            const log = 'There\'s an issue with the selected model (nvidia/nemotron-3-super-120b-a12b:free).\n'
                + '[qaap] provider check: OpenRouter key_rejected (HTTP 401).';
            const card = createTranscriptAgentFailureDialogExtracted(ctx, error, log, {
                agentId: 'qaiq',
                onOpenAiFeaturesSettings: () => { opened++; },
            });
            expect(card.classList.contains('theia-mod-provider-key')).to.equal(true);
            expect(card.querySelector('.theia-mobile-agent-shell-title')?.textContent).to.equal('API key rejected');
            expect(card.querySelector('.theia-mobile-agent-turn-failure-message')?.textContent).to.equal(error);
            expect(card.querySelector('.codicon-terminal')).to.equal(null);
            const button = card.querySelector<HTMLButtonElement>('.codicon-settings-gear');
            expect(button?.textContent).to.equal('Open BYOK settings');
            button!.click();
            expect(opened).to.equal(1);
        });
    });

    describe('formatTranscriptExecutionTime', () => {
        it('formats sub-second durations as milliseconds', () => {
            expect(formatTranscriptExecutionTime(0)).to.equal('0ms');
            expect(formatTranscriptExecutionTime(1)).to.equal('1ms');
            expect(formatTranscriptExecutionTime(999)).to.equal('999ms');
        });

        it('formats sub-minute durations as seconds with one decimal', () => {
            expect(formatTranscriptExecutionTime(1000)).to.equal('1.0s');
            expect(formatTranscriptExecutionTime(1500)).to.equal('1.5s');
            expect(formatTranscriptExecutionTime(12345)).to.equal('12.3s');
            expect(formatTranscriptExecutionTime(59999)).to.equal('60.0s');
        });

        it('formats minute-and-second durations as XminYs', () => {
            expect(formatTranscriptExecutionTime(60000)).to.equal('1min0s');
            expect(formatTranscriptExecutionTime(65000)).to.equal('1min5s');
            expect(formatTranscriptExecutionTime(125000)).to.equal('2min5s');
            expect(formatTranscriptExecutionTime(3600000)).to.equal('60min0s');
        });
    });

    describe('syncTranscriptToolExecutionTime', () => {
        let parent: HTMLElement;
        let chevron: HTMLElement;

        beforeEach(() => {
            parent = document.createElement('summary');
            chevron = document.createElement('span');
            chevron.className = 'theia-mobile-agent-tool-pill-chevron';
            parent.append(chevron);
            document.body.append(parent);
        });

        afterEach(() => {
            parent.remove();
        });

        it('does not mount a chip when not running', () => {
            syncTranscriptToolExecutionTime(parent, chevron, Date.now() - 500, false);
            expect(parent.querySelector('.theia-mobile-agent-lobe-exec-time')).to.equal(null);
        });

        it('does not mount a chip when startedAt is undefined', () => {
            syncTranscriptToolExecutionTime(parent, chevron, undefined, true);
            expect(parent.querySelector('.theia-mobile-agent-lobe-exec-time')).to.equal(null);
        });

        it('mounts a chip before the chevron when running', () => {
            const startedAt = Date.now() - 250;
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            expect(chip?.textContent).to.match(/^\(\d+ms\)$/);
            // Chip must sit before the chevron.
            expect(chip?.nextElementSibling).to.equal(chevron);
        });

        it('appends the chip when beforeEl is not a child of parent', () => {
            const orphan = document.createElement('span');
            syncTranscriptToolExecutionTime(parent, orphan, Date.now(), true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            expect(chip?.nextElementSibling).to.equal(null);
        });

        it('removes the chip and clears the timer when transitioning to finished', () => {
            const startedAt = Date.now() - 300;
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, true);
            const chip = parent.querySelector('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, false);
            expect(parent.querySelector('.theia-mobile-agent-lobe-exec-time')).to.equal(null);
        });

        it('updates elapsed text on interval tick', done => {
            const startedAt = Date.now();
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            // Wait >100ms for at least one tick.
            setTimeout(() => {
                const tickedText = chip?.textContent ?? '';
                expect(tickedText).to.not.equal('');
                // The chip should still show a parenthesised duration.
                expect(tickedText).to.match(/^\(\d+(\.\d)?(ms|s|min\d+s)\)$/);
                // Clean up.
                syncTranscriptToolExecutionTime(parent, chevron, startedAt, false);
                done();
            }, 180);
        });

        it('self-cleans the timer when the chip is removed from the DOM', done => {
            const startedAt = Date.now();
            syncTranscriptToolExecutionTime(parent, chevron, startedAt, true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip).to.not.equal(null);
            // Remove the chip from the DOM without going through sync.
            chip?.remove();
            // Wait >100ms — the interval should detect disconnection and stop.
            setTimeout(() => {
                // No throw, no lingering chip. Re-syncing should still work.
                syncTranscriptToolExecutionTime(parent, chevron, startedAt, false);
                expect(parent.querySelector('.theia-mobile-agent-lobe-exec-time')).to.equal(null);
                done();
            }, 180);
        });

        it('re-bases the timer when re-synced with a new startedAt', done => {
            const firstStart = Date.now() - 1000;
            syncTranscriptToolExecutionTime(parent, chevron, firstStart, true);
            const chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip?.textContent).to.match(/^\(1\.0s\)$/);
            // Re-sync with a much earlier start — elapsed should jump.
            const earlierStart = Date.now() - 5000;
            syncTranscriptToolExecutionTime(parent, chevron, earlierStart, true);
            const chip2 = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
            expect(chip2?.textContent).to.match(/^\(5\.0s\)$/);
            syncTranscriptToolExecutionTime(parent, chevron, earlierStart, false);
            done();
        });
    });

    // These helpers referenced the class-name constants without importing them, so the first
    // streaming tool pill threw a ReferenceError instead of rendering its placeholder / stream body.
    describe('tool pill streaming bodies', () => {
        type ToolSegment = Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
        const toolSegment = (patch: Partial<ToolSegment>): ToolSegment => ({ type: 'tool', name: 'Bash', ...patch }) as ToolSegment;
        const ctx = {
            createTranscriptToolSpeculativePlaceholder: () => createTranscriptToolSpeculativePlaceholderExtracted(ctx),
            resolversUi: { formatTranscriptToolResult: (text: string) => text },
        } as unknown as MobileProjectsTranscriptMessagesToolUiContext;

        it('adds and removes the speculative placeholder', () => {
            const body = document.createElement('div');
            ensureTranscriptToolSpeculativePlaceholderExtracted(ctx, body, toolSegment({ finished: false }));
            expect(body.querySelector('.' + TRANSCRIPT_TOOL_SPECULATIVE_CLASS)).to.not.equal(null);
            ensureTranscriptToolSpeculativePlaceholderExtracted(ctx, body, toolSegment({ finished: true }));
            expect(body.querySelector('.' + TRANSCRIPT_TOOL_SPECULATIVE_CLASS)).to.equal(null);
        });

        it('creates and patches the result stream body', () => {
            const body = document.createElement('div');
            body.append(createTranscriptToolResultStreamBodyExtracted(ctx, 'one'));
            expect(body.querySelector('.' + TRANSCRIPT_TOOL_RESULT_STREAM_CLASS)?.textContent).to.equal('one');
            expect(patchTranscriptToolResultStreamBodyExtracted(ctx, body, toolSegment({ result: 'one two' }))).to.equal(true);
            expect(body.querySelector('.' + TRANSCRIPT_TOOL_RESULT_STREAM_CLASS)?.textContent).to.equal('one two');
        });
    });
});
