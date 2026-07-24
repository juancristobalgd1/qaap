// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    ensureTranscriptScrollController,
    getTranscriptScrollController,
} from './qaap-transcript-scroll-controller';

describe('qaap-transcript-scroll-controller', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    it('persists phase identity when scroll chrome is rebound', () => {
        const scroller = document.createElement('div');
        const controller = ensureTranscriptScrollController(scroller);
        controller.beginConversation('conversation-1');
        controller.beginRestore();
        controller.completeRestore();

        const firstBinding = controller.bind(scroller);
        firstBinding.dispose();
        const secondBinding = ensureTranscriptScrollController(scroller).bind(scroller);

        expect(getTranscriptScrollController(scroller)).to.equal(controller);
        expect(controller.phase).to.equal('detached');
        expect(controller.conversationId).to.equal('conversation-1');
        secondBinding.dispose();
    });

    it('does not follow after a programmatic near-bottom scroll', () => {
        const scroller = document.createElement('div');
        Object.defineProperties(scroller, {
            scrollTop: { configurable: true, writable: true, value: 168 },
            clientHeight: { configurable: true, value: 100 },
            scrollHeight: { configurable: true, value: 300 },
        });
        const controller = ensureTranscriptScrollController(scroller);
        controller.beginConversation('conversation-2');
        controller.beginRestore();
        controller.completeRestore();
        const binding = controller.bind(scroller);

        controller.markProgrammaticScroll();
        scroller.dispatchEvent(new window.Event('scroll'));

        expect(controller.phase).to.equal('detached');
        expect(controller.shouldFollowTail()).to.equal(false);
        controller.scrollToTail(scroller, 'auto');
        expect(scroller.scrollTop).to.equal(168);
        binding.dispose();
    });

    it('jumpToLatest enables following and scrollToTail writes once opted in', () => {
        const scroller = document.createElement('div');
        let writtenTop = 0;
        Object.defineProperties(scroller, {
            scrollTop: {
                configurable: true,
                get: () => writtenTop,
                set: (value: number) => { writtenTop = value; },
            },
            clientHeight: { configurable: true, value: 100 },
            scrollHeight: { configurable: true, value: 400 },
            scrollTo: {
                configurable: true,
                value(options: ScrollToOptions): void {
                    if (typeof options.top === 'number') {
                        writtenTop = options.top;
                    }
                },
            },
        });
        const controller = ensureTranscriptScrollController(scroller);
        controller.beginRestore();
        controller.completeRestore();
        expect(controller.shouldFollowTail()).to.equal(false);

        controller.jumpToLatest();
        expect(controller.phase).to.equal('following');
        controller.scrollToTail(scroller, 'auto');
        expect(writtenTop).to.equal(400);
    });

    it('user detach then jump-to-latest re-enables following', () => {
        const scroller = document.createElement('div');
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();
        expect(controller.phase).to.equal('following');

        controller.notifyUserDetach('wheel');
        expect(controller.phase).to.equal('detached');
        expect(controller.shouldFollowTail()).to.equal(false);

        controller.jumpToLatest();
        expect(controller.phase).to.equal('following');
        expect(controller.shouldFollowTail()).to.equal(true);
    });

    it('completing a position-turn leaves the reader detached', () => {
        const scroller = document.createElement('div');
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();
        controller.beginPositionTurn();
        controller.completePositionTurn();
        expect(controller.phase).to.equal('detached');
        expect(controller.shouldFollowTail()).to.equal(false);
    });

    it('jumpToLatest clears an active text selection', () => {
        const scroller = document.createElement('div');
        scroller.textContent = 'Selectable transcript line';
        document.body.append(scroller);
        const controller = ensureTranscriptScrollController(scroller);
        const range = document.createRange();
        range.selectNodeContents(scroller);
        const selection = document.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        expect(selection.isCollapsed).to.equal(false);

        controller.jumpToLatest();

        expect(selection.isCollapsed).to.equal(true);
        expect(controller.phase).to.equal('following');
        scroller.remove();
    });

    it('jumpToLatest cancels a pending deferred preserve-anchor restore', async () => {
        const scroller = document.createElement('div');
        let scrollTop = 120;
        Object.defineProperties(scroller, {
            scrollTop: {
                configurable: true,
                get: () => scrollTop,
                set: (value: number) => { scrollTop = value; },
            },
            clientHeight: { configurable: true, value: 400 },
            scrollHeight: { configurable: true, value: 1200 },
            scrollTo: {
                configurable: true,
                value(options: ScrollToOptions): void {
                    if (typeof options.top === 'number') {
                        scrollTop = options.top;
                    }
                },
            },
            getBoundingClientRect: {
                configurable: true,
                value: () => ({ top: 0, bottom: 400, left: 0, right: 320, width: 320, height: 400, x: 0, y: 0, toJSON: () => ({}) }),
            },
        });
        const controller = ensureTranscriptScrollController(scroller);
        controller.notifyUserDetach('wheel');
        const staleAnchor = controller.captureAnchor(scroller);
        const pendingRafs: FrameRequestCallback[] = [];
        const previousRaf = globalThis.requestAnimationFrame;
        const previousCancel = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            pendingRafs.push(callback);
            return pendingRafs.length;
        };
        globalThis.cancelAnimationFrame = (): void => {
            pendingRafs.length = 0;
        };
        try {
            controller.schedulePreserveAnchor(scroller, staleAnchor);
            expect(scrollTop).to.equal(120);

            controller.jumpToLatest();
            scrollTop = 800;

            pendingRafs.forEach(callback => callback(0));
        } finally {
            globalThis.requestAnimationFrame = previousRaf;
            globalThis.cancelAnimationFrame = previousCancel;
        }

        expect(controller.phase).to.equal('following');
        expect(scrollTop).to.equal(800);
    });

    it('skips follow-tail writes when already at max scroll', () => {
        const scroller = document.createElement('div');
        let scrollTop = 300;
        let scrollToCalls = 0;
        Object.defineProperties(scroller, {
            scrollTop: {
                configurable: true,
                get: () => scrollTop,
                set: (value: number) => { scrollTop = value; },
            },
            clientHeight: { configurable: true, value: 100 },
            scrollHeight: { configurable: true, value: 400 },
            scrollTo: {
                configurable: true,
                value(options: ScrollToOptions): void {
                    scrollToCalls++;
                    if (typeof options.top === 'number') {
                        scrollTop = options.top;
                    }
                },
            },
        });
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();

        controller.onContentChanged(scroller);
        controller.scrollToTail(scroller, 'auto');

        expect(scrollToCalls).to.equal(0);
        expect(scrollTop).to.equal(300);
    });

    it('follow-tail scrolls when content growth leaves the live edge', async () => {
        const scroller = document.createElement('div');
        let scrollTop = 300;
        let scrollHeight = 400;
        let scrollToCalls = 0;
        Object.defineProperties(scroller, {
            scrollTop: {
                configurable: true,
                get: () => scrollTop,
                set: (value: number) => { scrollTop = value; },
            },
            clientHeight: { configurable: true, value: 100 },
            scrollHeight: {
                configurable: true,
                get: () => scrollHeight,
            },
            scrollTo: {
                configurable: true,
                value(options: ScrollToOptions): void {
                    scrollToCalls++;
                    if (typeof options.top === 'number') {
                        scrollTop = options.top;
                    }
                },
            },
        });
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();
        const pendingRafs: FrameRequestCallback[] = [];
        const previousRaf = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            pendingRafs.push(callback);
            return pendingRafs.length;
        };
        try {
            scrollHeight = 520;
            controller.onContentChanged(scroller);
            expect(pendingRafs).to.have.length(1);
            pendingRafs.forEach(callback => callback(0));
        } finally {
            globalThis.requestAnimationFrame = previousRaf;
        }
        expect(scrollToCalls).to.equal(1);
        expect(scrollTop).to.equal(520);
    });

    it('coalesces competing follow and preserve intents into a single follow write', () => {
        const scroller = document.createElement('div');
        let scrollTop = 100;
        let scrollToCalls = 0;
        Object.defineProperties(scroller, {
            scrollTop: {
                configurable: true,
                get: () => scrollTop,
                set: (value: number) => { scrollTop = value; },
            },
            clientHeight: { configurable: true, value: 400 },
            scrollHeight: { configurable: true, value: 900 },
            scrollTo: {
                configurable: true,
                value(options: ScrollToOptions): void {
                    scrollToCalls++;
                    if (typeof options.top === 'number') {
                        scrollTop = options.top;
                    }
                },
            },
            getBoundingClientRect: {
                configurable: true,
                value: () => ({ top: 0, bottom: 400, left: 0, right: 320, width: 320, height: 400, x: 0, y: 0, toJSON: () => ({}) }),
            },
        });
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();
        const anchor = controller.captureAnchor(scroller);
        const pendingRafs: FrameRequestCallback[] = [];
        const previousRaf = globalThis.requestAnimationFrame;
        const previousCancel = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            pendingRafs.push(callback);
            return pendingRafs.length;
        };
        globalThis.cancelAnimationFrame = (): void => {
            pendingRafs.length = 0;
        };
        try {
            controller.schedulePreserveAnchor(scroller, anchor);
            controller.onContentChanged(scroller);
            controller.onContentChanged(scroller);
            expect(pendingRafs).to.have.length(1);
            pendingRafs.forEach(callback => callback(0));
        } finally {
            globalThis.requestAnimationFrame = previousRaf;
            globalThis.cancelAnimationFrame = previousCancel;
        }
        expect(scrollToCalls).to.equal(1);
        expect(scrollTop).to.equal(900);
    });
});
