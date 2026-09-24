// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { attachStickyComposerSyntaxHighlight } from './qaap-sticky-composer-syntax-highlight';

describe('qaap-sticky-composer-syntax-highlight', () => {

    before(() => {
        enableJSDOM();
    });

    it('highlights known /skill-name tokens in the mirror layer', () => {
        const inputEditor = document.createElement('div');
        const input = document.createElement('textarea');
        inputEditor.append(input);
        document.body.append(inputEditor);

        const ui = attachStickyComposerSyntaxHighlight({
            inputEditor,
            input,
            getSkillNames: () => ['react-doctor'],
        });

        input.value = 'please /react-doctor review this';
        ui.refresh();

        const highlight = inputEditor.querySelector('.theia-mobile-projects-sticky-composer-input-highlight');
        expect(highlight?.innerHTML).to.contain('theia-mod-token-skill');
        expect(highlight?.textContent).to.contain('/react-doctor');
    });

    it('highlights known slash commands in the mirror layer', () => {
        const inputEditor = document.createElement('div');
        const input = document.createElement('textarea');
        inputEditor.append(input);
        document.body.append(inputEditor);

        const ui = attachStickyComposerSyntaxHighlight({
            inputEditor,
            input,
            getSlashCommandNames: () => ['loop'],
        });

        input.value = '/loop run this until it passes';
        ui.refresh();

        const highlight = inputEditor.querySelector('.theia-mobile-projects-sticky-composer-input-highlight');
        expect(highlight?.innerHTML).to.contain('theia-mod-token-slash-command');
        expect(highlight?.textContent).to.contain('/loop');
    });

    it('prefers skill highlighting when a token is also listed as a slash command', () => {
        const inputEditor = document.createElement('div');
        const input = document.createElement('textarea');
        inputEditor.append(input);
        document.body.append(inputEditor);

        const ui = attachStickyComposerSyntaxHighlight({
            inputEditor,
            input,
            getSkillNames: () => ['karpathy-skills'],
            // Slash menu also lists skills; those must not steal the chip class.
            getSlashCommandNames: () => ['karpathy-skills', 'fork'],
        });

        input.value = '/karpathy-skills';
        ui.refresh();

        const highlight = inputEditor.querySelector('.theia-mobile-projects-sticky-composer-input-highlight');
        expect(highlight?.innerHTML).to.contain('theia-mod-token-skill');
        expect(highlight?.innerHTML).not.to.contain('theia-mod-token-slash-command');
    });

    it('clears the mirror layer when the textarea value is cleared programmatically', () => {
        const inputEditor = document.createElement('div');
        const input = document.createElement('textarea');
        inputEditor.append(input);
        document.body.append(inputEditor);

        const ui = attachStickyComposerSyntaxHighlight({
            inputEditor,
            input,
            getSkillNames: () => ['react-doctor'],
        });

        ui.syncInputValue('Interfaz cli terminal');
        const highlight = inputEditor.querySelector('.theia-mobile-projects-sticky-composer-input-highlight');
        expect(highlight?.textContent).to.contain('Interfaz cli terminal');

        ui.syncInputValue('');
        expect(input.value).to.equal('');
        expect(highlight?.textContent).to.equal('');
    });

    it('keeps the textarea caret-only and disables spellcheck while attached', () => {
        const inputEditor = document.createElement('div');
        const input = document.createElement('textarea');
        input.spellcheck = true;
        inputEditor.append(input);
        document.body.append(inputEditor);

        const ui = attachStickyComposerSyntaxHighlight({
            inputEditor,
            input,
            getSkillNames: () => ['karpathy-skills'],
        });

        expect(input.classList.contains('theia-mod-highlight-input')).to.equal(true);
        expect(input.spellcheck).to.equal(false);

        ui.dispose();
        expect(input.classList.contains('theia-mod-highlight-input')).to.equal(false);
        expect(input.spellcheck).to.equal(true);
    });
});
