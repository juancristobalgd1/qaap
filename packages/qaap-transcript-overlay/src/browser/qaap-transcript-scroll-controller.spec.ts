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
        controller.beginPositionTurn();
        controller.completePositionTurn();
        expect(controller.phase).to.equal('following');

        controller.notifyUserDetach('wheel');
        expect(controller.phase).to.equal('detached');
        expect(controller.shouldFollowTail()).to.equal(false);

        controller.jumpToLatest();
        expect(controller.phase).to.equal('following');
        expect(controller.shouldFollowTail()).to.equal(true);
    });
});
