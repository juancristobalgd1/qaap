// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { attachTranscriptScrollToBottomButton } from './qaap-transcript-scroll-to-bottom';
import { ensureTranscriptScrollController } from './qaap-transcript-scroll-controller';

describe('qaap-transcript-scroll-to-bottom deferred snap', () => {
    let disableJSDOM: () => void;
    let rafQueue: Array<FrameRequestCallback>;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    // jsdom provides no requestAnimationFrame, so the module's scheduling needs one. Only that
    // is added (and removed afterwards) — `window.setTimeout` is deliberately left alone:
    // reassigning jsdom's own timer wiring corrupts the shared window and blows the stack in
    // unrelated specs. The ~480ms deferred snap is awaited with real time instead.
    let rafAdded = false;

    beforeEach(() => {
        rafQueue = [];
        if (typeof window.requestAnimationFrame !== 'function') {
            rafAdded = true;
            const fakeRaf = (cb: FrameRequestCallback): number => {
                rafQueue.push(cb);
                return rafQueue.length;
            };
            const value = { configurable: true, writable: true, value: fakeRaf };
            // The scroll controller schedules on the bare global, the FAB on `window`.
            Object.defineProperty(window, 'requestAnimationFrame', value);
            Object.defineProperty(globalThis, 'requestAnimationFrame', value);
            Object.defineProperty(window, 'cancelAnimationFrame', {
                configurable: true, writable: true, value: (id: number) => { rafQueue[id - 1] = () => undefined; },
            });
            Object.defineProperty(globalThis, 'cancelAnimationFrame', {
                configurable: true, writable: true, value: (id: number) => { rafQueue[id - 1] = () => undefined; },
            });
        }
    });

    afterEach(() => {
        if (rafAdded) {
            delete (window as unknown as Record<string, unknown>).requestAnimationFrame;
            delete (globalThis as unknown as Record<string, unknown>).requestAnimationFrame;
            delete (window as unknown as Record<string, unknown>).cancelAnimationFrame;
            delete (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame;
            rafAdded = false;
        }
    });

    const flushRaf = (): void => {
        for (const cb of rafQueue.splice(0, rafQueue.length)) {
            cb(0);
        }
    };

    /** Outlast the module's ~480ms deferred snap using real timers. */
    const afterDeferredSnaps = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 700));

    function buildHost(): { mount: HTMLElement; scroller: HTMLElement; top: () => number } {
        const mount = document.createElement('div');
        mount.className = 'theia-mobile-agent-transcript-real-chat';
        const scroller = document.createElement('div');
        scroller.className = 'theia-mobile-agent-transcript';
        const message = document.createElement('div');
        message.className = 'theia-mobile-agent-transcript-msg theia-mod-user';
        scroller.append(message);
        mount.append(scroller);

        let scrollTop = 200;
        Object.defineProperties(scroller, {
            clientHeight: { configurable: true, value: 400 },
            scrollHeight: { configurable: true, value: 4000 },
            scrollTop: {
                configurable: true,
                get: () => scrollTop,
                set: (value: number) => { scrollTop = Math.max(0, Math.min(value, 3600)); },
            },
        });
        scroller.scrollTo = ((options?: ScrollToOptions | number): void => {
            if (typeof options === 'number') {
                scroller.scrollTop = options;
            } else if (options && typeof options.top === 'number') {
                scroller.scrollTop = options.top;
            }
        }) as typeof scroller.scrollTo;
        document.body.append(mount);
        return { mount, scroller, top: () => scrollTop };
    }

    it('cancels the deferred snap-to-end once the reader scrolls away', async () => {
        // A jump-to-latest schedules follow-up snaps (rAF, scrollend, ~480ms timeout). They used
        // to fire unconditionally, so scrolling shortly after the jump dragged the viewport back
        // to the tail — a full-transcript jump the reader never asked for.
        const { mount, scroller, top } = buildHost();
        const dispose = attachTranscriptScrollToBottomButton(mount);
        const controller = ensureTranscriptScrollController(scroller);
        const button = mount.querySelector<HTMLElement>('.theia-mobile-agent-transcript-scroll-to-bottom')!;
        flushRaf();

        button.hidden = false;
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        // The jump itself is allowed to land.
        expect(controller.shouldFollowTail()).to.equal(true);

        // Reader scrolls away before the deferred snaps run.
        scroller.scrollTop = 100;
        controller.notifyUserDetach('wheel');
        flushRaf();
        await afterDeferredSnaps();

        expect(controller.shouldFollowTail()).to.equal(false);
        expect(top()).to.equal(100);
        dispose.dispose();
        mount.remove();
    });

    it('still completes the jump when the reader stays at the live edge', async () => {
        const { mount, scroller, top } = buildHost();
        const dispose = attachTranscriptScrollToBottomButton(mount);
        const controller = ensureTranscriptScrollController(scroller);
        const button = mount.querySelector<HTMLElement>('.theia-mobile-agent-transcript-scroll-to-bottom')!;
        flushRaf();

        button.hidden = false;
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        flushRaf();
        await afterDeferredSnaps();

        expect(controller.shouldFollowTail()).to.equal(true);
        expect(top()).to.equal(3600);
        dispose.dispose();
        mount.remove();
    });
});
