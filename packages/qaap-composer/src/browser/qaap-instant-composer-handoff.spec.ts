// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { INSTANT_COMPOSER_DRAFT_KEY, INSTANT_WORK_HUB_SHELL_ID, adoptInstantComposerDraft } from './qaap-instant-composer-handoff';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('qaap-instant-composer-handoff', () => {

    useSuiteJSDOM();

    afterEach(() => {
        document.body.replaceChildren();
        window.sessionStorage.clear();
    });

    function paintInstantShell(text: string): HTMLTextAreaElement {
        const shell = document.createElement('div');
        shell.id = INSTANT_WORK_HUB_SHELL_ID;
        const input = document.createElement('textarea');
        input.value = text;
        shell.append(input);
        document.body.append(shell);
        window.sessionStorage.setItem(INSTANT_COMPOSER_DRAFT_KEY, text);
        return input;
    }

    function realComposer(value = ''): HTMLTextAreaElement {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        document.body.append(textarea);
        return textarea;
    }

    it('moves the typed text and focus into the real composer and removes the shell', () => {
        const instant = paintInstantShell('fix the login bug');
        instant.focus();
        const textarea = realComposer();
        const inputs: string[] = [];
        textarea.addEventListener('input', () => inputs.push(textarea.value));

        expect(adoptInstantComposerDraft(textarea)).to.equal(true);

        expect(textarea.value).to.equal('fix the login bug');
        expect(inputs).to.deep.equal(['fix the login bug']);
        expect(document.activeElement).to.equal(textarea);
        expect(document.getElementById(INSTANT_WORK_HUB_SHELL_ID)).to.equal(null);
        expect(window.sessionStorage.getItem(INSTANT_COMPOSER_DRAFT_KEY)).to.equal(null);
    });

    it('appends to a restored draft on its own line and leaves focus alone when the shell was not focused', () => {
        paintInstantShell('and add a test');
        const textarea = realComposer('fix the login bug');

        adoptInstantComposerDraft(textarea);

        expect(textarea.value).to.equal('fix the login bug\nand add a test');
        expect(document.activeElement).to.not.equal(textarea);
    });

    it('keeps the shell and its text while the real composer is still disabled', () => {
        paintInstantShell('draft');
        const textarea = realComposer();
        textarea.disabled = true;

        expect(adoptInstantComposerDraft(textarea)).to.equal(false);

        expect(textarea.value).to.equal('');
        expect(document.getElementById(INSTANT_WORK_HUB_SHELL_ID)).to.not.equal(null);
        expect(window.sessionStorage.getItem(INSTANT_COMPOSER_DRAFT_KEY)).to.equal('draft');
    });

    it('adopts a draft left in sessionStorage after the shell was released', () => {
        window.sessionStorage.setItem(INSTANT_COMPOSER_DRAFT_KEY, 'left behind');
        const textarea = realComposer();

        expect(adoptInstantComposerDraft(textarea)).to.equal(true);

        expect(textarea.value).to.equal('left behind');
        expect(window.sessionStorage.getItem(INSTANT_COMPOSER_DRAFT_KEY)).to.equal(null);
    });

    it('does nothing on later renders once the shell is gone', () => {
        const textarea = realComposer('kept');
        let inputs = 0;
        textarea.addEventListener('input', () => inputs++);

        expect(adoptInstantComposerDraft(textarea)).to.equal(false);

        expect(textarea.value).to.equal('kept');
        expect(inputs).to.equal(0);
    });
});
