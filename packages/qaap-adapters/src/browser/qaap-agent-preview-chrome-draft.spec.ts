// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { mountEmbeddedAgentPreviewChrome, type EmbeddedAgentPreviewChrome } from './qaap-agent-preview-chrome';

disableImportJSDOM();

describe('mountEmbeddedAgentPreviewChrome URL draft persistence', () => {
    let disableJSDOM: (() => void) | undefined;
    let restoreJsdomGaps: (() => void) | undefined;
    const mounted: EmbeddedAgentPreviewChrome[] = [];

    before(() => {
        disableJSDOM = enableJSDOM();
        restoreJsdomGaps = stubJsdomGaps();
    });

    afterEach(() => {
        mounted.splice(0).forEach(chrome => chrome.dispose());
        document.body.replaceChildren();
    });

    after(() => {
        restoreJsdomGaps?.();
        restoreJsdomGaps = undefined;
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function stubJsdomGaps(): () => void {
        const restores: Array<() => void> = [];
        const frameProto = window.HTMLIFrameElement.prototype;
        if (!('sandbox' in frameProto)) {
            const tokens = new Set<string>();
            Object.defineProperty(frameProto, 'sandbox', {
                configurable: true,
                get: () => ({
                    add: (...items: string[]) => items.forEach(item => tokens.add(item)),
                    remove: (...items: string[]) => items.forEach(item => tokens.delete(item)),
                    contains: (item: string) => tokens.has(item),
                }),
            });
            restores.push(() => {
                delete (frameProto as unknown as Record<string, unknown>).sandbox;
            });
        }
        if (typeof window.matchMedia !== 'function') {
            const stub = (query: string): MediaQueryList => ({
                matches: false,
                media: query,
                onchange: undefined as unknown as MediaQueryList['onchange'],
                addListener: () => undefined,
                removeListener: () => undefined,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => false,
            });
            Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: stub });
            restores.push(() => {
                delete (window as unknown as Record<string, unknown>).matchMedia;
            });
        }
        return () => restores.forEach(restore => restore());
    }

    it('preserves an uncommitted URL draft across blur, iframe load, and programmatic setUrl', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const navEvents: Array<{ url: string; source?: string }> = [];
        const chrome = mountEmbeddedAgentPreviewChrome(host, {
            url: 'http://localhost:5173/',
            onNavigate: (url, meta) => navEvents.push({ url, source: meta?.source }),
        });
        mounted.push(chrome);

        const input = chrome.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input')!;
        expect(chrome.hasUnsavedUrlDraft()).to.equal(false);
        expect(navEvents[0].source).to.equal('programmatic');

        // User starts typing a new URL, then transiently blurs (e.g. clicking a popover or switching windows).
        input.focus();
        input.value = 'http://localhost:5173/settings';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        input.blur();

        expect(chrome.hasUnsavedUrlDraft()).to.equal(true);
        expect(input.value).to.equal('http://localhost:5173/settings');

        // Background iframe load or programmatic setUrl must NOT wipe the user's draft.
        chrome.frame.dispatchEvent(new window.Event('load'));
        chrome.setUrl('http://localhost:5173/other');
        expect(input.value).to.equal('http://localhost:5173/settings');
        expect(chrome.hasUnsavedUrlDraft()).to.equal(true);

        // Escape reverts to the committed URL and clears the dirty latch.
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(chrome.hasUnsavedUrlDraft()).to.equal(false);
        expect(input.value).to.equal('http://localhost/qaap-dev/5173/other');
    });

    it('commits a typed URL on Enter with source="user" and clears the dirty latch', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const navEvents: Array<{ url: string; source?: string }> = [];
        const chrome = mountEmbeddedAgentPreviewChrome(host, {
            url: 'http://localhost:5173/',
            onNavigate: (url, meta) => navEvents.push({ url, source: meta?.source }),
        });
        mounted.push(chrome);

        const input = chrome.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input')!;
        input.focus();
        input.value = 'http://localhost:5173/dashboard';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(chrome.hasUnsavedUrlDraft()).to.equal(false);
        expect(navEvents[navEvents.length - 1]).to.deep.equal({
            url: 'http://localhost/qaap-dev/5173/dashboard',
            source: 'user',
        });
    });
});
