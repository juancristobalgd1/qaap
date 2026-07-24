// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    attachTranscriptScrollIntentObserver,
    clearTranscriptUserScrollIntent,
    markTranscriptUserScrollIntent,
    transcriptHasRecentUserScrollIntent,
} from './qaap-transcript-scroll-intent';
import { ensureTranscriptScrollController } from './qaap-transcript-scroll-controller';

describe('qaap-transcript-scroll-intent', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    it('records recent explicit user intent and detaches the controller', () => {
        const scroller = document.createElement('div');
        const controller = ensureTranscriptScrollController(scroller);
        expect(controller.phase).to.equal('idle');

        markTranscriptUserScrollIntent(scroller, 'wheel', 1_000);

        expect(transcriptHasRecentUserScrollIntent(scroller, 1_500)).to.equal(true);
        expect(controller.phase).to.equal('detached');
    });

    it('does not pause auto-follow for stale intent', () => {
        const scroller = document.createElement('div');
        markTranscriptUserScrollIntent(scroller, 'wheel', 1_000);

        expect(transcriptHasRecentUserScrollIntent(scroller, 3_000)).to.equal(false);
    });

    it('clears intent when the user explicitly jumps to latest', () => {
        const scroller = document.createElement('div');
        markTranscriptUserScrollIntent(scroller, 'selection');

        clearTranscriptUserScrollIntent(scroller);

        expect(transcriptHasRecentUserScrollIntent(scroller)).to.equal(false);
    });

    it('does not detach follow on touchstart or tool summary clicks', () => {
        const scroller = document.createElement('div');
        const summary = document.createElement('summary');
        summary.textContent = 'Tool';
        scroller.append(summary);
        document.body.append(scroller);
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();
        expect(controller.phase).to.equal('following');

        const dispose = attachTranscriptScrollIntentObserver(scroller);
        try {
            scroller.dispatchEvent(new window.Event('touchstart', { bubbles: true }));
            scroller.dispatchEvent(new window.Event('touchmove', { bubbles: true }));
            summary.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            expect(controller.phase).to.equal('following');
            expect(transcriptHasRecentUserScrollIntent(scroller)).to.equal(false);
        } finally {
            dispose.dispose();
            scroller.remove();
        }
    });

    it('detaches when the reader opens a link', () => {
        const scroller = document.createElement('div');
        const link = document.createElement('a');
        link.href = '#qaap-transcript-message-user-1';
        link.textContent = 'Jump';
        scroller.append(link);
        document.body.append(scroller);
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();
        const dispose = attachTranscriptScrollIntentObserver(scroller);
        try {
            link.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            expect(controller.phase).to.equal('detached');
        } finally {
            dispose.dispose();
            scroller.remove();
        }
    });

    it('detaches only on upward wheel, not downward catch-up', () => {
        const scroller = document.createElement('div');
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();
        const dispose = attachTranscriptScrollIntentObserver(scroller);
        try {
            scroller.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 40, bubbles: true }));
            expect(controller.phase).to.equal('following');

            scroller.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -24, bubbles: true }));
            expect(controller.phase).to.equal('detached');
        } finally {
            dispose.dispose();
        }
    });
});
