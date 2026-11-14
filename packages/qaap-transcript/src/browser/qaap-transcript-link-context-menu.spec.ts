// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { installTranscriptLinkContextMenu, resolveTranscriptLinkUrl } from './qaap-transcript-link-context-menu';

disableImportJSDOM();

describe('transcript link context menu', () => {

    useSuiteJSDOM();

    const mountTranscriptLink = (href: string): HTMLAnchorElement => {
        document.body.innerHTML = `<div class="theia-mobile-agent-transcript"><p>See <a href="${href}">the docs</a></p></div><a id="outside" href="https://outside.example">x</a>`;
        return document.querySelector<HTMLAnchorElement>('.theia-mobile-agent-transcript a')!;
    };
    const menuLabels = (): string[] => Array.from(document.querySelectorAll('.qaap-transcript-link-menu-item')).map(item => item.textContent ?? '');

    it('resolves only http(s) links inside the transcript', () => {
        const link = mountTranscriptLink('https://example.com/docs');
        expect(resolveTranscriptLinkUrl(link)).to.equal('https://example.com/docs');
        expect(resolveTranscriptLinkUrl(document.getElementById('outside'))).to.equal(undefined);
        mountTranscriptLink('mailto:someone@example.com');
        expect(resolveTranscriptLinkUrl(document.querySelector('.theia-mobile-agent-transcript a'))).to.equal(undefined);
    });

    it('right-click opens the three actions and each one runs with the link URL', async () => {
        const link = mountTranscriptLink('https://example.com/docs');
        const opened: string[] = [];
        const system: string[] = [];
        const copied: string[] = [];
        const handle = installTranscriptLinkContextMenu(document, {
            openInIntegratedBrowser: url => opened.push(url),
            openInSystemBrowser: url => system.push(url),
            copyText: async text => { copied.push(text); },
        });
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
        link.dispatchEvent(event);
        expect(event.defaultPrevented, 'the browser menu is replaced').to.equal(true);
        expect(menuLabels()).to.deep.equal(['Open in integrated browser', 'Open in system browser', 'Copy Link']);

        (document.querySelectorAll<HTMLButtonElement>('.qaap-transcript-link-menu-item')[2]).click();
        await Promise.resolve();
        expect(copied).to.deep.equal(['https://example.com/docs']);
        expect(document.querySelector('.qaap-transcript-link-menu'), 'a choice closes the menu').to.equal(null);

        link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        (document.querySelectorAll<HTMLButtonElement>('.qaap-transcript-link-menu-item')[0]).click();
        link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        (document.querySelectorAll<HTMLButtonElement>('.qaap-transcript-link-menu-item')[1]).click();
        expect(opened).to.deep.equal(['https://example.com/docs']);
        expect(system).to.deep.equal(['https://example.com/docs']);
        handle.dispose();
    });

    it('leaves links outside the transcript to the browser and hides the integrated item without a handler', () => {
        mountTranscriptLink('https://example.com/docs');
        const handle = installTranscriptLinkContextMenu(document, {});
        const outside = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        document.getElementById('outside')!.dispatchEvent(outside);
        expect(outside.defaultPrevented).to.equal(false);
        expect(document.querySelector('.qaap-transcript-link-menu')).to.equal(null);

        document.querySelector('.theia-mobile-agent-transcript a')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        expect(menuLabels()).to.deep.equal(['Open in system browser', 'Copy Link']);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('.qaap-transcript-link-menu'), 'Escape closes it').to.equal(null);
        handle.dispose();
    });
});
