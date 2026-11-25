// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectsTranscriptMessagesToolUiContext } from './mobile-projects-transcript-messages-tool-ui-context';
import { createTranscriptAgentFailureDialogExtracted } from './mobile-projects-transcript-messages-tool-ui-render';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { localizeAgentFailureMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';

disableImportJSDOM();

/**
 * The pre-spawn sign-in guard refuses a send with a line that names the harness and the model. The failure card
 * keeps that line as its message and keeps the Sign in card; a probe that could not answer also offers a retry.
 */
describe('failure card for the pre-spawn sign-in guard', () => {

    useSuiteJSDOM();

    const ctx = {
        appendTranscriptShellSummaryTail: () => undefined,
        contentUi: { cleanTranscriptDisplayText: (text: string) => text },
        createTranscriptAgentAuthLoginCard: () => {
            const card = document.createElement('div');
            card.className = 'theia-test-auth-card';
            return card;
        },
    } as unknown as MobileProjectsTranscriptMessagesToolUiContext;

    const message = (card: HTMLElement): string | null | undefined => card.querySelector('.theia-mobile-agent-turn-failure-message')?.textContent;
    const retryButton = (card: HTMLElement): HTMLButtonElement | null => card.querySelector<HTMLButtonElement>('.theia-mobile-agent-turn-failure-retry');

    it('shows the concrete refusal with the Sign in card instead of the generic sign-in copy', () => {
        const raw = 'Sign in to Codex to use gpt-5.5.';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw);
        expect(message(card)).to.equal('Sign in to Codex to use gpt-5.5.');
        expect(card.querySelector('.theia-test-auth-card')).to.not.equal(null);
        expect(card.textContent).to.not.contain('This agent needs you to sign in');
    });

    it('offers a retry for "Couldn\'t confirm your sign-in" when a retry is wired', () => {
        const raw = 'Couldn\'t confirm your sign-in to Codex; try again.';
        let retried = 0;
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw, { onRetry: () => { retried++; } });
        expect(message(card)).to.equal('Couldn\'t confirm your sign-in to Codex; try again.');
        const button = retryButton(card);
        expect(button).to.not.equal(null);
        button!.click();
        expect(retried).to.equal(1);
    });

    it('omits the retry for "Couldn\'t confirm your sign-in" when no retry is wired', () => {
        const raw = 'Couldn\'t confirm your sign-in to Codex; try again.';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw);
        expect(retryButton(card)).to.equal(null);
    });

    it('offers no retry for a plain sign-in refusal, which needs the sign-in first', () => {
        const raw = 'Sign in to Codex to use gpt-5.5.';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw, { onRetry: () => undefined });
        expect(retryButton(card)).to.equal(null);
    });
});

/**
 * A failed turn's persisted error is the app's limit copy: its card is the quota card, with the copy as its
 * detail. A turn that succeeded is not drawn here at all (see qaap-agent-turn-outcome); this card is only for
 * a turn that failed.
 */
describe('failure card for a persisted limit copy', () => {

    useSuiteJSDOM();

    const ctx = {
        appendTranscriptShellSummaryTail: () => undefined,
        contentUi: { cleanTranscriptDisplayText: (text: string) => text },
        createTranscriptAgentAuthLoginCard: () => document.createElement('div'),
    } as unknown as MobileProjectsTranscriptMessagesToolUiContext;

    it('renders the quota card for the persisted quota copy of a failed turn', () => {
        const copy = localizeAgentFailureMessage('quota');
        const card = createTranscriptAgentFailureDialogExtracted(ctx, copy, copy);
        expect(card.classList.contains('theia-mod-quota-limit')).to.equal(true);
    });

    it('still renders the quota card for a real provider insufficient_quota', () => {
        const raw = '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw);
        expect(card.classList.contains('theia-mod-quota-limit')).to.equal(true);
    });
});

/**
 * A harness whose provider account is signed in but has no credits, or has the model switched off, gets a billing
 * card: the clean copy with the provider's own link, never the Sign in card, and the raw CLI lines only in details.
 */
