// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { ensureTranscriptScrollController } from './qaap-transcript-scroll-controller';
import { TranscriptVirtualList } from './qaap-transcript-virtual-list';

describe('TranscriptVirtualList follow-tail after spacer thrash', () => {
    let disableJSDOM: () => void;
    let host: HTMLElement;
    let rafQueue: Array<FrameRequestCallback>;
    let originalRaf: typeof requestAnimationFrame;
    let originalCancelRaf: typeof cancelAnimationFrame;
    let originalRO: typeof ResizeObserver | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        rafQueue = [];
        originalRaf = globalThis.requestAnimationFrame;
        originalCancelRaf = globalThis.cancelAnimationFrame;
        originalRO = globalThis.ResizeObserver;
        // jsdom defaults to visibilityState=prerender, which pauses virtual-list updates.
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).ResizeObserver = undefined;
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            rafQueue.push(cb);
            return rafQueue.length;
        };
        globalThis.cancelAnimationFrame = (id: number): void => {
            rafQueue[id - 1] = () => undefined;
        };
        host = document.createElement('div');
        Object.defineProperty(host, 'clientHeight', { configurable: true, value: 400 });
        let scrollTop = 0;
        const readScrollHeight = (): number => {
            const spacer = host.querySelector<HTMLElement>('.theia-transcript-virtual-spacer');
            return Number.parseFloat(spacer?.style.height || '0') || 0;
        };
        const clampScrollTop = (value: number): number => {
            const max = Math.max(0, readScrollHeight() - host.clientHeight);
            return Math.max(0, Math.min(value, max));
        };
        Object.defineProperty(host, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: (value: number) => { scrollTop = clampScrollTop(value); },
        });
        Object.defineProperty(host, 'scrollHeight', {
            configurable: true,
            get: () => readScrollHeight(),
        });
        host.scrollTo = ((options?: ScrollToOptions | number, y?: number): void => {
            if (typeof options === 'number') {
                scrollTop = clampScrollTop(options);
                return;
            }
            if (typeof options === 'object' && options && typeof options.top === 'number') {
                scrollTop = clampScrollTop(options.top);
                return;
            }
            if (typeof y === 'number') {
                scrollTop = clampScrollTop(y);
            }
        }) as typeof host.scrollTo;
        document.body.append(host);
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
        if (originalRO) {
            globalThis.ResizeObserver = originalRO;
        }
        host.remove();
    });

    const flushRaf = (): void => {
        const queue = rafQueue.splice(0, rafQueue.length);
        for (const cb of queue) {
            cb(performance.now());
        }
    };

    it('keeps following when item count grows the spacer after a clamped shrink', () => {
        const list = new TranscriptVirtualList({
            scrollHost: host,
            defaultItemHeight: 200,
            renderItem: index => {
                const row = document.createElement('div');
                row.textContent = `row-${index}`;
                return row;
            },
        });
        const scroll = ensureTranscriptScrollController(host);

        list.setItemCount(3);
        flushRaf();
        scroll.jumpToLatest();
        list.scrollToEnd();
        scroll.onContentChanged(host);
        flushRaf();
        expect(host.scrollTop).to.equal(Math.max(0, host.scrollHeight - host.clientHeight));

        // Shrink the live spacer (as a remount would) and clamp the viewport to the top.
        const spacer = host.querySelector<HTMLElement>('.theia-transcript-virtual-spacer');
        expect(spacer).to.not.equal(undefined);
        spacer!.style.height = '450px';
        host.scrollTop = 0;
        expect(host.scrollTop).to.equal(0);

        // Growing the list rebuilds a tall spacer; follow-tail must chase the live edge.
        list.setItemCount(12);
        flushRaf();
        flushRaf();

        const maxScrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
        expect(host.scrollHeight).to.be.at.least(12 * 200);
        expect(host.scrollTop).to.equal(maxScrollTop);

        // Simulate being stranded at the top while still following (clamp after shrink).
        host.scrollTop = 0;
        expect(host.scrollTop).to.equal(0);
        list.setItemCount(12);
        flushRaf();
        flushRaf();
        expect(host.scrollTop).to.equal(Math.max(0, host.scrollHeight - host.clientHeight));
        list.dispose();
    });

    it('requestMeasureImmediate schedules an update without waiting for the throttle window', () => {
        const list = new TranscriptVirtualList({
            scrollHost: host,
            defaultItemHeight: 200,
            renderItem: index => {
                const row = document.createElement('div');
                row.className = index === 0 ? 'theia-mod-streaming' : '';
                row.textContent = `row-${index}`;
                return row;
            },
        });
        list.setItemCount(1);
        flushRaf();
        rafQueue.length = 0;
        list.requestMeasureImmediate();
        expect(rafQueue.length).to.be.greaterThan(0);
        list.dispose();
    });
});
