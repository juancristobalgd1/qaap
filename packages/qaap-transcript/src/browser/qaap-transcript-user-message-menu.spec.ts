// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The menu module may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { QaapTranscriptUserMessageMenu } from './qaap-transcript-user-message-menu';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('QaapTranscriptUserMessageMenu', () => {

    useSuiteJSDOM();

    let wrap: HTMLElement;
    let actions: HTMLElement;
    let menu: QaapTranscriptUserMessageMenu | undefined;

    function createSourceButton(action: string, label: string, iconClass: string, disabled = false): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `theia-mobile-agent-transcript-user-action theia-mod-${action}`;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.disabled = disabled;
        button.innerHTML = `<span class="codicon ${iconClass}" aria-hidden="true"></span><span class="theia-mobile-agent-transcript-user-action-label">${label}</span>`;
        return button;
    }

    function openMenu(): HTMLElement {
        menu = new QaapTranscriptUserMessageMenu(wrap, actions);
        menu.open();
        const opened = document.querySelector<HTMLElement>('.theia-mobile-agent-transcript-user-menu');
        expect(opened).to.be.instanceOf(HTMLElement);
        return opened as HTMLElement;
    }

    beforeEach(() => {
        wrap = document.createElement('div');
        document.body.append(wrap);
        actions = document.createElement('div');
        actions.className = 'theia-mobile-agent-transcript-user-actions';
        actions.append(
            createSourceButton('edit', 'Edit', 'codicon-edit'),
            createSourceButton('copy', 'Copy', 'codicon-copy'),
            createSourceButton('retry', 'Retry', 'codicon-refresh'),
            createSourceButton('undo', 'Undo', 'codicon-discard', true),
        );
    });

    afterEach(() => {
        menu?.close();
        menu = undefined;
        wrap.remove();
    });

    it('renders a role=menu container with one role=menuitem per source action, in order', () => {
        const container = openMenu();
        expect(container.getAttribute('role')).to.equal('menu');
        const items = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
        expect(items.map(item => item.getAttribute('role'))).to.deep.equal(['menuitem', 'menuitem', 'menuitem', 'menuitem']);
        expect(items.map(item => item.getAttribute('aria-label'))).to.deep.equal(['Edit', 'Copy', 'Retry', 'Undo']);
    });

    it('shows icon-only items: no visible text label, only the codicon', () => {
        const container = openMenu();
        expect(container.querySelector('.theia-mobile-agent-transcript-user-menu-label')).to.equal(null);
        for (const item of Array.from(container.querySelectorAll<HTMLButtonElement>('button'))) {
            expect(item.textContent).to.equal('');
            expect(item.querySelectorAll('.codicon')).to.have.length(1);
        }
    });

    it('keeps the localized label as tooltip and sets the icon to aria-hidden', () => {
        const container = openMenu();
        const items = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
        expect(items.map(item => item.title)).to.deep.equal(['Edit', 'Copy', 'Retry', 'Undo']);
        for (const item of items) {
            expect(item.querySelector('.codicon')?.getAttribute('aria-hidden')).to.equal('true');
        }
    });

    it('propagates the disabled state of the source action', () => {
        const container = openMenu();
        const items = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
        expect(items.map(item => item.disabled)).to.deep.equal([false, false, false, true]);
    });

    it('forwards a click to the source button and closes the menu', () => {
        const container = openMenu();
        let clicked = false;
        actions.querySelector('.theia-mod-copy')?.addEventListener('click', () => clicked = true);
        const copyItem = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))[1];
        copyItem.click();
        expect(clicked).to.equal(true);
        expect(document.querySelectorAll('.theia-mobile-agent-transcript-user-menu')).to.have.length(0);
    });

    it('removes the menu from the document on close', () => {
        openMenu();
        expect(document.querySelectorAll('.theia-mobile-agent-transcript-user-menu')).to.have.length(1);
        menu?.close();
        expect(document.querySelectorAll('.theia-mobile-agent-transcript-user-menu')).to.have.length(0);
    });
});
