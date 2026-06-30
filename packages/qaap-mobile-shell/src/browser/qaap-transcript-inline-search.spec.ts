// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { attachTranscriptInlineSearch } from './qaap-transcript-inline-search';

describe('qaap-transcript-inline-search', () => {

    beforeEach(() => {
        if (typeof HTMLElement === 'undefined') {
            enableJSDOM();
        }
        HTMLElement.prototype.scrollIntoView = () => undefined;
    });

    it('opens with Ctrl+F and marks matching transcript rows', () => {
        const mount = document.createElement('div');
        const scroller = document.createElement('div');
        const first = document.createElement('div');
        first.setAttribute('data-transcript-message-id', 'm1');
        first.textContent = 'Alpha result';
        const second = document.createElement('div');
        second.setAttribute('data-transcript-message-id', 'm2');
        second.textContent = 'Beta result';
        scroller.append(first, second);
        mount.append(scroller);
        document.body.append(mount);

        const disposable = attachTranscriptInlineSearch(mount, scroller);
        scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));

        const search = mount.querySelector<HTMLFormElement>('.theia-mobile-agent-transcript-search');
        const input = search?.querySelector<HTMLInputElement>('input');
        expect(search?.hidden).to.equal(false);
        expect(input).to.not.equal(undefined);

        input!.value = 'beta';
        input!.dispatchEvent(new window.Event('input', { bubbles: true }));

        expect(first.classList.contains('theia-mod-search-match')).to.equal(false);
        expect(second.classList.contains('theia-mod-search-match')).to.equal(true);
        expect(second.classList.contains('theia-mod-search-current')).to.equal(true);

        disposable.dispose();
    });

    it('clears matches when closed with Escape', () => {
        const mount = document.createElement('div');
        const scroller = document.createElement('div');
        const row = document.createElement('div');
        row.setAttribute('data-transcript-message-id', 'm1');
        row.textContent = 'Needle';
        scroller.append(row);
        mount.append(scroller);
        document.body.append(mount);

        const disposable = attachTranscriptInlineSearch(mount, scroller);
        scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
        const input = mount.querySelector<HTMLInputElement>('.theia-mobile-agent-transcript-search input')!;
        input.value = 'needle';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        expect(row.classList.contains('theia-mod-search-match')).to.equal(true);

        scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(row.classList.contains('theia-mod-search-match')).to.equal(false);
        expect(mount.querySelector<HTMLFormElement>('.theia-mobile-agent-transcript-search')?.hidden).to.equal(true);
        disposable.dispose();
    });

    it('refreshes its index when transcript rows stream in', async () => {
        const mount = document.createElement('div');
        const scroller = document.createElement('div');
        mount.append(scroller);
        document.body.append(mount);

        const disposable = attachTranscriptInlineSearch(mount, scroller);
        scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));

        const input = mount.querySelector<HTMLInputElement>('.theia-mobile-agent-transcript-search input')!;
        input.value = 'fresh';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        const row = document.createElement('div');
        row.setAttribute('data-transcript-message-id', 'm2');
        row.textContent = 'Fresh streamed result';
        scroller.append(row);
        await new Promise(resolve => setTimeout(resolve, 0));

        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        expect(row.classList.contains('theia-mod-search-match')).to.equal(true);

        disposable.dispose();
    });
});
