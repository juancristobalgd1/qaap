// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { QAAP_MOBILE_VIEWPORT_INSET_CHANGE_EVENT } from './mobile-keyboard-helper';
import {
    mountStickyComposerBottomSheet,
    positionStickyComposerPopover,
    wireStickyComposerPopoverPosition,
} from './qaap-sticky-composer-popover';

describe('qaap-sticky-composer-popover', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
        // Node's AbortSignal is incompatible with jsdom addEventListener({ signal }).
        globalThis.AbortController = window.AbortController;
    });

    after(() => {
        disableJSDOM();
    });

    it('positions fixed popovers inside the visual viewport', () => {
        const visualViewport = Object.assign(new window.EventTarget(), {
            offsetTop: 120,
            offsetLeft: 4,
            width: 360,
            height: 400,
        });
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });
        const anchor = document.createElement('button');
        const popover = document.createElement('div');
        Object.defineProperties(popover, {
            offsetWidth: { configurable: true, value: 200 },
            offsetHeight: { configurable: true, value: 200 },
        });
        anchor.getBoundingClientRect = () => ({
            top: 450,
            right: 354,
            bottom: 480,
            left: 330,
            width: 24,
            height: 30,
            x: 330,
            y: 450,
            toJSON: () => undefined,
        });

        positionStickyComposerPopover(popover, anchor, 'start', 200);

        expect(popover.style.top).to.equal('244px');
        expect(popover.style.left).to.equal('156px');
    });

    it('coalesces visual viewport changes and stops observing on cleanup', () => {
        const visualViewport = Object.assign(new window.EventTarget(), {
            offsetTop: 0,
            offsetLeft: 0,
            width: 390,
            height: 700,
        });
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });
        const pendingFrames = new Map<number, FrameRequestCallback>();
        let nextFrame = 1;
        window.requestAnimationFrame = callback => {
            const handle = nextFrame++;
            pendingFrames.set(handle, callback);
            return handle;
        };
        window.cancelAnimationFrame = handle => {
            pendingFrames.delete(handle);
        };
        const flushFrame = (): void => {
            const frames = [...pendingFrames.values()];
            pendingFrames.clear();
            for (const frame of frames) {
                frame(0);
            }
        };
        const flushScheduledPosition = (): void => {
            flushFrame();
            flushFrame();
        };

        let anchorTop = 600;
        const anchor = document.createElement('button');
        const popover = document.createElement('div');
        document.body.append(anchor, popover);
        Object.defineProperties(popover, {
            offsetWidth: { configurable: true, value: 200 },
            offsetHeight: { configurable: true, value: 120 },
        });
        anchor.getBoundingClientRect = () => ({
            top: anchorTop,
            right: 54,
            bottom: anchorTop + 30,
            left: 30,
            width: 24,
            height: 30,
            x: 30,
            y: anchorTop,
            toJSON: () => undefined,
        });

        const cleanup = wireStickyComposerPopoverPosition(popover, anchor, { minimumWidth: 200 });
        flushScheduledPosition();
        expect(popover.style.top).to.equal('474px');

        anchorTop = 400;
        visualViewport.dispatchEvent(new window.Event('resize'));
        visualViewport.dispatchEvent(new window.Event('resize'));
        expect(pendingFrames.size).to.equal(1);
        flushScheduledPosition();
        expect(popover.style.top).to.equal('436px');

        cleanup();
        visualViewport.dispatchEvent(new window.Event('resize'));
        expect(pendingFrames.size).to.equal(0);
        anchor.remove();
        popover.remove();
    });

    it('repositions when the keyboard inset settles without a visual viewport event', () => {
        const pendingFrames = new Map<number, FrameRequestCallback>();
        let nextFrame = 1;
        window.requestAnimationFrame = callback => {
            const handle = nextFrame++;
            pendingFrames.set(handle, callback);
            return handle;
        };
        window.cancelAnimationFrame = handle => {
            pendingFrames.delete(handle);
        };
        const flushScheduledPosition = (): void => {
            for (let pass = 0; pass < 2; pass++) {
                const frames = [...pendingFrames.values()];
                pendingFrames.clear();
                for (const frame of frames) {
                    frame(0);
                }
            }
        };

        let anchorTop = 520;
        const layoutHost = document.createElement('div');
        layoutHost.className = 'theia-mobile-projects';
        const anchor = document.createElement('button');
        const popover = document.createElement('div');
        layoutHost.append(anchor);
        document.body.append(layoutHost, popover);
        Object.defineProperties(popover, {
            offsetWidth: { configurable: true, value: 200 },
            offsetHeight: { configurable: true, value: 120 },
        });
        anchor.getBoundingClientRect = () => ({
            top: anchorTop,
            right: 54,
            bottom: anchorTop + 30,
            left: 30,
            width: 24,
            height: 30,
            x: 30,
            y: anchorTop,
            toJSON: () => undefined,
        });

        const cleanup = wireStickyComposerPopoverPosition(popover, anchor, { minimumWidth: 200 });
        flushScheduledPosition();
        expect(popover.style.top).to.equal('556px');

        anchorTop = 360;
        window.dispatchEvent(new window.CustomEvent(QAAP_MOBILE_VIEWPORT_INSET_CHANGE_EVENT, {
            detail: { inset: 0 },
        }));
        flushScheduledPosition();
        expect(popover.style.top).to.equal('396px');

        cleanup();
        layoutHost.remove();
        popover.remove();
    });

    it('repositions when the layout host resizes without a visual viewport event', () => {
        const pendingFrames = new Map<number, FrameRequestCallback>();
        let nextFrame = 1;
        window.requestAnimationFrame = callback => {
            const handle = nextFrame++;
            pendingFrames.set(handle, callback);
            return handle;
        };
        window.cancelAnimationFrame = handle => {
            pendingFrames.delete(handle);
        };
        const flushScheduledPosition = (): void => {
            for (let pass = 0; pass < 2; pass++) {
                const frames = [...pendingFrames.values()];
                pendingFrames.clear();
                for (const frame of frames) {
                    frame(0);
                }
            }
        };

        let anchorTop = 500;
        const layoutHost = document.createElement('div');
        layoutHost.className = 'theia-mobile-projects';
        const anchor = document.createElement('button');
        const popover = document.createElement('div');
        layoutHost.append(anchor);
        document.body.append(layoutHost, popover);
        Object.defineProperties(popover, {
            offsetWidth: { configurable: true, value: 200 },
            offsetHeight: { configurable: true, value: 120 },
        });
        anchor.getBoundingClientRect = () => ({
            top: anchorTop,
            right: 54,
            bottom: anchorTop + 30,
            left: 30,
            width: 24,
            height: 30,
            x: 30,
            y: anchorTop,
            toJSON: () => undefined,
        });

        const resizeObserverCallbacks: Array<() => void> = [];
        const originalResizeObserver = globalThis.ResizeObserver;
        class MockResizeObserver {
            constructor(private readonly callback: ResizeObserverCallback) { }
            observe(): void {
                resizeObserverCallbacks.push(() => this.callback([], this));
            }
            disconnect(): void {
                resizeObserverCallbacks.length = 0;
            }
            unobserve(): void {
                // no-op
            }
        }
        globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

        const cleanup = wireStickyComposerPopoverPosition(popover, anchor, { minimumWidth: 200 });
        flushScheduledPosition();
        expect(popover.style.top).to.equal('536px');

        anchorTop = 380;
        resizeObserverCallbacks.forEach(callback => callback());
        flushScheduledPosition();
        expect(popover.style.top).to.equal('416px');

        cleanup();
        globalThis.ResizeObserver = originalResizeObserver;
        layoutHost.remove();
        popover.remove();
    });

    it('pins bottom sheets to the visual viewport and clears styles on remove', () => {
        const visualViewport = Object.assign(new window.EventTarget(), {
            offsetTop: 48,
            offsetLeft: 0,
            width: 390,
            height: 420,
        });
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });
        const pendingFrames = new Map<number, FrameRequestCallback>();
        let nextFrame = 1;
        window.requestAnimationFrame = callback => {
            const handle = nextFrame++;
            pendingFrames.set(handle, callback);
            return handle;
        };
        window.cancelAnimationFrame = handle => {
            pendingFrames.delete(handle);
        };
        const flushScheduledPosition = (): void => {
            for (let pass = 0; pass < 2; pass++) {
                const frames = [...pendingFrames.values()];
                pendingFrames.clear();
                for (const frame of frames) {
                    frame(0);
                }
            }
        };

        const panel = document.createElement('section');
        const sheet = mountStickyComposerBottomSheet(panel, {
            sheetClassName: 'theia-mobile-sticky-composer-sheet theia-mod-agent',
            onClose: () => undefined,
        });
        document.body.append(sheet);
        flushScheduledPosition();

        expect(sheet.classList.contains('theia-mod-visual-viewport')).to.equal(true);
        expect(sheet.style.top).to.equal('48px');
        expect(sheet.style.height).to.equal('420px');
        expect(sheet.style.width).to.equal('390px');

        (visualViewport as { height: number }).height = 360;
        visualViewport.dispatchEvent(new window.Event('resize'));
        flushScheduledPosition();
        expect(sheet.style.height).to.equal('360px');

        sheet.remove();
        expect(sheet.classList.contains('theia-mod-visual-viewport')).to.equal(false);
        expect(sheet.style.top).to.equal('');
        expect(sheet.isConnected).to.equal(false);
    });
});
