// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { Disposable } from '@theia/core/lib/common/disposable';
import {
    isPreviewSlotOccludedByOverlay,
    registerQaapNativeBrowserBridge,
    type QaapNativeBrowserBridge,
} from './qaap-native-browser-bridge';
import type {
    QaapNativeBrowserBounds,
    QaapNativeBrowserStateEvent,
} from '../common/qaap-native-browser-protocol';
import { mountEmbeddedAgentPreviewChrome, type EmbeddedAgentPreviewChrome } from './qaap-agent-preview-chrome';

disableImportJSDOM();

class FakeNativeBrowserBridge implements QaapNativeBrowserBridge {
    readonly ensured: Array<{ viewId: string; url?: string }> = [];
    readonly navigated: Array<{ viewId: string; url: string; hard?: boolean }> = [];
    readonly boundsCalls: Array<{ viewId: string; bounds: QaapNativeBrowserBounds; visible: boolean }> = [];
    readonly backCalls: string[] = [];
    readonly forwardCalls: string[] = [];
    readonly reloadCalls: Array<{ viewId: string; hard?: boolean }> = [];
    readonly destroyed: string[] = [];
    private readonly listeners = new Map<string, Set<(event: QaapNativeBrowserStateEvent) => void>>();

    async ensureView(viewId: string, url?: string): Promise<QaapNativeBrowserStateEvent> {
        this.ensured.push({ viewId, url });
        return { viewId, url: url ?? '', loading: false, canGoBack: false, canGoForward: false };
    }

    async navigate(viewId: string, url: string, options?: { readonly hard?: boolean }): Promise<void> {
        this.navigated.push({ viewId, url, hard: options?.hard });
    }

    async setBounds(viewId: string, bounds: QaapNativeBrowserBounds, visible: boolean): Promise<void> {
        this.boundsCalls.push({ viewId, bounds, visible });
    }

    async goBack(viewId: string): Promise<void> {
        this.backCalls.push(viewId);
    }

    async goForward(viewId: string): Promise<void> {
        this.forwardCalls.push(viewId);
    }

    async reload(viewId: string, hard?: boolean): Promise<void> {
        this.reloadCalls.push({ viewId, hard });
    }

    async focus(): Promise<void> { /* noop */ }
    async openDevTools(): Promise<void> { /* noop */ }

    async destroyView(viewId: string): Promise<void> {
        this.destroyed.push(viewId);
    }

    subscribe(viewId: string, listener: (event: QaapNativeBrowserStateEvent) => void): Disposable {
        let set = this.listeners.get(viewId);
        if (!set) {
            set = new Set();
            this.listeners.set(viewId, set);
        }
        set.add(listener);
        return { dispose: () => set?.delete(listener) };
    }

    emit(event: QaapNativeBrowserStateEvent): void {
        for (const listener of this.listeners.get(event.viewId) ?? []) {
            listener(event);
        }
    }
}

describe('mountEmbeddedAgentPreviewChrome with Electron native WebContentsView bridge', () => {
    let disableJSDOM: (() => void) | undefined;
    let restoreJsdomGaps: (() => void) | undefined;
    let unregisterBridge: Disposable | undefined;
    const mounted: EmbeddedAgentPreviewChrome[] = [];

    before(() => {
        disableJSDOM = enableJSDOM();
        restoreJsdomGaps = stubJsdomGaps();
    });

    afterEach(() => {
        mounted.splice(0).forEach(chrome => chrome.dispose());
        unregisterBridge?.dispose();
        unregisterBridge = undefined;
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
            restores.push(() => { delete (frameProto as unknown as Record<string, unknown>).sandbox; });
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
            restores.push(() => { delete (window as unknown as Record<string, unknown>).matchMedia; });
        }
        return () => restores.forEach(restore => restore());
    }

    it('routes navigation, history, focus, and URL draft protection through the native bridge', async () => {
        const bridge = new FakeNativeBrowserBridge();
        unregisterBridge = registerQaapNativeBrowserBridge(bridge);

        const host = document.createElement('div');
        document.body.append(host);
        const chrome = mountEmbeddedAgentPreviewChrome(host, { url: 'https://example.com/' });
        mounted.push(chrome);

        expect(chrome.root.classList.contains('qaap-mod-native-browser')).to.equal(true);
        expect(chrome.frame.style.display).to.equal('none');
        expect(bridge.ensured).to.have.length(1);
        const viewId = bridge.ensured[0].viewId;
        expect(bridge.ensured[0].url).to.equal('https://example.com/');

        // Simulate Electron main pushing navigation + focus state.
        bridge.emit({
            viewId,
            url: 'https://example.com/docs',
            title: 'Example Docs',
            loading: false,
            canGoBack: true,
            canGoForward: false,
            focused: true,
        });
        expect(chrome.getCurrentUrl()).to.equal('https://example.com/docs');
        expect(chrome.isFrameFocused()).to.equal(true);
        const input = chrome.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input')!;
        expect(input.value).to.equal('https://example.com/docs');

        // User starts typing a new URL draft: native state events from Electron main must NOT clobber it.
        input.focus();
        input.value = 'https://github.com/open';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        input.blur();
        bridge.emit({
            viewId,
            url: 'https://example.com/docs?reloaded=1',
            loading: false,
            canGoBack: true,
            canGoForward: false,
            focused: false,
        });
        expect(input.value).to.equal('https://github.com/open');
        expect(chrome.hasUnsavedUrlDraft()).to.equal(true);

        // Back / Forward buttons forward to native WebContents history.
        const [backBtn, forwardBtn] = Array.from(chrome.root.querySelectorAll<HTMLButtonElement>('.qaap-agent-preview-embedded-toolbar > button'));
        expect(backBtn.disabled).to.equal(false);
        expect(forwardBtn.disabled).to.equal(true);
        backBtn.click();
        expect(bridge.backCalls).to.deep.equal([viewId]);

        // Reload and dispose forward cleanly.
        chrome.reload();
        expect(bridge.reloadCalls).to.deep.equal([{ viewId, hard: false }]);
        chrome.dispose();
        mounted.pop();
        expect(bridge.destroyed).to.deep.equal([viewId]);
    });

    it('detects when a renderer dialog or popover overlaps the browser slot', () => {
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.getBoundingClientRect = () => ({
            left: 700, top: 100, right: 1100, bottom: 500, width: 400, height: 400, x: 700, y: 100, toJSON: () => ({}),
        });
        document.body.append(dialog);

        const rightBrowserSlot = { left: 713, top: 120, right: 1192, bottom: 762, width: 479, height: 642 };
        expect(isPreviewSlotOccludedByOverlay(rightBrowserSlot, document)).to.equal(true);

        // An overlay on the far left sidebar does NOT occlude the right Browser slot.
        dialog.getBoundingClientRect = () => ({
            left: 10, top: 50, right: 260, bottom: 400, width: 250, height: 350, x: 10, y: 50, toJSON: () => ({}),
        });
        expect(isPreviewSlotOccludedByOverlay(rightBrowserSlot, document)).to.equal(false);

        // Hidden overlay never occludes.
        dialog.getBoundingClientRect = () => ({
            left: 700, top: 100, right: 1100, bottom: 500, width: 400, height: 400, x: 700, y: 100, toJSON: () => ({}),
        });
        dialog.hidden = true;
        expect(isPreviewSlotOccludedByOverlay(rightBrowserSlot, document)).to.equal(false);
    });
});
