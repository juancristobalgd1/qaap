// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import {
    mountTranscriptFilesView,
    type TranscriptFilesViewServices,
} from './qaap-transcript-files-view';

/**
 * Records addEventListener/removeEventListener calls on a target (window or
 * document) so a test can assert every registered listener was later removed.
 * Only tracks calls made while `install()` is active.
 */
class ListenerLeakTracker {
    private readonly added = new Map<string, number>();
    private readonly ids = new WeakMap<object, number>();
    private nextId = 1;
    private readonly originalAdd: typeof EventTarget.prototype.addEventListener;
    private readonly originalRemove: typeof EventTarget.prototype.removeEventListener;

    constructor(private readonly target: EventTarget) {
        this.originalAdd = target.addEventListener.bind(target);
        this.originalRemove = target.removeEventListener.bind(target);
    }

    /** Stable per-function-object identity — avoids false matches from `String(fn)` collisions. */
    private identify(listener: EventListenerOrEventListenerObject | null): number {
        if (!listener) {
            return 0;
        }
        const existing = this.ids.get(listener);
        if (existing !== undefined) {
            return existing;
        }
        const id = this.nextId++;
        this.ids.set(listener, id);
        return id;
    }

    private key(type: string, listener: EventListenerOrEventListenerObject | null, options: boolean | AddEventListenerOptions | EventListenerOptions | undefined): string {
        const capture = typeof options === 'boolean' ? options : !!options?.capture;
        return `${type}::${capture}::${this.identify(listener)}`;
    }

    install(): void {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.target.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
            const key = self.key(type, listener, options);
            self.added.set(key, (self.added.get(key) ?? 0) + 1);
            return self.originalAdd(type, listener, options);
        } as typeof EventTarget.prototype.addEventListener;
        this.target.removeEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
            const key = self.key(type, listener, options);
            const count = self.added.get(key) ?? 0;
            if (count > 0) {
                self.added.set(key, count - 1);
            }
            return self.originalRemove(type, listener, options);
        } as typeof EventTarget.prototype.removeEventListener;
    }

    uninstall(): void {
        this.target.addEventListener = this.originalAdd;
        this.target.removeEventListener = this.originalRemove;
    }

    /**
     * Listener registrations still outstanding (added but never removed).
     * Excludes `mouseover`/`mouseout` on `document`: jsdom's own `nwsapi` CSS engine
     * lazily registers a permanent pair of these on the very first `querySelector`
     * call in a document — a jsdom implementation detail, not something any widget
     * under test could (or should) remove.
     */
    outstanding(): string[] {
        return [...this.added.entries()]
            .filter(([key, count]) => count > 0 && !key.startsWith('mouseover::') && !key.startsWith('mouseout::'))
            .map(([key]) => key);
    }
}

describe('qaap-transcript-files-view (dispose/leak)', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        if (typeof PointerEvent === 'undefined') {
            class PointerEventPolyfill extends MouseEvent {
                constructor(type: string, params: MouseEventInit = {}) {
                    super(type, params);
                }
            }
            (globalThis as typeof globalThis & { PointerEvent: typeof PointerEvent }).PointerEvent =
                PointerEventPolyfill as unknown as typeof PointerEvent;
        }
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    const createServices = (): TranscriptFilesViewServices => ({
        resolveRootUri: () => 'file:///repo',
        listDirectory: async () => [],
        relativePathForResource: (resourcePath, rootUri) => resourcePath.slice(`${rootUri}/`.length),
        readFile: async () => '',
        localize: (_key, defaultValue) => defaultValue,
    });

    let windowTracker: ListenerLeakTracker;
    let documentTracker: ListenerLeakTracker;

    beforeEach(() => {
        document.body.innerHTML = '';
        windowTracker = new ListenerLeakTracker(window);
        documentTracker = new ListenerLeakTracker(document);
        windowTracker.install();
        documentTracker.install();
    });

    afterEach(() => {
        windowTracker.uninstall();
        documentTracker.uninstall();
    });

    it('removes every window/document listener it registered once disposed', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const mount = mountTranscriptFilesView(host, '/repo', createServices());

        // Exercise the two document-scoped popovers (more menu / new-file menu) so their
        // outside-click + Escape listeners are actually registered before dispose.
        const moreBtn = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-files-more');
        moreBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        const newBtn = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-files-new-btn');
        newBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

        // Trigger the throttled window resize handler so its listener is live.
        window.dispatchEvent(new window.Event('resize'));

        mount.dispose.dispose();

        expect(windowTracker.outstanding(), 'window listeners left registered after dispose').to.deep.equal([]);
        expect(documentTracker.outstanding(), 'document listeners left registered after dispose').to.deep.equal([]);
    });

    it('detaches its root element from the document on dispose', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const mount = mountTranscriptFilesView(host, '/repo', createServices());

        expect(mount.root.isConnected).to.equal(true);
        mount.dispose.dispose();
        expect(mount.root.isConnected).to.equal(false);
        expect(host.querySelector('.theia-mobile-transcript-files')).to.equal(null);
    });

    it('does not throw when disposed twice', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const mount = mountTranscriptFilesView(host, '/repo', createServices());

        expect(() => {
            mount.dispose.dispose();
            mount.dispose.dispose();
        }).to.not.throw();
    });

    it('cancels the pending resize animation frame on dispose', () => {
        const host = document.createElement('div');
        document.body.append(host);

        let scheduledId = 0;
        let cancelledId: number | undefined;
        const originalRaf = window.requestAnimationFrame;
        const originalCaf = window.cancelAnimationFrame;
        window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            scheduledId += 1;
            void callback;
            // Never actually invoke the callback — simulates disposing mid-frame.
            return scheduledId;
        };
        window.cancelAnimationFrame = (handle: number): void => {
            cancelledId = handle;
        };

        try {
            const mount = mountTranscriptFilesView(host, '/repo', createServices());
            window.dispatchEvent(new window.Event('resize'));
            expect(scheduledId, 'resize should have scheduled a rAF').to.be.greaterThan(0);
            mount.dispose.dispose();
            expect(cancelledId).to.equal(scheduledId);
        } finally {
            window.requestAnimationFrame = originalRaf;
            window.cancelAnimationFrame = originalCaf;
        }
    });
});
