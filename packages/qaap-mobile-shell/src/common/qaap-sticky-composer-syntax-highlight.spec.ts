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
});
