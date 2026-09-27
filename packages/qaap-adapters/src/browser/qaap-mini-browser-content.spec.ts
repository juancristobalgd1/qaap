// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { getQaapPreviewFrameSlot } from './qaap-mini-browser-frame-lifecycle';
import { QAAP_PREVIEW_FRAME_SUSPEND_DELAY_MS, QaapMiniBrowserContent } from './qaap-mini-browser-content';

disableJSDOM();

describe('Qaap mini-browser frame lifecycle', () => {

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('defers annotation mounting while the base constructor has not assigned the frame', () => {
        expect(getQaapPreviewFrameSlot(undefined)).to.equal(undefined);
    });

    it('returns the frame slot after content-area construction', () => {
        const frameSlot = document.createElement('div');
        const frame = document.createElement('iframe');
        frameSlot.append(frame);
        expect(getQaapPreviewFrameSlot(frame)).to.equal(frameSlot);
    });
});

interface SuspendTestContent {
    suspendPreviewFrame(options?: { readonly immediate?: boolean }): void;
    resumePreviewFrame(): void;
}

describe('Qaap mini-browser preview frame suspension', () => {

    let timers: Map<number, () => void>;
    let goCalls: string[];
    let frame: HTMLIFrameElement;
    let originalSetTimeout: typeof window.setTimeout;
    let originalClearTimeout: typeof window.clearTimeout;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        timers = new Map();
        let nextTimer = 1;
        originalSetTimeout = window.setTimeout;
        originalClearTimeout = window.clearTimeout;
        window.setTimeout = ((handler: () => void, delay?: number) => {
            expect(delay).to.equal(QAAP_PREVIEW_FRAME_SUSPEND_DELAY_MS);
            const id = nextTimer++;
            timers.set(id, handler);
            return id;
        }) as typeof window.setTimeout;
        window.clearTimeout = ((id?: number) => {
            timers.delete(id as number);
        }) as typeof window.clearTimeout;
        goCalls = [];
    });

    afterEach(() => {
        window.setTimeout = originalSetTimeout;
        window.clearTimeout = originalClearTimeout;
    });

    function createContent(): SuspendTestContent {
        frame = document.createElement('iframe');
        frame.src = 'http://localhost/qaap-dev/5173/';
        const content = Object.create(QaapMiniBrowserContent.prototype);
        Object.defineProperty(content, 'isDisposed', { value: false });
        Object.assign(content, {
            frame,
            input: document.createElement('input'),
            props: {},
            previewFrameSuspended: false,
            pendingPreviewFrameSuspend: undefined,
            go: (url: string): Promise<void> => {
                goCalls.push(url);
                content.previewFrameSuspended = false;
                return Promise.resolve();
            },
        });
        return content as SuspendTestContent;
    }

    function fireTimers(): void {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach(handler => handler());
    }

    it('keeps the live page when the preview is shown again before the suspend delay', () => {
        const content = createContent();
        content.suspendPreviewFrame();
        expect(frame.src).to.equal('http://localhost/qaap-dev/5173/');
        content.resumePreviewFrame();
        expect(timers.size).to.equal(0);
        expect(goCalls).to.deep.equal([]);
        expect(frame.src).to.equal('http://localhost/qaap-dev/5173/');
    });

    it('unloads a preview hidden past the delay and reloads it on show', () => {
        const content = createContent();
        content.suspendPreviewFrame();
        content.suspendPreviewFrame();
        expect(timers.size).to.equal(1);
        fireTimers();
        expect(frame.src).to.equal('about:blank');
        content.resumePreviewFrame();
        expect(goCalls).to.deep.equal(['http://localhost/qaap-dev/5173/']);
    });

    it('unloads right away when asked to', () => {
        const content = createContent();
        content.suspendPreviewFrame();
        content.suspendPreviewFrame({ immediate: true });
        expect(timers.size).to.equal(0);
        expect(frame.src).to.equal('about:blank');
    });
});
