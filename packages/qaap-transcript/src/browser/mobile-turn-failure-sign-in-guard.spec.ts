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
