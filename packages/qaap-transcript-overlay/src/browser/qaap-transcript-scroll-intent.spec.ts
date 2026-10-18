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
    transcriptHasObservedSelection,
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

    it('detaches follow immediately on touchstart and tool summary clicks', () => {
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
            expect(controller.phase).to.equal('detached');
            expect(scroller.getAttribute('data-transcript-user-scroll-intent-reason')).to.equal('touch');

            controller.jumpToLatest();
            summary.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            expect(controller.phase).to.equal('detached');
            expect(scroller.getAttribute('data-transcript-user-scroll-intent-reason')).to.equal('interaction');
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

    it('detaches on wheel in either direction', () => {
        const scroller = document.createElement('div');
        const controller = ensureTranscriptScrollController(scroller);
        controller.jumpToLatest();
        const dispose = attachTranscriptScrollIntentObserver(scroller);
        try {
            scroller.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 40, bubbles: true }));
            expect(controller.phase).to.equal('detached');

            controller.jumpToLatest();
            scroller.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -24, bubbles: true }));
            expect(controller.phase).to.equal('detached');
        } finally {
            dispose.dispose();
        }
    });

    it('detaches on every transcript navigation key', () => {
        const scroller = document.createElement('div');
        const controller = ensureTranscriptScrollController(scroller);
        const dispose = attachTranscriptScrollIntentObserver(scroller);
        try {
            for (const key of ['ArrowDown', 'PageDown', 'End', ' ', 'ArrowUp', 'PageUp', 'Home']) {
                controller.jumpToLatest();
                scroller.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
                expect(controller.phase, key).to.equal('detached');
            }
        } finally {
            dispose.dispose();
        }
    });

    it('answers the hot-path selection check from the selectionchange state, without reading the selection', () => {
        const scroller = document.createElement('div');
        scroller.textContent = 'streaming answer';
        document.body.append(scroller);
        const observer = attachTranscriptScrollIntentObserver(scroller);
        const originalGetSelection = document.getSelection.bind(document);
        let reads = 0;
        document.getSelection = (): Selection | null => {
            reads++;
            return originalGetSelection();
        };
        try {
            // Reading the selection forces a synchronous layout, so a streaming patch must not.
            expect(transcriptHasObservedSelection(scroller)).to.equal(false);
            expect(reads).to.equal(0);

            const range = document.createRange();
            range.selectNodeContents(scroller);
            originalGetSelection()!.addRange(range);
            document.dispatchEvent(new window.Event('selectionchange'));
            const readsAfterEvent = reads;
            expect(transcriptHasObservedSelection(scroller)).to.equal(true);
            expect(reads, 'the listener reads once, the hot path never').to.equal(readsAfterEvent);
        } finally {
            document.getSelection = originalGetSelection;
            originalGetSelection()?.removeAllRanges();
            observer.dispose();
            scroller.remove();
        }
    });
});
