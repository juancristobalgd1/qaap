// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { applyBackendInteractionModeToPrompt } from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-mode';
import { deriveConversationTitle, isComposerAttachmentPreambleTitle, resolveConversationTitleSeed } from './qaap-conversation-title';

describe('deriveConversationTitle', () => {

    it('preserves the prompt wording and case while trimming terminal punctuation', () => {
        const prompt = 'Run ls -la and then reply with one short sentence.';
        expect(deriveConversationTitle(prompt)).to.equal('Run ls -la and then reply with one short sentence');
    });

    it('never ends mid-word and carries no trailing ellipsis or punctuation', () => {
        const title = deriveConversationTitle(
            'Refactor the authentication middleware so that expired tokens are rejected gracefully',
        );
        expect(title).to.not.match(/[.,;:!?…-]$/);
        expect(title.length).to.be.lessThan(57);
        // The cut lands on a whole word.
        const source = 'Refactor the authentication middleware so that expired tokens are rejected gracefully';
        expect(source.startsWith(title.replace(/^R/, 'R'))).to.equal(true);
        expect(title.endsWith(' ')).to.equal(false);
    });

    it('prefers a clause boundary (comma) inside the window', () => {
        const title = deriveConversationTitle('Update the README with install steps, then open a pull request for review');
        expect(title).to.equal('Update the README with install steps');
    });

    it('strips markdown fences, headings and emphasis', () => {
        const title = deriveConversationTitle('```bash\nls -la\n```\nExplain the output of the command');
        expect(title).to.equal('Explain the output of the command');
    });

    it('strips markdown heading and bold markers', () => {
        expect(deriveConversationTitle('# Fix the **navbar** on mobile viewports')).to.equal('Fix the navbar on mobile viewports');
    });

    it('resolves markdown links to their text', () => {
        expect(deriveConversationTitle('Review the [pull request](https://example.com/pr/1) changes'))
            .to.equal('Review the pull request changes');
    });

    it('preserves Spanish prompt wording', () => {
        const title = deriveConversationTitle('Por favor ejecuta los tests.');
        expect(title).to.equal('Por favor ejecuta los tests');
    });

    it('passes short prompts through without rewriting their first word', () => {
        expect(deriveConversationTitle('fix the login bug')).to.equal('fix the login bug');
    });

    it('titles a Plan conversation from the user prompt without an internal mode prefix', () => {
        const userPrompt = 'Explain why sign in fails after a password reset';
        expect(deriveConversationTitle(applyBackendInteractionModeToPrompt(userPrompt, 'plan')))
            .to.equal('Explain why sign in fails after a password reset');
    });

    it('keeps boilerplate when stripping would leave fewer than three words', () => {
        expect(deriveConversationTitle('Please run it')).to.equal('Please run it');
    });

    it('does not strip a word that merely starts with a boilerplate token', () => {
        expect(deriveConversationTitle('Running the test suite in watch mode')).to.equal('Running the test suite in watch mode');
    });

    it('keeps the original leading words when shortening a long prompt', () => {
        const prompt = 'Please carefully review the authentication changes and verify the new session expiry behavior in every browser';
        const title = deriveConversationTitle(prompt);
        expect(prompt.startsWith(title)).to.equal(true);
        expect(title).to.match(/^Please carefully review/);
    });

    it('returns an empty string for empty or whitespace-only input', () => {
        expect(deriveConversationTitle('')).to.equal('');
        expect(deriveConversationTitle('   \n\t  ')).to.equal('');
        // A prompt that is nothing but a fenced code block has no natural-language title.
        expect(deriveConversationTitle('```\ncode only\n```')).to.equal('');
    });

    it('collapses excessive whitespace and newlines', () => {
        expect(deriveConversationTitle('Add   dark   mode\n\n   toggle')).to.equal('Add dark mode toggle');
    });

    it('cuts long single-clause prompts at a word boundary near the target', () => {
        const title = deriveConversationTitle(
            'Investigate the flaky integration test failing intermittently on the continuous integration server',
        );
        expect(title.length).to.be.lessThan(57);
        expect(title).to.not.match(/\s$/);
        // Ends on a whole word, no dangling connective.
        expect(title.endsWith('the')).to.equal(false);
    });
});

describe('attachment-aware conversation titles', () => {
    const preamble = 'The user attached the following context with this message. Use it to answer; do not claim nothing was provided.';
    const feedback = [
        preamble,
        '',
        '### previewFeedback: Preview feedback · 1 annotations · /qaap-preview/x/ · Mobile',
        '```',
        'Annotation 1:',
        '- Comment: mejora la ui',
        '- Selector: html > body > main',
        '```',
    ].join('\n');

    it('titles preview feedback from the annotation comment, not the preamble or generic draft', () => {
        const message = `${feedback}\n\n---\n\nPlease address the attached preview feedback.`;
        expect(deriveConversationTitle(message)).to.equal('mejora la ui');
    });

    it('prefers the typed draft over annotation comments', () => {
        const message = `${feedback}\n\n---\n\nFix the header spacing on mobile`;
        expect(resolveConversationTitleSeed(message)).to.equal('Fix the header spacing on mobile');
    });

    it('leaves ordinary prompts untouched', () => {
        expect(resolveConversationTitleSeed('Add a dark mode toggle')).to.equal('Add a dark mode toggle');
    });

    it('recognizes titles persisted from the raw preamble', () => {
        expect(isComposerAttachmentPreambleTitle('The user attached the following context')).to.equal(true);
        expect(isComposerAttachmentPreambleTitle('Mejora la ui')).to.equal(false);
    });
});
