// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { deriveConversationTitle } from './qaap-conversation-title';

describe('deriveConversationTitle', () => {

    it('summarizes the task prompt and drops the leading imperative', () => {
        const title = deriveConversationTitle('Run ls -la and then reply with one short sentence.');
        // 'run' is stripped (remainder still >= 3 words); the remainder fits the target so only the
        // trailing period is trimmed and the first letter capitalized.
        expect(title).to.equal('Ls -la and then reply with one short sentence');
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

    it('handles a Spanish prompt and drops Spanish boilerplate', () => {
        const title = deriveConversationTitle('Por favor ejecuta el script de despliegue y verifica los logs.');
        expect(title).to.equal('El script de despliegue y verifica los logs');
    });

    it('passes short prompts through, only capitalizing', () => {
        expect(deriveConversationTitle('fix the login bug')).to.equal('Fix the login bug');
    });

    it('keeps boilerplate when stripping would leave fewer than three words', () => {
        expect(deriveConversationTitle('Please run it')).to.equal('Please run it');
    });

    it('does not strip a word that merely starts with a boilerplate token', () => {
        expect(deriveConversationTitle('Running the test suite in watch mode')).to.equal('Running the test suite in watch mode');
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
