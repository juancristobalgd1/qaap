// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import type { WidgetManager } from '@theia/core/lib/browser';
import type { PreferencesWidget } from '@theia/preferences/lib/browser/views/preference-widget';
import { MobileWorkHubPreferencesSheet } from './mobile-work-hub-preferences-sheet';

/** Same identity-based listener tracker used by the other dispose/leak specs. */
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
     * Excludes `mouseover`/`mouseout` on `document`: jsdom's own `nwsapi` CSS engine
     * lazily registers a permanent pair of these on the first `querySelector` call in
     * a document — a jsdom implementation detail, not something a widget could remove.
     */
    outstanding(): string[] {
        return [...this.added.entries()]
            .filter(([key, count]) => count > 0 && !key.startsWith('mouseover::') && !key.startsWith('mouseout::'))
            .map(([key]) => key);
    }
}

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    disconnected = false;
    constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this);
        void this.callback;
    }
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { this.disconnected = true; }
}

describe('MobileWorkHubPreferencesSheet (dispose/leak)', () => {
    let disableJSDOM: (() => void) | undefined;
    let originalRaf: typeof requestAnimationFrame;
    let originalCaf: typeof cancelAnimationFrame;
    let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;
    let originalResizeObserver: typeof ResizeObserver | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();

        // `animationFrame()` (from @theia/core/lib/browser) and this widget's own
        // `scheduleLayoutSync` both call the *unqualified* global `requestAnimationFrame`,
        // which jsdom backs with a real ~16ms timer. Make it synchronous so `show()`
        // resolves immediately instead of the test waiting on real frames/timeouts.
        originalRaf = globalThis.requestAnimationFrame;
        originalCaf = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame;
        globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

        // jsdom's getBoundingClientRect always reports 0x0, which would otherwise send
        // `syncWidgetLayout` into its (bounded) retry loop on every call.
        originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (): DOMRect {
            return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect;
        };

        originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
        (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

        // jsdom does not implement `CSS.escape`, used by `applyPreferencesQuery` /
        // `unlockAiFeaturesSearch` to build a selector for the preferences search input.
        if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
            (globalThis as { CSS: { escape(value: string): string } }).CSS = {
                escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`),
            };
        }
    });

    after(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCaf;
        Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalResizeObserver;
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    let windowTracker: ListenerLeakTracker;
    let documentTracker: ListenerLeakTracker;

    beforeEach(() => {
        document.body.innerHTML = '';
        FakeResizeObserver.instances = [];
        windowTracker = new ListenerLeakTracker(window);
        documentTracker = new ListenerLeakTracker(document);
        windowTracker.install();
        documentTracker.install();
    });

    afterEach(() => {
        windowTracker.uninstall();
        documentTracker.uninstall();
    });

    function createFakePreferencesWidget(): PreferencesWidget {
        const node = document.createElement('div');
        const fake = {
            id: 'preferences',
            node,
            isAttached: false,
            isHidden: true,
            show(): void { fake.isHidden = false; },
            update(): void { /* no-op */ },
            async setSearchTerm(): Promise<void> { /* no-op */ },
            processMessage(): void { /* no-op */ },
        };
        return fake as unknown as PreferencesWidget;
    }

    function createWidgetManager(widget: PreferencesWidget): WidgetManager {
        return {
            getOrCreateWidget: async () => widget,
        } as unknown as WidgetManager;
    }

    it('removes every window/document listener it registered once disposed', async () => {
        const widgetManager = createWidgetManager(createFakePreferencesWidget());
        const sheet = new MobileWorkHubPreferencesSheet(widgetManager);

        await sheet.show();
        sheet.dispose();

        expect(windowTracker.outstanding(), 'window listeners left registered after dispose').to.deep.equal([]);
        expect(documentTracker.outstanding(), 'document listeners left registered after dispose').to.deep.equal([]);
    });

    it('disconnects any ResizeObserver it created', async () => {
        const widgetManager = createWidgetManager(createFakePreferencesWidget());
        const sheet = new MobileWorkHubPreferencesSheet(widgetManager);

        await sheet.show();
        expect(FakeResizeObserver.instances.length, 'expected the sheet to observe its widget host').to.be.greaterThan(0);

        sheet.dispose();
        expect(FakeResizeObserver.instances.every(instance => instance.disconnected)).to.equal(true);
    });

    it('detaches its root node from the document on dispose', async () => {
        const widgetManager = createWidgetManager(createFakePreferencesWidget());
        const sheet = new MobileWorkHubPreferencesSheet(widgetManager);

        await sheet.show();
        expect(sheet.node.isConnected).to.equal(true);

        sheet.dispose();
        expect(sheet.node.isConnected).to.equal(false);
    });

    it('does not throw when disposed twice', async () => {
        const widgetManager = createWidgetManager(createFakePreferencesWidget());
        const sheet = new MobileWorkHubPreferencesSheet(widgetManager);

        await sheet.show();
        expect(() => {
            sheet.dispose();
            sheet.dispose();
        }).to.not.throw();
    });

    it('does not throw when disposed without ever calling show()', () => {
        const widgetManager = createWidgetManager(createFakePreferencesWidget());
        const sheet = new MobileWorkHubPreferencesSheet(widgetManager);

        expect(() => sheet.dispose()).to.not.throw();
        expect(windowTracker.outstanding()).to.deep.equal([]);
        expect(documentTracker.outstanding()).to.deep.equal([]);
    });
});