describe('failure card for a provider billing failure', () => {

    useSuiteJSDOM();

    const ctx = {
        appendTranscriptShellSummaryTail: () => undefined,
        contentUi: { cleanTranscriptDisplayText: (text: string) => text },
        createTranscriptAgentAuthLoginCard: () => {
            const card = document.createElement('div');
            card.className = 'theia-test-auth-card';
            return card;
        },
        createTranscriptClampedPre: (text: string) => {
            const pre = document.createElement('pre');
            pre.className = 'theia-test-technical';
            pre.textContent = text;
            return pre;
        },
    } as unknown as MobileProjectsTranscriptMessagesToolUiContext;

    const MODELS_URL = 'https://opencode.ai/console/wrk_01KFXW8JT3MNFG0P5H21F14TVD/models';
    const RAW = [
        'timestamp=2026-11-25T22:33:03.402Z level=ERROR run=6f18df17 message="stream error" providerID=opencode modelID=gpt-5.4-nano '
        + 'session.id=ses_a small=true agent=title mode=primary error.error="AI_APICallError: Insufficient balance. This request is pay-as-you-go, '
        + 'billed to OpenCode Models credits. Top up at https://opencode.ai/console/wrk_01KFXW8JT3MNFG0P5H21F14TVD/billing?credits=1. '
        + 'OpenCode Go covers only requests to the OpenCode Go provider."',
        'timestamp=2026-11-25T22:33:13.809Z level=ERROR run=6f18df17 message="stream error" providerID=opencode modelID=claude-fable-5 '
        + `session.id=ses_a small=false agent=build mode=primary error.error="AI_APICallError: Model access is disabled. Change model access at ${MODELS_URL}."`,
    ].join('\n');

    it('shows the clean copy and a link to the provider\'s model-access page instead of a Sign in card', () => {
        const persisted = `Access to this model is disabled in your OpenCode account. Enable it at ${MODELS_URL}, or pick another model.`;
        const opened: string[] = [];
        let signInOpened = 0;
        const card = createTranscriptAgentFailureDialogExtracted(ctx, persisted, RAW, {
            onOpenAuthUrl: url => { opened.push(url); },
            onOpenAgentSignIn: () => { signInOpened++; },
            autoSignInTurn: { key: 'billing-turn', at: Date.now() },
            agentId: 'opencode',
        });
        expect(card.querySelector('.theia-test-auth-card')).to.equal(null);
        expect(card.classList.contains('theia-mod-auth-login')).to.equal(false);
        expect(card.classList.contains('theia-mod-provider-billing')).to.equal(true);
        expect(card.querySelector('.theia-mobile-agent-shell-title')?.textContent).to.equal('Model access disabled');
        expect(card.querySelector('.theia-mobile-agent-turn-failure-message')?.textContent).to.equal(persisted);
        expect(card.textContent).to.not.contain('Sign in required');
        const link = card.querySelector<HTMLButtonElement>('.theia-mod-primary');
        expect(link?.textContent).to.equal('Manage model access');
        link!.click();
        expect(opened).to.deep.equal([MODELS_URL]);
        expect(signInOpened).to.equal(0);
        // The raw provider lines stay available in the card's details.
        expect(card.querySelector('.theia-test-technical')?.textContent).to.contain('Model access is disabled');
    });

    it('also fixes an older turn whose persisted copy wrongly asked for a sign-in', () => {
        const legacy = 'This agent needs you to sign in before it can continue. Open the agent terminal to complete login, then retry.';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, legacy, RAW, { agentId: 'opencode' });
        expect(card.querySelector('.theia-test-auth-card')).to.equal(null);
        expect(card.querySelector('.theia-mobile-agent-turn-failure-message')?.textContent)
            .to.equal(`Access to this model is disabled in your OpenCode account. Enable it at ${MODELS_URL}, or pick another model.`);
    });
});
