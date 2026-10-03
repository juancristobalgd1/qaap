// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { clearComposerImproveFeedback, showComposerImproveFeedback } from './qaap-composer-prompt-improve-feedback';

describe('composer prompt improve feedback', () => {

    useSuiteJSDOM();

    it('reuses one feedback element with the real class name, then clears it', () => {
        const panel = document.createElement('div');
        panel.className = 'theia-mobile-projects-sticky-composer-input-panel';
        const anchor = document.createElement('button');
        panel.appendChild(anchor);
        document.body.appendChild(panel);
        try {
            showComposerImproveFeedback(anchor, 'first', 'error');
            showComposerImproveFeedback(anchor, 'second', 'info');
            const items = panel.querySelectorAll<HTMLElement>('.qaap-composer-improve-feedback');
            expect(items).to.have.length(1);
            expect(items[0].className).to.not.contain('.');
            expect(items[0].textContent).to.equal('second');
            expect(items[0].classList.contains('theia-mod-info')).to.equal(true);
            clearComposerImproveFeedback(anchor);
            expect(items[0].hidden).to.equal(true);
            expect(items[0].textContent).to.equal('');
        } finally {
            panel.remove();
        }
    });
});
